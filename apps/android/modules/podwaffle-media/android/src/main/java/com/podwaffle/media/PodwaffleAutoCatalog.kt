package com.podwaffle.media

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Small, driver-safe catalogue used by Android Auto.
 *
 * The service exposes subscriptions as browsable podcast tiles and episodes as
 * playable leaves. Successful network responses are cached in app-private
 * preferences so the car can still show the last known catalogue when the
 * Podwaffle server is temporarily unreachable.
 */
class PodwaffleAutoCatalog(private val context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES,
        Context.MODE_PRIVATE,
    )
    private val executor: ListeningExecutorService = MoreExecutors.listeningDecorator(
        Executors.newFixedThreadPool(3),
    )
    private val episodeMemory = ConcurrentHashMap<String, AutoEpisode>()

    fun rootItem(): MediaItem {
        val style = Bundle().apply {
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
            )
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            )
        }
        return MediaItem.Builder()
            .setMediaId(ROOT_ID)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle("Podcasts")
                    .setDisplayTitle("Podcasts")
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setExtras(style)
                    .build(),
            )
            .build()
    }

    fun children(
        parentId: String,
        page: Int,
        pageSize: Int,
        params: MediaLibraryService.LibraryParams?,
        downloadStore: PodwaffleDownloadStore,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = executor.submit(
        java.util.concurrent.Callable {
            val items = when {
                parentId == ROOT_ID -> subscriptions().map(AutoPodcast::toMediaItem)
                parentId.startsWith(PODCAST_PREFIX) -> {
                    val podcastId = parentId.removePrefix(PODCAST_PREFIX)
                    episodes(podcastId).map { it.toMediaItem(downloadStore) }
                }
                else -> emptyList()
            }
            LibraryResult.ofItemList(paginate(items, page, pageSize), params)
        },
    )

    fun item(
        mediaId: String,
        downloadStore: PodwaffleDownloadStore,
    ): ListenableFuture<LibraryResult<MediaItem>> = executor.submit(
        java.util.concurrent.Callable {
            val item = when {
                mediaId == ROOT_ID -> rootItem()
                mediaId.startsWith(PODCAST_PREFIX) -> {
                    val podcastId = mediaId.removePrefix(PODCAST_PREFIX)
                    subscriptions().firstOrNull { it.id == podcastId }?.toMediaItem()
                }
                else -> episode(mediaId)?.toMediaItem(downloadStore)
            } ?: unavailableItem(mediaId)
            LibraryResult.ofItem(item, null)
        },
    )

    fun resolvePlayable(
        requested: List<MediaItem>,
        downloadStore: PodwaffleDownloadStore,
    ): List<MediaItem> = requested.mapNotNull { item ->
        if (item.mediaId == ROOT_ID || item.mediaId.startsWith(PODCAST_PREFIX)) {
            null
        } else {
            // Android Auto normally sends the full item returned by browsing.
            // Prefer it so playback selection never blocks the player thread on
            // a network lookup. The memory/disk catalogue is the legacy fallback.
            item.takeIf { it.localConfiguration != null }
                ?: episode(item.mediaId)?.toMediaItem(downloadStore)
        }
    }

    fun queueOnServer(mediaIds: List<String>) {
        val episodeIds = mediaIds.filter {
            it.isNotBlank() && it != ROOT_ID && !it.startsWith(PODCAST_PREFIX)
        }
        if (episodeIds.isEmpty()) return
        executor.execute {
            episodeIds.forEach { episodeId ->
                runCatching {
                    requestJson(
                        path = "/api/v1/queue/items",
                        method = "POST",
                        body = JSONObject().apply {
                            put("commandId", UUID.randomUUID().toString())
                            put("episodeId", episodeId)
                            put("position", "bottom")
                        },
                    )
                }
            }
        }
    }

    fun acquirePlayback(mediaId: String, positionMs: Long) {
        if (mediaId.isBlank() || mediaId.startsWith(PODCAST_PREFIX)) return
        executor.execute {
            val item = episode(mediaId) ?: return@execute
            runCatching {
                requestJson(
                    path = "/api/v1/playback/lease",
                    method = "POST",
                    body = JSONObject().apply {
                        put("episodeId", item.id)
                        put("positionMs", positionMs.coerceAtLeast(0L))
                        item.durationMs?.let { put("durationMs", it) }
                        put("playbackRate", 1.0)
                    },
                )
            }
        }
    }

    fun close() {
        executor.shutdownNow()
    }

    private fun subscriptions(): List<AutoPodcast> {
        val fresh = runCatching {
            val response = requestJson("/api/v1/subscriptions")
            val items = response.optJSONArray("subscriptions").toPodcasts()
            cache(PODCASTS_KEY, JSONArray().apply { items.forEach { put(it.toJson()) } })
            pruneUnsubscribedEpisodeCaches(items.map(AutoPodcast::id).toSet())
            items
        }.getOrNull()
        return fresh ?: cachedArray(PODCASTS_KEY).toPodcasts()
    }

    private fun episodes(podcastId: String): List<AutoEpisode> {
        val podcast = cachedArray(PODCASTS_KEY)
            .toPodcasts()
            .firstOrNull { it.id == podcastId }
        val key = episodesKey(podcastId)
        val fresh = runCatching {
            val response = requestJson("/api/v1/podcasts/$podcastId/episodes")
            val items = response.optJSONArray("episodes")
                .toEpisodes(podcast?.artworkUrl)
                .filter { it.enclosureUrl.isNotBlank() }
                .take(MAX_EPISODES_PER_PODCAST)
            cache(key, JSONArray().apply { items.forEach { put(it.toJson()) } })
            items.forEach { episodeMemory[it.id] = it }
            items
        }.getOrNull()
        if (fresh != null) return fresh
        return cachedArray(key).toEpisodes(podcast?.artworkUrl).also { items ->
            items.forEach { episodeMemory[it.id] = it }
        }
    }

    private fun episode(episodeId: String): AutoEpisode? {
        episodeMemory[episodeId]?.let { return it }
        val cached = preferences.all
            .asSequence()
            .filter { (key, _) -> key.startsWith(EPISODES_KEY_PREFIX) }
            .mapNotNull { (_, raw) ->
                val value = raw as? String ?: return@mapNotNull null
                runCatching { JSONArray(value) }.getOrNull()
            }
            .flatMap { array -> array.toEpisodes(null).asSequence() }
            .firstOrNull { it.id == episodeId }
        if (cached != null) {
            episodeMemory[cached.id] = cached
            return cached
        }
        val fresh = runCatching {
            requestJson("/api/v1/episodes/$episodeId")
                .optJSONObject("episode")
                ?.toEpisode(null)
        }.getOrNull()
        if (fresh != null) episodeMemory[fresh.id] = fresh
        return fresh
    }

    private fun requestJson(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
    ): JSONObject {
        val configuration = NativeConfigurationStore.current
            ?: NativeConfigurationPersistence.load(context)
            ?: throw IOException("Open Podwaffle on the phone to connect Android Auto")
        val connection = URL("${configuration.serverBaseUrl}$path")
            .openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${configuration.deviceToken}")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { output ->
                    output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                throw IOException("Podwaffle request failed ($status)")
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun cache(key: String, value: JSONArray) {
        runCatching {
            preferences.edit().putString(key, value.toString()).apply()
        }
    }

    private fun cachedArray(key: String): JSONArray = runCatching {
        JSONArray(preferences.getString(key, "[]") ?: "[]")
    }.getOrElse { JSONArray() }

    private fun pruneUnsubscribedEpisodeCaches(activePodcastIds: Set<String>) {
        val staleKeys = preferences.all.keys.filter { key ->
            key.startsWith(EPISODES_KEY_PREFIX) &&
                key.removePrefix(EPISODES_KEY_PREFIX) !in activePodcastIds
        }
        if (staleKeys.isEmpty()) return
        preferences.edit().also { editor ->
            staleKeys.forEach(editor::remove)
        }.apply()
    }

    private fun unavailableItem(mediaId: String): MediaItem = MediaItem.Builder()
        .setMediaId(mediaId.ifBlank { "podwaffle:auto:unavailable" })
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle("Content unavailable")
                .setSubtitle("Open Podwaffle on your phone and try again")
                .setIsBrowsable(false)
                .setIsPlayable(false)
                .build(),
        )
        .build()

    private fun <T> paginate(items: List<T>, page: Int, pageSize: Int): List<T> {
        if (page < 0 || pageSize <= 0 || items.isEmpty()) return emptyList()
        val from = (page.toLong() * pageSize.toLong()).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        if (from >= items.size) return emptyList()
        val to = (from.toLong() + pageSize.toLong()).coerceAtMost(items.size.toLong()).toInt()
        return items.subList(from, to)
    }

    companion object {
        const val ROOT_ID = "podwaffle:auto:podcasts"
        private const val PODCAST_PREFIX = "podwaffle:auto:podcast:"
        private const val PREFERENCES = "podwaffle.android-auto.catalog.v1"
        private const val PODCASTS_KEY = "podcasts"
        private const val EPISODES_KEY_PREFIX = "episodes:"
        private const val MAX_EPISODES_PER_PODCAST = 150
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 20_000

        fun clear(context: Context) {
            context.applicationContext
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
        }

        private fun episodesKey(podcastId: String) = "$EPISODES_KEY_PREFIX$podcastId"
    }
}

