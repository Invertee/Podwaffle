package com.podwaffle.media

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONObject
import java.io.File

/** Runtime-only credentials used by the long-lived media service. */
data class NativeConfiguration(
    val serverBaseUrl: String,
    val deviceId: String,
    val deviceToken: String,
    val profileId: String,
    val skipBackwardMs: Long,
    val skipForwardMs: Long,
    val downloadRetentionDays: Int,
    val maxDownloadStorageBytes: Long,
    val revision: Long = 0L
) {
    companion object {
        fun fromMap(input: Map<String, Any?>): NativeConfiguration {
            val serverBaseUrl = (input["serverBaseUrl"] as? String)
                ?.trim()
                ?.trimEnd('/')
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("serverBaseUrl is required")
            val deviceId = (input["deviceId"] as? String)
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("deviceId is required")
            val deviceToken = (input["deviceToken"] as? String)
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("deviceToken is required")
            val profileId = (input["profileId"] as? String)
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("profileId is required")
            val skipBackSeconds = ((input["skipBackSeconds"] as? Number)?.toLong() ?: 15L)
                .coerceIn(1L, 120L)
            val skipForwardSeconds = ((input["skipForwardSeconds"] as? Number)?.toLong() ?: 30L)
                .coerceIn(1L, 120L)
            return NativeConfiguration(
                serverBaseUrl = serverBaseUrl,
                deviceId = deviceId,
                deviceToken = deviceToken,
                profileId = profileId,
                skipBackwardMs = skipBackSeconds * 1_000L,
                skipForwardMs = skipForwardSeconds * 1_000L,
                downloadRetentionDays = ((input["downloadRetentionDays"] as? Number)?.toInt() ?: 30)
                    .coerceIn(1, 3650),
                maxDownloadStorageBytes =
                    ((input["maxDownloadStorageBytes"] as? Number)?.toLong() ?: 2_000_000_000L)
                        .coerceAtLeast(50_000_000L),
                revision = (input["revision"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L
            )
        }
    }
}

object NativeConfigurationStore {
    @Volatile
    var current: NativeConfiguration? = null
}

data class EpisodeMedia(
    val episodeId: String,
    val podcastId: String,
    val title: String,
    val podcastTitle: String,
    val enclosureUrl: String,
    val enclosureType: String,
    val localDownloadPath: String?,
    val artworkUrl: String?,
    val durationMs: Long?,
    val queueItemId: String?
) {
    companion object {
        fun fromMap(input: Map<String, Any?>): EpisodeMedia {
            val episodeId = (input["episodeId"] as? String)
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("episodeId is required")
            val enclosureUrl = (input["enclosureUrl"] as? String).orEmpty()
            val localPath = (input["localDownloadPath"] as? String)
                ?.takeIf { it.isNotBlank() }
            if (enclosureUrl.isBlank() && localPath == null) {
                throw IllegalArgumentException("A playable enclosure or download is required")
            }
            return EpisodeMedia(
                episodeId = episodeId,
                podcastId = (input["podcastId"] as? String).orEmpty(),
                title = (input["title"] as? String)?.takeIf { it.isNotBlank() } ?: "Episode",
                podcastTitle = (input["podcastTitle"] as? String)
                    ?.takeIf { it.isNotBlank() }
                    ?: "Podcast",
                enclosureUrl = enclosureUrl,
                enclosureType = (input["enclosureType"] as? String)
                    ?.takeIf { it.isNotBlank() }
                    ?: "audio/mpeg",
                localDownloadPath = localPath,
                artworkUrl = (input["artworkUrl"] as? String)?.takeIf { it.isNotBlank() },
                durationMs = (input["durationMs"] as? Number)
                    ?.toLong()
                    ?.takeIf { it > 0L },
                queueItemId = (input["queueItemId"] as? String)?.takeIf { it.isNotBlank() }
            )
        }

        fun fromJson(json: JSONObject): EpisodeMedia {
            return EpisodeMedia(
                episodeId = json.getString("episodeId"),
                podcastId = json.optString("podcastId"),
                title = json.optString("title", "Episode"),
                podcastTitle = json.optString("podcastTitle", "Podcast"),
                enclosureUrl = json.optString("enclosureUrl"),
                enclosureType = json.optString("enclosureType", "audio/mpeg"),
                localDownloadPath = json.optNullableString("localDownloadPath"),
                artworkUrl = json.optNullableString("artworkUrl"),
                durationMs = json.optLong("durationMs", 0L).takeIf { it > 0L },
                queueItemId = json.optNullableString("queueItemId")
            )
        }

        fun fromMediaItem(item: MediaItem?): EpisodeMedia? {
            item ?: return null
            val metadata = item.mediaMetadata
            val extras = metadata.extras
            val episodeId = item.mediaId.takeIf { it.isNotBlank() } ?: return null
            return EpisodeMedia(
                episodeId = episodeId,
                podcastId = extras?.getString("podcastId").orEmpty(),
                title = metadata.title?.toString() ?: "Episode",
                podcastTitle = metadata.artist?.toString()
                    ?: metadata.albumTitle?.toString()
                    ?: "Podcast",
                enclosureUrl = extras?.getString("enclosureUrl").orEmpty(),
                enclosureType = extras?.getString("enclosureType") ?: "audio/mpeg",
                localDownloadPath = extras?.getString("localDownloadPath"),
                artworkUrl = metadata.artworkUri?.toString(),
                durationMs = extras?.getLong("durationMs", 0L)?.takeIf { it > 0L },
                queueItemId = extras?.getString("queueItemId")
            )
        }
    }

    fun withDownloadPath(path: String?): EpisodeMedia = copy(
        localDownloadPath = path?.takeIf { it.isNotBlank() }
    )

    fun toMediaItem(useDownload: Boolean = true): MediaItem {
        val localPath = localDownloadPath
            ?.takeIf { useDownload }
            ?.takeIf { File(it).isFile }
        val uri = if (localPath != null) Uri.fromFile(File(localPath)) else Uri.parse(enclosureUrl)
        val extras = Bundle().apply {
            putString("podcastId", podcastId)
            queueItemId?.let { putString("queueItemId", it) }
            putString("source", if (localPath == null) "stream" else "download")
            putString("enclosureUrl", enclosureUrl)
            putString("enclosureType", enclosureType)
            localPath?.let { putString("localDownloadPath", it) }
            durationMs?.let { putLong("durationMs", it) }
        }
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setDisplayTitle(title)
            .setArtist(podcastTitle)
            .setAlbumTitle(podcastTitle)
            .setSubtitle(podcastTitle)
            .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE)
            .setIsPlayable(true)
            .setArtworkUri(artworkUrl?.let(Uri::parse))
            .setExtras(extras)
            .build()
        return MediaItem.Builder()
            .setMediaId(episodeId)
            .setUri(uri)
            .setMimeType(enclosureType)
            .setMediaMetadata(metadata)
            .build()
    }

    fun toMap(): Map<String, Any?> = mapOf(
        "episodeId" to episodeId,
        "podcastId" to podcastId,
        "title" to title,
        "podcastTitle" to podcastTitle,
        "enclosureUrl" to enclosureUrl,
        "enclosureType" to enclosureType,
        "localDownloadPath" to localDownloadPath,
        "artworkUrl" to artworkUrl,
        "durationMs" to durationMs,
        "queueItemId" to queueItemId
    )

    fun toJson(): JSONObject = JSONObject().apply {
        put("episodeId", episodeId)
        put("podcastId", podcastId)
        put("title", title)
        put("podcastTitle", podcastTitle)
        put("enclosureUrl", enclosureUrl)
        put("enclosureType", enclosureType)
        put("localDownloadPath", localDownloadPath ?: JSONObject.NULL)
        put("artworkUrl", artworkUrl ?: JSONObject.NULL)
        put("durationMs", durationMs ?: JSONObject.NULL)
        put("queueItemId", queueItemId ?: JSONObject.NULL)
    }
}

data class QueueSnapshot(
    val items: List<EpisodeMedia>,
    val currentIndex: Int
) {
    companion object {
        fun fromMap(input: Map<String, Any?>): QueueSnapshot {
            @Suppress("UNCHECKED_CAST")
            val rawItems = input["items"] as? List<Map<String, Any?>> ?: emptyList()
            val items = rawItems.mapNotNull { item ->
                runCatching { EpisodeMedia.fromMap(item) }.getOrNull()
            }
            val currentIndex = ((input["currentIndex"] as? Number)?.toInt() ?: 0)
                .coerceIn(0, (items.size - 1).coerceAtLeast(0))
            return QueueSnapshot(items, currentIndex)
        }
    }
}

data class CastPlaybackSnapshot(
    val available: Boolean = false,
    val connecting: Boolean = false,
    val connected: Boolean = false,
    val sessionId: String? = null,
    val deviceName: String? = null,
    val volume: Double = 1.0,
    val muted: Boolean = false,
    val playing: Boolean = false,
    val buffering: Boolean = false,
    val mediaLoaded: Boolean = false,
    val playerState: String = "unknown",
    val idleReason: String? = null,
    val positionMs: Long = 0L,
    val durationMs: Long? = null,
    val episode: EpisodeMedia? = null,
    val availableDevices: List<String> = emptyList()
) {
    fun sessionMap(): Map<String, Any?>? {
        if (!connected || sessionId == null) return null
        return mapOf(
            "sessionId" to sessionId,
            "deviceName" to (deviceName ?: "Cast device"),
            "volume" to volume,
            "muted" to muted,
            "positionMs" to positionMs,
            "durationMs" to durationMs,
            "playerState" to playerState,
            "mediaLoaded" to mediaLoaded,
            "episodeId" to episode?.episodeId
        )
    }

    fun toMap(): Map<String, Any?> = mapOf(
        "available" to available,
        "connecting" to connecting,
        "connected" to connected,
        "session" to sessionMap(),
        "availableDevices" to availableDevices
    )
}

internal fun JSONObject.optNullableString(name: String): String? {
    if (!has(name) || isNull(name)) return null
    return optString(name).takeIf { it.isNotBlank() }
}
