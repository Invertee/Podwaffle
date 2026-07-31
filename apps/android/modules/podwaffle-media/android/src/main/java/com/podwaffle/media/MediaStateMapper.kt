package com.podwaffle.media

import androidx.media3.common.MediaItem
import androidx.media3.common.Player

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
        if (player == null) return emptyState(hasLease, leaseExpiresAt, lastError)

        val currentMediaItem: MediaItem? = player.currentMediaItem
        val mediaMetadata = currentMediaItem?.mediaMetadata
        val extras = mediaMetadata?.extras
        val duration = if (player.duration > 0L) player.duration else null
        val position = player.currentPosition.coerceAtLeast(0L)
        val bufferedPosition = player.bufferedPosition.coerceAtLeast(0L)
        val queueLength = player.mediaItemCount
        val queueIndex = if (queueLength > 0) player.currentMediaItemIndex else 0

        return mapOf(
            "episodeId" to currentMediaItem?.mediaId?.takeIf { it.isNotBlank() },
            "podcastId" to extras?.getString("podcastId"),
            "title" to mediaMetadata?.title?.toString(),
            "podcastTitle" to (
                mediaMetadata?.artist?.toString()
                    ?: mediaMetadata?.albumTitle?.toString()
            ),
            "artworkUrl" to mediaMetadata?.artworkUri?.toString(),
            "durationMs" to duration,
            "positionMs" to position,
            "bufferedPositionMs" to bufferedPosition,
            "playbackStatus" to mapPlayerStatus(player.playbackState),
            "playWhenReady" to player.playWhenReady,
            "playbackRate" to player.playbackParameters.speed,
            "source" to (extras?.getString("source") ?: "stream"),
            "queueItemId" to extras?.getString("queueItemId"),
            "queueIndex" to queueIndex,
            "queueLength" to queueLength,
            "hasLease" to hasLease,
            "leaseExpiresAt" to leaseExpiresAt,
            "cast" to null,
            "lastError" to errorMap(lastError)
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

    private fun emptyState(
        hasLease: Boolean,
        leaseExpiresAt: String?,
        lastError: Pair<String, String>?
    ): Map<String, Any?> {
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
            "lastError" to errorMap(lastError)
        )
    }

    private fun errorMap(lastError: Pair<String, String>?): Map<String, String>? {
        return lastError?.let { mapOf("code" to it.first, "message" to it.second) }
    }
}
