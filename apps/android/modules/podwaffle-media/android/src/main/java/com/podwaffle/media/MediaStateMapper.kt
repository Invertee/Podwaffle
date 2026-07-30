package com.podwaffle.media

import androidx.media3.common.Player
import androidx.media3.common.MediaItem

object MediaStateMapper {

    fun mapPlayerStatus(playbackState: Int): String {
        return when (playbackState) {
            Player.STATE_IDLE -> "idle"
            Player.STATE_BUFFERING -> "buffering"
            Player.STATE_READY -> "ready"
            Player.STATE_ENDED -> "ended"
            else -> "idle"
        }
    }

    fun mapStateToMap(
        player: Player?,
        hasLease: Boolean = false,
        leaseExpiresAt: String? = null,
        lastError: Pair<String, String>? = null
    ): Map<String, Any?> {
        if (player == null) {
            return mapOf(
                "episodeId" to null,
                "podcastId" to null,
                "title" to null,
                "podcastTitle" to null,
                "artworkUrl" to null,
                "durationMs" to null,
                "positionMs" to 0L,
                "bufferedPositionMs" to 0L,
                "playbackStatus" to "idle",
                "playWhenReady" to false,
                "playbackRate" to 1.0f,
                "source" to "stream",
                "queueItemId" to null,
                "queueIndex" to 0,
                "queueLength" to 0,
                "hasLease" to hasLease,
                "leaseExpiresAt" to leaseExpiresAt,
                "cast" to null,
                "lastError" to if (lastError != null) mapOf("code" to lastError.first, "message" to lastError.second) else null
            )
        }

        val currentMediaItem: MediaItem? = player.currentMediaItem
        val mediaMetadata = currentMediaItem?.mediaMetadata

        val duration = if (player.duration > 0) player.duration else null
        val position = player.currentPosition.coerceAtLeast(0L)
        val bufferedPosition = player.bufferedPosition.coerceAtLeast(0L)

        val episodeId = currentMediaItem?.mediaId
        val podcastTitle = mediaMetadata?.artist?.toString() ?: mediaMetadata?.albumArtist?.toString()
        val title = mediaMetadata?.title?.toString()
        val artworkUrl = mediaMetadata?.artworkUri?.toString()

        val queueLength = player.mediaItemCount
        val queueIndex = player.currentMediaItemIndex

        return mapOf(
            "episodeId" to episodeId,
            "podcastId" to null, // Can be populated from extras in later milestones
            "title" to title,
            "podcastTitle" to podcastTitle,
            "artworkUrl" to artworkUrl,
            "durationMs" to duration,
            "positionMs" to position,
            "bufferedPositionMs" to bufferedPosition,
            "playbackStatus" to mapPlayerStatus(player.playbackState),
            "playWhenReady" to player.playWhenReady,
            "playbackRate" to player.playbackParameters.speed,
            "source" to "stream",
            "queueItemId" to null,
            "queueIndex" to queueIndex,
            "queueLength" to queueLength,
            "hasLease" to hasLease,
            "leaseExpiresAt" to leaseExpiresAt,
            "cast" to null,
            "lastError" to if (lastError != null) mapOf("code" to lastError.first, "message" to lastError.second) else null
        )
    }

    fun mapPositionToMap(player: Player?): Map<String, Any> {
        if (player == null) {
            return mapOf("positionMs" to 0L, "bufferedPositionMs" to 0L)
        }
        return mapOf(
            "positionMs" to player.currentPosition.coerceAtLeast(0L),
            "bufferedPositionMs" to player.bufferedPosition.coerceAtLeast(0L)
        )
    }
}
