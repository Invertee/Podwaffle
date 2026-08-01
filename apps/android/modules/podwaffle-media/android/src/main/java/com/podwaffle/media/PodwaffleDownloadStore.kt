package com.podwaffle.media

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * App-private podcast downloader.
 *
 * Android's platform DownloadManager owns its notification UI. Podwaffle
 * downloads directly into its external-files directory instead, so podcast
 * downloads never add a second notification beside the media notification.
 *
 * Work is resumable with HTTP Range requests. Because hidden downloads are not
 * promoted to a foreground service, Android may suspend them when it kills the
 * app process; queued and interrupted work resumes when the media service is
 * configured again.
 */
class PodwaffleDownloadStore(
    private val context: Context,
    private val emit: (String, Map<String, Any?>) -> Unit,
) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val entries = linkedMapOf<String, Entry>()
    private val jobs = mutableMapOf<String, Future<*>>()
    private val lock = Any()
    private val executor = Executors.newFixedThreadPool(MAX_CONCURRENT_DOWNLOADS) { runnable ->
        Thread(runnable, "podwaffle-download").apply { isDaemon = true }
    }

    @Volatile
    private var released = false

    init {
        readPersisted()
    }

    fun add(input: Map<String, Any?>, reason: String): Map<String, Any?> {
        val profileId = currentProfileId()
            ?: throw IllegalStateException("The native media service is not configured")
        val episodeId = input["episodeId"] as? String
            ?: throw IllegalArgumentException("episodeId is required")
        val enclosureUrl = input["enclosureUrl"] as? String
            ?: throw IllegalArgumentException("enclosureUrl is required")
        val key = entryKey(profileId, episodeId)

        val extension = extensionFor(
            input["enclosureType"] as? String,
            Uri.parse(enclosureUrl).lastPathSegment,
        )
        val directory = requireNotNull(
            context.getExternalFilesDir(Environment.DIRECTORY_PODCASTS),
        ) { "Podcast storage is unavailable" }
        directory.mkdirs()
        val fileName = "${safeName(profileId)}-${safeName(episodeId)}.$extension"
        val localFile = File(directory, fileName)
        val partialFile = File(directory, "$fileName.part")

        val entry = synchronized(lock) {
            val existing = entries[key]
            if (existing != null) {
                val current = mapEntry(existing)
                val state = current["state"] as? String
                if (
                    state == "completed" ||
                    state == "queued" ||
                    state == "downloading"
                ) {
                    return current
                }
                jobs.remove(key)?.cancel(true)
                if (existing.partialPath != partialFile.absolutePath) {
                    File(existing.partialPath).delete()
                }
            }

            Entry(
                profileId = profileId,
                episodeId = episodeId,
                podcastId = input["podcastId"] as? String ?: "",
                title = input["title"] as? String ?: "Episode",
                podcastTitle = input["podcastTitle"] as? String ?: "Podcast",
                artworkUrl = input["artworkUrl"] as? String,
                enclosureUrl = enclosureUrl,
                enclosureType = input["enclosureType"] as? String,
                durationMs = (input["durationMs"] as? Number)?.toLong()?.takeIf { it > 0L },
                localPath = localFile.absolutePath,
                partialPath = partialFile.absolutePath,
                reason = if (reason == "automatic") "automatic" else "manual",
                createdAtMs = System.currentTimeMillis(),
                jobToken = UUID.randomUUID().toString(),
                state = "queued",
                progressBytes = partialFile.length().coerceAtLeast(0L),
                totalBytes = null,
                failureReason = null,
                downloadedAt = null,
            ).also {
                entries[key] = it
                persistLocked()
            }
        }

        val mapped = mapEntry(entry)
        emit(DOWNLOAD_STATE_CHANGED, mapped)
        schedule(entry)
        return mapped
    }

    fun remove(episodeId: String): Boolean {
        val profileId = currentProfileId() ?: return false
        val key = entryKey(profileId, episodeId)
        val entry = synchronized(lock) {
            jobs.remove(key)?.cancel(true)
            entries.remove(key)?.also { persistLocked() }
        } ?: return false

        File(entry.partialPath).delete()
        File(entry.localPath).delete()
        emit(
            DOWNLOAD_STATE_CHANGED,
            mapOf(
                "episodeId" to episodeId,
                "podcastId" to entry.podcastId,
                "state" to "removing",
                "progressBytes" to 0L,
                "totalBytes" to null,
                "failureReason" to null,
                "downloadedAt" to null,
                "localPath" to null,
                "reason" to entry.reason,
                "title" to entry.title,
                "podcastTitle" to entry.podcastTitle,
                "artworkUrl" to entry.artworkUrl,
                "enclosureUrl" to entry.enclosureUrl,
                "enclosureType" to entry.enclosureType,
                "durationMs" to entry.durationMs,
            ),
        )
        return true
    }

    fun getDownloads(): List<Map<String, Any?>> {
        val profileId = currentProfileId() ?: return emptyList()
        return synchronized(lock) {
            entries.values
                .asSequence()
                .filter { it.profileId == profileId }
                .map { mapEntry(it.copy()) }
                .sortedByDescending { item ->
                    (item["downloadedAt"] as? String) ?: ""
                }
                .toList()
        }
    }

    fun completedPath(episodeId: String): String? {
        val profileId = currentProfileId() ?: return null
        return synchronized(lock) {
            val entry = entries[entryKey(profileId, episodeId)] ?: return@synchronized null
            val file = File(entry.localPath)
            if (entry.state == "completed" && file.isFile) file.absolutePath else null
        }
    }

    fun maintenance(
        maxAutomaticAgeDays: Int = 30,
        maxStorageBytes: Long = 2_000_000_000L,
    ): Map<String, Any?> {
        resumePending()

        val cutoff = System.currentTimeMillis() -
            maxAutomaticAgeDays.coerceAtLeast(1) * 86_400_000L
        val storageLimit = maxStorageBytes.coerceAtLeast(50_000_000L)
        var removedCount = 0
        var freedBytes = 0L
        val errors = mutableListOf<String>()
        val profileId = currentProfileId()
        val profileEntries = synchronized(lock) {
            if (profileId == null) emptyList() else {
                entries.values.filter { it.profileId == profileId }.map(Entry::copy)
            }
        }

        fun removeEntry(entry: Entry) {
            val file = File(entry.localPath)
            val partial = File(entry.partialPath)
            freedBytes += (if (file.exists()) file.length() else 0L) +
                (if (partial.exists()) partial.length() else 0L)
            if (remove(entry.episodeId)) removedCount += 1
        }

        for (entry in profileEntries) {
            try {
                val mapped = mapEntry(entry)
                val state = mapped["state"] as? String
                val missingCompletedFile = state == "failed" && entry.state == "completed"
                val staleAutomatic =
                    entry.reason == "automatic" &&
                        entry.createdAtMs < cutoff &&
                        state != "downloading" &&
                        state != "queued"
                val failedAutomatic = entry.reason == "automatic" && state == "failed"
                if (missingCompletedFile || staleAutomatic || failedAutomatic) {
                    removeEntry(entry)
                }
            } catch (error: Exception) {
                errors += "${entry.episodeId}: ${error.message ?: "maintenance failed"}"
            }
        }

        val completed = synchronized(lock) {
            entries.values
                .filter { it.profileId == profileId && it.state == "completed" }
                .mapNotNull { entry ->
                    val file = File(entry.localPath)
                    if (file.isFile) entry.copy() to file.length() else null
                }
        }
        var storageBytes = completed.sumOf { it.second }
        if (storageBytes > storageLimit) {
            for ((entry, size) in completed
                .filter { it.first.reason == "automatic" }
                .sortedBy { it.first.createdAtMs }) {
                if (storageBytes <= storageLimit) break
                try {
                    removeEntry(entry)
                    storageBytes = (storageBytes - size).coerceAtLeast(0L)
                } catch (error: Exception) {
                    errors += "${entry.episodeId}: ${error.message ?: "storage cleanup failed"}"
                }
            }
        }
        if (storageBytes > storageLimit) {
            errors += "Manual downloads exceed the configured storage limit; none were removed."
        }

        val result = mapOf(
            "removedCount" to removedCount,
            "freedBytes" to freedBytes,
            "errors" to errors,
        )
        emit(DOWNLOAD_MAINTENANCE_COMPLETED, result)
        return result
    }

    fun emitAll() {
        resumePending()
        getDownloads().forEach { emit(DOWNLOAD_STATE_CHANGED, it) }
    }

    fun release() {
        val activeJobs = synchronized(lock) {
            released = true
            entries.values
                .filter { it.state == "downloading" }
                .forEach { entry ->
                    entry.state = "queued"
                    entry.failureReason = null
                    entry.progressBytes = File(entry.partialPath).length()
                }
            persistLocked()
            jobs.values.toList().also { jobs.clear() }
        }
        activeJobs.forEach { it.cancel(true) }
        executor.shutdownNow()
    }

    private fun resumePending() {
        if (released) return
        val profileId = currentProfileId() ?: return
        val pending = synchronized(lock) {
            entries.values
                .filter { it.profileId == profileId && it.state == "queued" }
                .map(Entry::copy)
        }
        pending.forEach(::schedule)
    }

    private fun schedule(entry: Entry) {
        val key = entryKey(entry.profileId, entry.episodeId)
        synchronized(lock) {
            if (released || jobs.containsKey(key)) return
            val current = entries[key] ?: return
            if (current.jobToken != entry.jobToken || current.state != "queued") return
            jobs[key] = executor.submit { download(key, entry.jobToken) }
        }
    }

    private fun download(key: String, token: String) {
        var connection: HttpURLConnection? = null
        try {
            val snapshot = currentEntry(key, token) ?: return
            val finalFile = File(snapshot.localPath)
            val partialFile = File(snapshot.partialPath)
            finalFile.parentFile?.mkdirs()

            var resumeFrom = partialFile.length().coerceAtLeast(0L)
            connection = openConnection(snapshot.enclosureUrl, resumeFrom)
            var responseCode = connection.responseCode

            if (
                resumeFrom > 0L &&
                responseCode != HttpURLConnection.HTTP_PARTIAL
            ) {
                connection.disconnect()
                partialFile.delete()
                resumeFrom = 0L
                connection = openConnection(snapshot.enclosureUrl, 0L)
                responseCode = connection.responseCode
            }

            if (responseCode !in 200..299) {
                throw IllegalStateException("Download failed with HTTP $responseCode")
            }

            val total = totalBytes(connection, resumeFrom)
            updateEntry(key, token) { entry ->
                entry.state = "downloading"
                entry.progressBytes = resumeFrom
                entry.totalBytes = total
                entry.failureReason = null
            }

            val append = resumeFrom > 0L && responseCode == HttpURLConnection.HTTP_PARTIAL
            var downloaded = if (append) resumeFrom else 0L
            var lastEmitAt = 0L
            var lastPersistAt = 0L

            BufferedInputStream(connection.inputStream).use { input ->
                FileOutputStream(partialFile, append).buffered().use { output ->
                    val buffer = ByteArray(BUFFER_SIZE)
                    while (true) {
                        ensureActive(key, token)
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count

                        val now = System.currentTimeMillis()
                        if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
                            updateProgress(
                                key = key,
                                token = token,
                                downloaded = downloaded,
                                total = total,
                                persist = now - lastPersistAt >= PROGRESS_PERSIST_INTERVAL_MS,
                            )
                            lastEmitAt = now
                            if (now - lastPersistAt >= PROGRESS_PERSIST_INTERVAL_MS) {
                                lastPersistAt = now
                            }
                        }
                    }
                    output.flush()
                }
            }

            ensureActive(key, token)
            if (finalFile.exists() && !finalFile.delete()) {
                throw IllegalStateException("Existing podcast file could not be replaced")
            }
            if (!partialFile.renameTo(finalFile)) {
                partialFile.copyTo(finalFile, overwrite = true)
                partialFile.delete()
            }
            val completedAt = Instant.ofEpochMilli(
                finalFile.lastModified().takeIf { it > 0L } ?: System.currentTimeMillis(),
            ).toString()
            updateEntry(key, token) { entry ->
                entry.state = "completed"
                entry.progressBytes = finalFile.length()
                entry.totalBytes = finalFile.length()
                entry.failureReason = null
                entry.downloadedAt = completedAt
            }
        } catch (_: CancellationException) {
            if (!released) {
                updateEntry(key, token) { entry ->
                    entry.state = "queued"
                    entry.progressBytes = File(entry.partialPath).length()
                    entry.failureReason = null
                }
            }
        } catch (error: Exception) {
            updateEntry(key, token) { entry ->
                entry.state = "failed"
                entry.progressBytes = File(entry.partialPath).length()
                entry.failureReason = error.message ?: "Download failed"
            }
        } finally {
            connection?.disconnect()
            synchronized(lock) {
                val current = entries[key]
                if (current?.jobToken == token) jobs.remove(key)
            }
        }
    }

    private fun updateProgress(
        key: String,
        token: String,
        downloaded: Long,
        total: Long?,
        persist: Boolean,
    ) {
        val mapped = synchronized(lock) {
            val entry = entries[key]
                ?.takeIf { it.jobToken == token }
                ?: return@synchronized null
            entry.progressBytes = downloaded
            entry.totalBytes = total
            if (persist) persistLocked()
            mapEntry(entry.copy())
        }
        if (mapped != null) emit(DOWNLOAD_STATE_CHANGED, mapped)
    }

    private fun updateEntry(
        key: String,
        token: String,
        block: (Entry) -> Unit,
    ): Map<String, Any?>? {
        val mapped = synchronized(lock) {
            val entry = entries[key]
                ?.takeIf { it.jobToken == token }
                ?: return@synchronized null
            block(entry)
            persistLocked()
            mapEntry(entry.copy())
        }
        if (mapped != null) emit(DOWNLOAD_STATE_CHANGED, mapped)
        return mapped
    }

    private fun currentEntry(key: String, token: String): Entry? = synchronized(lock) {
        entries[key]?.takeIf { it.jobToken == token }?.copy()
    }

    private fun ensureActive(key: String, token: String) {
        if (
            released ||
            Thread.currentThread().isInterrupted ||
            synchronized(lock) { entries[key]?.jobToken != token }
        ) {
            throw CancellationException("Download cancelled")
        }
    }

    private fun openConnection(url: String, resumeFrom: Long): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = true
            useCaches = false
            setRequestProperty("Accept-Encoding", "identity")
            setRequestProperty("User-Agent", "Podwaffle Android")
            if (resumeFrom > 0L) setRequestProperty("Range", "bytes=$resumeFrom-")
            connect()
        }

    private fun totalBytes(connection: HttpURLConnection, resumeFrom: Long): Long? {
        val rangeTotal = connection.getHeaderField("Content-Range")
            ?.substringAfterLast('/')
            ?.toLongOrNull()
            ?.takeIf { it > 0L }
        if (rangeTotal != null) return rangeTotal
        val contentLength = connection.contentLengthLong.takeIf { it > 0L } ?: return null
        return if (connection.responseCode == HttpURLConnection.HTTP_PARTIAL) {
            resumeFrom + contentLength
        } else {
            contentLength
        }
    }

    private fun currentProfileId(): String? = NativeConfigurationStore.current?.profileId

    private fun mapEntry(entry: Entry): Map<String, Any?> {
        val file = File(entry.localPath)
        val effectiveState = if (entry.state == "completed" && !file.isFile) {
            "failed"
        } else {
            entry.state
        }
        val progress = when (effectiveState) {
            "completed" -> file.length()
            else -> maxOf(entry.progressBytes, File(entry.partialPath).length())
        }
        val downloadedAt = if (effectiveState == "completed") {
            entry.downloadedAt
                ?: Instant.ofEpochMilli(
                    file.lastModified().takeIf { it > 0L } ?: entry.createdAtMs,
                ).toString()
        } else {
            null
        }
        val failure = if (effectiveState == "failed") {
            entry.failureReason ?: "Downloaded file is unavailable"
        } else {
            null
        }
        return mapOf(
            "profileId" to entry.profileId,
            "episodeId" to entry.episodeId,
            "podcastId" to entry.podcastId,
            "state" to effectiveState,
            "progressBytes" to progress,
            "totalBytes" to entry.totalBytes,
            "failureReason" to failure,
            "downloadedAt" to downloadedAt,
            "localPath" to if (effectiveState == "completed") entry.localPath else null,
            "reason" to entry.reason,
            "title" to entry.title,
            "podcastTitle" to entry.podcastTitle,
            "artworkUrl" to entry.artworkUrl,
            "enclosureUrl" to entry.enclosureUrl,
            "enclosureType" to entry.enclosureType,
            "durationMs" to entry.durationMs,
        )
    }

    private fun readPersisted() {
        val raw = preferences.getString(ENTRIES_KEY, null) ?: return
        try {
            val array = JSONArray(raw)
            val legacyRequestIds = mutableListOf<Long>()
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                val profileId = item.optString("profileId", "legacy")
                val episodeId = item.getString("episodeId")
                val localPath = item.getString("localPath")
                val localFile = File(localPath)
                val partialPath = item.optString("partialPath").ifBlank {
                    "$localPath.part"
                }
                val persistedState = item.optString("state").ifBlank {
                    if (localFile.isFile) "completed" else "queued"
                }
                val legacyRequestId = item.optLong("requestId", -1L)
                if (legacyRequestId > 0L) legacyRequestIds += legacyRequestId

                val state = when {
                    localFile.isFile -> "completed"
                    persistedState == "downloading" -> "queued"
                    persistedState in VALID_STATES -> persistedState
                    else -> "queued"
                }
                val entry = Entry(
                    profileId = profileId,
                    episodeId = episodeId,
                    podcastId = item.optString("podcastId"),
                    title = item.optString("title", "Episode"),
                    podcastTitle = item.optString("podcastTitle", "Podcast"),
                    artworkUrl = item.optString("artworkUrl").ifBlank { null },
                    enclosureUrl = item.optString("enclosureUrl"),
                    enclosureType = item.optString("enclosureType").ifBlank { null },
                    durationMs = item.optLong("durationMs", 0L).takeIf { it > 0L },
                    localPath = localPath,
                    partialPath = partialPath,
                    reason = item.optString("reason", "manual"),
                    createdAtMs = item.optLong("createdAtMs", System.currentTimeMillis()),
                    jobToken = UUID.randomUUID().toString(),
                    state = state,
                    progressBytes = item.optLong(
                        "progressBytes",
                        File(partialPath).length(),
                    ).coerceAtLeast(0L),
                    totalBytes = item.optLong("totalBytes", -1L).takeIf { it >= 0L },
                    failureReason = item.optString("failureReason").ifBlank { null },
                    downloadedAt = item.optString("downloadedAt").ifBlank { null },
                )
                entries[entryKey(profileId, episodeId)] = entry
            }

            if (legacyRequestIds.isNotEmpty()) {
                val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                manager.remove(*legacyRequestIds.toLongArray())
            }
            synchronized(lock) { persistLocked() }
        } catch (_: Exception) {
            preferences.edit().remove(ENTRIES_KEY).apply()
        }
    }

    private fun persistLocked() {
        val array = JSONArray()
        entries.values.forEach { entry ->
            array.put(
                JSONObject()
                    .put("profileId", entry.profileId)
                    .put("episodeId", entry.episodeId)
                    .put("podcastId", entry.podcastId)
                    .put("title", entry.title)
                    .put("podcastTitle", entry.podcastTitle)
                    .put("artworkUrl", entry.artworkUrl ?: "")
                    .put("enclosureUrl", entry.enclosureUrl)
                    .put("enclosureType", entry.enclosureType ?: "")
                    .put("durationMs", entry.durationMs ?: JSONObject.NULL)
                    .put("localPath", entry.localPath)
                    .put("partialPath", entry.partialPath)
                    .put("reason", entry.reason)
                    .put("createdAtMs", entry.createdAtMs)
                    .put("state", entry.state)
                    .put("progressBytes", entry.progressBytes)
                    .put("totalBytes", entry.totalBytes ?: JSONObject.NULL)
                    .put("failureReason", entry.failureReason ?: "")
                    .put("downloadedAt", entry.downloadedAt ?: ""),
            )
        }
        preferences.edit().putString(ENTRIES_KEY, array.toString()).apply()
    }

    private data class Entry(
        val profileId: String,
        val episodeId: String,
        val podcastId: String,
        val title: String,
        val podcastTitle: String,
        val artworkUrl: String?,
        val enclosureUrl: String,
        val enclosureType: String?,
        val durationMs: Long?,
        val localPath: String,
        val partialPath: String,
        val reason: String,
        val createdAtMs: Long,
        val jobToken: String,
        var state: String,
        var progressBytes: Long,
        var totalBytes: Long?,
        var failureReason: String?,
        var downloadedAt: String?,
    )

    private companion object {
        const val PREFERENCES = "podwaffle_downloads_v1"
        const val ENTRIES_KEY = "entries"
        const val DOWNLOAD_STATE_CHANGED = "download.state.changed"
        const val DOWNLOAD_MAINTENANCE_COMPLETED = "download.maintenance.completed"
        const val MAX_CONCURRENT_DOWNLOADS = 2
        const val BUFFER_SIZE = 64 * 1024
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 30_000
        const val PROGRESS_EMIT_INTERVAL_MS = 500L
        const val PROGRESS_PERSIST_INTERVAL_MS = 5_000L
        val VALID_STATES = setOf("queued", "downloading", "completed", "failed")

        fun entryKey(profileId: String, episodeId: String): String = "$profileId:$episodeId"

        fun safeName(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "_")

        fun extensionFor(mimeType: String?, path: String?): String = when {
            mimeType?.contains("mp4", ignoreCase = true) == true -> "m4a"
            mimeType?.contains("aac", ignoreCase = true) == true -> "aac"
            mimeType?.contains("ogg", ignoreCase = true) == true -> "ogg"
            mimeType?.contains("wav", ignoreCase = true) == true -> "wav"
            path?.substringAfterLast('.', "")?.lowercase() in setOf(
                "mp3",
                "m4a",
                "aac",
                "ogg",
                "wav",
            ) -> path.orEmpty().substringAfterLast('.').lowercase()
            else -> "mp3"
        }
    }
}