private data class AutoPodcast(
    val id: String,
    val title: String,
    val author: String?,
    val artworkUrl: String?,
) {
    fun toMediaItem(): MediaItem {
        val style = Bundle().apply {
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            )
        }
        return MediaItem.Builder()
            .setMediaId("podwaffle:auto:podcast:$id")
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setDisplayTitle(title)
                    .setArtist(author)
                    .setSubtitle(author)
                    .setArtworkUri(artworkUrl?.let(Uri::parse))
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setExtras(style)
                    .build(),
            )
            .build()
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("author", author ?: JSONObject.NULL)
        put("artworkUrl", artworkUrl ?: JSONObject.NULL)
    }
}

private data class AutoEpisode(
    val id: String,
    val podcastId: String,
    val podcastTitle: String,
    val title: String,
    val enclosureUrl: String,
    val enclosureType: String,
    val artworkUrl: String?,
    val durationMs: Long?,
    val positionMs: Long,
) {
    fun toMediaItem(downloadStore: PodwaffleDownloadStore): MediaItem {
        val localPath = downloadStore.completedPath(id)?.takeIf { File(it).isFile }
        val uri = localPath?.let { Uri.fromFile(File(it)) } ?: Uri.parse(enclosureUrl)
        val extras = Bundle().apply {
            putString("podcastId", podcastId)
            putString("source", if (localPath == null) "stream" else "download")
            putString("enclosureUrl", enclosureUrl)
            putString("enclosureType", enclosureType)
            localPath?.let { putString("localDownloadPath", it) }
            durationMs?.let { putLong("durationMs", it) }
            putLong("resumePositionMs", positionMs.coerceAtLeast(0L))
        }
        return MediaItem.Builder()
            .setMediaId(id)
            .setUri(uri)
            .setMimeType(enclosureType)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setDisplayTitle(title)
                    .setArtist(podcastTitle)
                    .setAlbumTitle(podcastTitle)
                    .setSubtitle(podcastTitle)
                    .setArtworkUri(artworkUrl?.let(Uri::parse))
                    .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setExtras(extras)
                    .build(),
            )
            .build()
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("podcastId", podcastId)
        put("podcastTitle", podcastTitle)
        put("title", title)
        put("enclosureUrl", enclosureUrl)
        put("enclosureType", enclosureType)
        put("artworkUrl", artworkUrl ?: JSONObject.NULL)
        put("durationMs", durationMs ?: JSONObject.NULL)
        put("positionMs", positionMs)
    }
}

