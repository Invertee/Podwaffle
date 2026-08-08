package com.podwaffle.media

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

class PodwaffleDownloadStore(
    private val context: Context,
    private val emit: (String, Map<String, Any?>) -> Unit,
) {
    private val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val entries = linkedMapOf<String, Entry>()

    private val completionReceiver = object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val requestId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            val entry = entries.values.firstOrNull { it.requestId == requestId } ?: return
            persist()
            if (entry.profileId == currentProfileId()) emitState(entry)
        }
    }

    init {
        readPersisted()
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(completionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            context.registerReceiver(completionReceiver, filter)
        }
    }

    fun add(input: Map<String, Any?>, reason: String): Map<String, Any?> {
        val profileId = currentProfileId()
            ?: throw IllegalStateException("The native media service is not configured")
        val episodeId = input["episodeId"] as? String
            ?: throw IllegalArgumentException("episodeId is required")
        val key = entryKey(profileId, episodeId)
        val enclosureUrl = input["enclosureUrl"] as? String
            ?: throw IllegalArgumentException("enclosureUrl is required")
        entries[key]?.let { existing ->
            val state = mapEntry(existing)
            if (state["state"] != "failed") return state
            manager.remove(existing.requestId)
        }
        val extension = extensionFor(
            input["enclosureType"] as? String,
            Uri.parse(enclosureUrl).lastPathSegment,
        )
        val fileName = "${safeName(profileId)}-${safeName(episodeId)}.$extension"
        val request = DownloadManager.Request(Uri.parse(enclosureUrl))
            .setTitle(input["title"] as? String ?: "Podcast episode")
            .setDescription(input["podcastTitle"] as? String ?: "Podwaffle")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setDestinationInExternalFilesDir(
                context,
                Environment.DIRECTORY_PODCASTS,
                fileName,
            )
        (input["enclosureType"] as? String)?.takeIf { it.isNotBlank() }?.let(request::setMimeType)
        val requestId = manager.enqueue(request)
        val localFile = File(
            requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_PODCASTS)),
            fileName,
        )
        val entry = Entry(
            profileId = profileId,
            episodeId = episodeId,
            podcastId = input["podcastId"] as? String ?: "",
            requestId = requestId,
            title = input["title"] as? String ?: "Episode",
            podcastTitle = input["podcastTitle"] as? String ?: "Podcast",
            artworkUrl = input["artworkUrl"] as? String,
            enclosureUrl = enclosureUrl,
            enclosureType = input["enclosureType"] as? String,
            durationMs = (input["durationMs"] as? Number)?.toLong()?.takeIf { it > 0L },
            localPath = localFile.absolutePath,
            reason = if (reason == "automatic") "automatic" else "manual",
            createdAtMs = System.currentTimeMillis(),
        )
        entries[key] = entry
        persist()
        return mapEntry(entry).also { emit(DOWNLOAD_STATE_CHANGED, it) }
    }

    fun remove(episodeId: String): Boolean {
        val profileId = currentProfileId() ?: return false
        val entry = entries.remove(entryKey(profileId, episodeId)) ?: return false
        manager.remove(entry.requestId)
        File(entry.localPath).delete()
        persist()
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
        return entries.values
            .asSequence()
            .filter { it.profileId == profileId }
            .map(::mapEntry)
            .sortedByDescending { item ->
                (item["downloadedAt"] as? String) ?: ""
            }
            .toList()
    }

    fun completedPath(episodeId: String): String? {
        val profileId = currentProfileId() ?: return null
        val entry = entries[entryKey(profileId, episodeId)] ?: return null
        val mapped = mapEntry(entry)
        return if (mapped["state"] == "completed" && File(entry.localPath).exists()) {
            entry.localPath
        } else null
    }

    fun maintenance(
        maxAutomaticAgeDays: Int = 30,
        maxStorageBytes: Long = 2_000_000_000L,
        // Protect current and queued downloads during maintenance.
        protectedEpisodeIds: Set<String> =
            PodwaffleCachePolicy.protectedEpisodeIds(context),
    ): Map<String, Any?> {
        val cutoff = System.currentTimeMillis() -
            maxAutomaticAgeDays.coerceAtLeast(1) * 86_400_000L
        val storageLimit = maxStorageBytes.coerceAtLeast(50_000_000L)
        var removedCount = 0
        var freedBytes = 0L
        val errors = mutableListOf<String>()

        fun removeEntry(entry: Entry) {
            val file = File(entry.localPath)
            freedBytes += if (file.exists()) file.length() else 0L
            if (remove(entry.episodeId)) removedCount += 1
        }

        val profileId = currentProfileId()
        val profileEntries = if (profileId == null) emptyList() else {
            entries.values.filter { it.profileId == profileId }
        }
        for (entry in profileEntries.toList()) {
            try {
                val mapped = mapEntry(entry)
                val file = File(entry.localPath)
                val missingCompletedFile = mapped["state"] == "completed" && !file.exists()
                val staleAutomatic =
                    entry.reason == "automatic" &&
                        entry.episodeId !in protectedEpisodeIds &&
                        entry.createdAtMs < cutoff &&
                        mapped["state"] != "downloading"
                val failed = mapped["state"] == "failed"
                if (missingCompletedFile || staleAutomatic || failed) removeEntry(entry)
            } catch (error: Exception) {
                errors += "${entry.episodeId}: ${error.message ?: "maintenance failed"}"
            }
        }

        val completed = profileEntries.mapNotNull { entry ->
            val file = File(entry.localPath)
            if (mapEntry(entry)["state"] == "completed" && file.isFile) {
                entry to file.length()
            } else {
                null
            }
        }
        var storageBytes = completed.sumOf { it.second }
        if (storageBytes > storageLimit) {
            for ((entry, size) in completed
                .filter {
                    it.first.reason == "automatic" &&
                        it.first.episodeId !in protectedEpisodeIds
                }
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
        getDownloads().forEach { emit(DOWNLOAD_STATE_CHANGED, it) }
    }

    fun release() {
        try {
            context.unregisterReceiver(completionReceiver)
        } catch (_: IllegalArgumentException) {
            // Receiver was already unregistered by Android process teardown.
        }
    }

    private fun emitState(entry: Entry) {
        emit(DOWNLOAD_STATE_CHANGED, mapEntry(entry))
    }

    private fun currentProfileId(): String? = NativeConfigurationStore.current?.profileId

    private fun mapEntry(entry: Entry): Map<String, Any?> {
        var status = DownloadManager.STATUS_FAILED
        var progress = 0L
        var total: Long? = null
        var failure: String? = null
        val cursor = manager.query(
            DownloadManager.Query().setFilterById(entry.requestId),
        )
        cursor.use {
            if (it.moveToFirst()) {
                status = it.int(DownloadManager.COLUMN_STATUS, DownloadManager.STATUS_FAILED)
                progress = it.long(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR, 0L)
                val queriedTotal = it.long(DownloadManager.COLUMN_TOTAL_SIZE_BYTES, -1L)
                total = queriedTotal.takeIf { value -> value >= 0 }
                if (status == DownloadManager.STATUS_FAILED) {
                    failure = "DownloadManager reason ${it.int(DownloadManager.COLUMN_REASON, 0)}"
                }
            } else if (File(entry.localPath).exists()) {
                status = DownloadManager.STATUS_SUCCESSFUL
                progress = File(entry.localPath).length()
                total = progress
            }
        }
        val state = when (status) {
            DownloadManager.STATUS_PENDING -> "queued"
            DownloadManager.STATUS_RUNNING, DownloadManager.STATUS_PAUSED -> "downloading"
            DownloadManager.STATUS_SUCCESSFUL -> "completed"
            else -> "failed"
        }
        val file = File(entry.localPath)
        val downloadedAt = if (state == "completed" && file.exists()) {
            Instant.ofEpochMilli(file.lastModified().coerceAtLeast(entry.createdAtMs)).toString()
        } else null
        return mapOf(
            "profileId" to entry.profileId,
            "episodeId" to entry.episodeId,
            "podcastId" to entry.podcastId,
            "state" to state,
            "progressBytes" to progress,
            "totalBytes" to total,
            "failureReason" to failure,
            "downloadedAt" to downloadedAt,
            "localPath" to if (state == "completed" && file.exists()) entry.localPath else null,
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
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                val entry = Entry(
                    profileId = item.optString("profileId", "legacy"),
                    episodeId = item.getString("episodeId"),
                    podcastId = item.optString("podcastId"),
                    requestId = item.getLong("requestId"),
                    title = item.optString("title", "Episode"),
                    podcastTitle = item.optString("podcastTitle", "Podcast"),
                    artworkUrl = item.optString("artworkUrl").ifBlank { null },
                    enclosureUrl = item.optString("enclosureUrl"),
                    enclosureType = item.optString("enclosureType").ifBlank { null },
                    durationMs = item.optLong("durationMs", 0L).takeIf { it > 0L },
                    localPath = item.getString("localPath"),
                    reason = item.optString("reason", "manual"),
                    createdAtMs = item.optLong("createdAtMs", System.currentTimeMillis()),
                )
                entries[entryKey(entry.profileId, entry.episodeId)] = entry
            }
        } catch (_: Exception) {
            preferences.edit().remove(ENTRIES_KEY).apply()
        }
    }

    private fun persist() {
        val array = JSONArray()
        entries.values.forEach { entry ->
            array.put(
                JSONObject()
                    .put("profileId", entry.profileId)
                    .put("episodeId", entry.episodeId)
                    .put("podcastId", entry.podcastId)
                    .put("requestId", entry.requestId)
                    .put("title", entry.title)
                    .put("podcastTitle", entry.podcastTitle)
                    .put("artworkUrl", entry.artworkUrl ?: "")
                    .put("enclosureUrl", entry.enclosureUrl)
                    .put("enclosureType", entry.enclosureType ?: "")
                    .put("durationMs", entry.durationMs ?: JSONObject.NULL)
                    .put("localPath", entry.localPath)
                    .put("reason", entry.reason)
                    .put("createdAtMs", entry.createdAtMs),
            )
        }
        preferences.edit().putString(ENTRIES_KEY, array.toString()).apply()
    }

    private fun Cursor.int(column: String, fallback: Int): Int {
        val index = getColumnIndex(column)
        return if (index >= 0) getInt(index) else fallback
    }

    private fun Cursor.long(column: String, fallback: Long): Long {
        val index = getColumnIndex(column)
        return if (index >= 0) getLong(index) else fallback
    }

    private data class Entry(
        val profileId: String,
        val episodeId: String,
        val podcastId: String,
        val requestId: Long,
        val title: String,
        val podcastTitle: String,
        val artworkUrl: String?,
        val enclosureUrl: String,
        val enclosureType: String?,
        val durationMs: Long?,
        val localPath: String,
        val reason: String,
        val createdAtMs: Long,
    )

    private companion object {
        const val PREFERENCES = "podwaffle_downloads_v1"
        const val ENTRIES_KEY = "entries"
        const val DOWNLOAD_STATE_CHANGED = "download.state.changed"
        const val DOWNLOAD_MAINTENANCE_COMPLETED = "download.maintenance.completed"

        fun entryKey(profileId: String, episodeId: String): String = "$profileId:$episodeId"

        fun safeName(value: String): String = value.replace(Regex("[^A-Za-z0-9._-]"), "_")

        fun extensionFor(mimeType: String?, path: String?): String = when {
            mimeType?.contains("mp4", ignoreCase = true) == true -> "m4a"
            mimeType?.contains("aac", ignoreCase = true) == true -> "aac"
            mimeType?.contains("ogg", ignoreCase = true) == true -> "ogg"
            mimeType?.contains("wav", ignoreCase = true) == true -> "wav"
            path?.substringAfterLast('.', "")?.lowercase() in setOf("mp3", "m4a", "aac", "ogg", "wav") ->
                path.orEmpty().substringAfterLast('.').lowercase()
            else -> "mp3"
        }
    }
}
