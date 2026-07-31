package com.podwaffle.media

import androidx.media3.common.MediaItem
import androidx.media3.common.Player

object MediaStateMapper {
    fun mapPlayerStatus(playbackState: Int): String = when (playbackState) {
        Player.STATE_IDLE -> "idle"
        Player.STATE_BUFFERING -> "buffering"
        Player.STATE_READY -> "ready"
        Player.STATE_ENDED -> "ended"
        else -> "idle"
    }

    fun mapStateToMap(
        player: Player?,
        cast: CastPlaybackSnapshot? = null,
        hasLease: Boolean = false,
        leaseExpiresAt: String? = null,
        lastError: Pair<String, String>? = null,
    ): Map<String, Any?> {
        if (player == null) return emptyState(hasLease, leaseExpiresAt, lastError)

        val item: MediaItem? = player.currentMediaItem
        val metadata = item?.mediaMetadata
        val extras = metadata?.extras
        val playerDuration = player.duration.takeIf { it > 0 }
        val metadataDuration = extras
            ?.takeIf { it.containsKey("durationMs") }
            ?.getLong("durationMs")
            ?.takeIf { it > 0 }
        val uriScheme = item?.localConfiguration?.uri?.scheme?.lowercase()
        val source = when {
            cast?.connected == true -> "cast"
            uriScheme == "file" || uriScheme == "content" -> "download"
            else -> "stream"
        }
        val confirmedPosition = cast
            ?.takeIf { it.connected }
            ?.positionMs
            ?: player.currentPosition.coerceAtLeast(0L)
        val confirmedDuration = cast
            ?.takeIf { it.connected }
            ?.durationMs
            ?: playerDuration
            ?: metadataDuration

        return mapOf(
            "episodeId" to (cast?.episode?.episodeId ?: item?.mediaId),
            "podcastId" to (cast?.episode?.podcastId ?: extras?.getString("podcastId")),
            "title" to (cast?.episode?.title ?: metadata?.title?.toString()),
            "podcastTitle" to (
                cast?.episode?.podcastTitle
                    ?: metadata?.artist?.toString()
                    ?: metadata?.albumArtist?.toString()
                ),
            "artworkUrl" to (cast?.episode?.artworkUrl ?: metadata?.artworkUri?.toString()),
            "durationMs" to confirmedDuration,
            "positionMs" to confirmedPosition,
            "bufferedPositionMs" to if (cast?.connected == true) {
                confirmedPosition
            } else {
                player.bufferedPosition.coerceAtLeast(0L)
            },
            "playbackStatus" to if (cast?.connected == true) {
                when {
                    cast.buffering -> "buffering"
                    cast.playerState == "idle" -> "idle"
                    else -> "ready"
                }
            } else {
                mapPlayerStatus(player.playbackState)
            },
            "playWhenReady" to if (cast?.connected == true) cast.playing else player.playWhenReady,
            "playbackRate" to player.playbackParameters.speed,
            "source" to source,
            "queueItemId" to (cast?.episode?.queueItemId ?: extras?.getString("queueItemId")),
            "queueIndex" to player.currentMediaItemIndex.coerceAtLeast(0),
            "queueLength" to player.mediaItemCount,
            "hasLease" to hasLease,
            "leaseExpiresAt" to leaseExpiresAt,
            "cast" to cast?.sessionMap(),
            "lastError" to lastError?.let { error ->
                mapOf("code" to error.first, "message" to error.second)
            },
        )
    }

    fun mapPositionToMap(
        player: Player?,
        cast: CastPlaybackSnapshot? = null,
    ): Map<String, Any> {
        val castPosition = cast?.takeIf { it.connected }?.positionMs
        return mapOf(
            "positionMs" to (castPosition ?: player?.currentPosition?.coerceAtLeast(0L) ?: 0L),
            "bufferedPositionMs" to (
                castPosition ?: player?.bufferedPosition?.coerceAtLeast(0L) ?: 0L
                ),
        )
    }

    private fun emptyState(
        hasLease: Boolean,
        leaseExpiresAt: String?,
        lastError: Pair<String, String>?,
    ): Map<String, Any?> = mapOf(
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
        "lastError" to lastError?.let { error ->
            mapOf("code" to error.first, "message" to error.second)
        },
    )
}