private fun JSONArray?.toPodcasts(): List<AutoPodcast> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            val id = item.optString("id").takeIf { it.isNotBlank() } ?: continue
            add(
                AutoPodcast(
                    id = id,
                    title = item.optString("title", "Podcast"),
                    author = item.optNullableString("author"),
                    artworkUrl = item.optNullableString("artworkUrl"),
                ),
            )
        }
    }
}

private fun JSONArray?.toEpisodes(podcastArtworkUrl: String?): List<AutoEpisode> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            optJSONObject(index)?.toEpisode(podcastArtworkUrl)?.let(::add)
        }
    }
}

private fun JSONObject.toEpisode(podcastArtworkUrl: String?): AutoEpisode? {
    val id = optString("id").takeIf { it.isNotBlank() } ?: return null
    val enclosureUrl = optString("enclosureUrl")
    return AutoEpisode(
        id = id,
        podcastId = optString("podcastId"),
        podcastTitle = optString("podcastTitle", "Podcast"),
        title = optString("title", "Episode"),
        enclosureUrl = enclosureUrl,
        enclosureType = optString("enclosureType", "audio/mpeg")
            .takeIf { it.isNotBlank() }
            ?: "audio/mpeg",
        artworkUrl = podcastArtworkUrl ?: optNullableString("artworkUrl"),
        durationMs = optLong("durationMs", 0L).takeIf { it > 0L },
        positionMs = optLong("positionMs", 0L).coerceAtLeast(0L),
    )
}
