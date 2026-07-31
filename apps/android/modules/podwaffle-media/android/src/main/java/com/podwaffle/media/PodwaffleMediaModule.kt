package com.podwaffle.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class PodwaffleMediaModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "ReactContext is null" }

    private var skipBackwardMs = 15_000L
    private var skipForwardMs = 30_000L

    override fun definition() = ModuleDefinition {
        Name("PodwaffleMedia")

        Events(
            "media.state.changed",
            "media.position.changed",
            "media.metadata.changed",
            "media.queue.changed",
            "media.error",
            "media.audio-focus.changed",
            "cast.state.changed",
            "cast.volume.changed",
            "download.state.changed",
            "download.maintenance.completed",
            "native.connection.changed",
            "native.command.result"
        )

        OnCreate {
            PodwaffleMediaService.eventEmitter = { eventName, params ->
                this@PodwaffleMediaModule.sendEvent(eventName, params)
            }
        }

        OnDestroy {
            PodwaffleMediaService.eventEmitter = null
        }

        AsyncFunction("configure") { config: Map<String, Any?> ->
            skipBackwardMs = ((config["skipBackSeconds"] as? Number)?.toLong() ?: 15L)
                .coerceIn(1L, 120L) * 1_000L
            skipForwardMs = ((config["skipForwardSeconds"] as? Number)?.toLong() ?: 30L)
                .coerceIn(1L, 120L) * 1_000L
            true
        }

        AsyncFunction("bind") {
            ensureServiceStarted()
            val player = PodwaffleMediaService.instance?.getPlayer()
            MediaStateMapper.mapStateToMap(player)
        }

        AsyncFunction("getState") {
            val player = PodwaffleMediaService.instance?.getPlayer()
            MediaStateMapper.mapStateToMap(player)
        }

        AsyncFunction("play") {
            ensureServiceStarted()
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.playWhenReady = true
            player?.play()
            emitState(player)
        }

        AsyncFunction("pause") {
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.pause()
            emitState(player)
        }

        AsyncFunction("stop") {
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.stop()
            player?.clearMediaItems()
            emitState(player)
        }

        AsyncFunction("seekTo") { positionMs: Long ->
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.seekTo(positionMs.coerceAtLeast(0L))
            emitPosition(player)
        }

        AsyncFunction("skipForward") {
            val player = PodwaffleMediaService.instance?.getPlayer()
                ?: return@AsyncFunction null
            val requested = (player.currentPosition + skipForwardMs).coerceAtLeast(0L)
            val newPosition = if (player.duration > 0L) {
                requested.coerceAtMost(player.duration)
            } else {
                requested
            }
            player.seekTo(newPosition)
            emitPosition(player)
        }

        AsyncFunction("skipBackward") {
            val player = PodwaffleMediaService.instance?.getPlayer()
                ?: return@AsyncFunction null
            player.seekTo((player.currentPosition - skipBackwardMs).coerceAtLeast(0L))
            emitPosition(player)
        }

        AsyncFunction("setPlaybackRate") { rate: Float ->
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.playbackParameters = PlaybackParameters(rate.coerceIn(0.5f, 4f))
            emitState(player)
        }

        AsyncFunction("playEpisode") { input: Map<String, Any?>, startPositionMs: Long ->
            ensureServiceStarted()
            val player = PodwaffleMediaService.instance?.getPlayer()
                ?: throw IllegalStateException("The media service is not ready")

            val episodeId = input["episodeId"] as? String
                ?: throw IllegalArgumentException("episodeId is required")
            val podcastId = input["podcastId"] as? String
            val title = input["title"] as? String ?: "Episode"
            val podcastTitle = input["podcastTitle"] as? String ?: "Podcast"
            val enclosureUrl = input["enclosureUrl"] as? String
            val localDownloadPath = input["localDownloadPath"] as? String
            val artworkUrl = input["artworkUrl"] as? String
            val queueItemId = input["queueItemId"] as? String

            val mediaUri = when {
                !localDownloadPath.isNullOrBlank() -> Uri.fromFile(File(localDownloadPath))
                !enclosureUrl.isNullOrBlank() -> Uri.parse(enclosureUrl)
                else -> throw IllegalArgumentException("A playable enclosure URL is required")
            }
            val extras = Bundle().apply {
                podcastId?.let { putString("podcastId", it) }
                queueItemId?.let { putString("queueItemId", it) }
                putString(
                    "source",
                    if (localDownloadPath.isNullOrBlank()) "stream" else "download"
                )
            }
            val metadata = MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(podcastTitle)
                .setAlbumTitle(podcastTitle)
                .setArtworkUri(artworkUrl?.let { Uri.parse(it) })
                .setExtras(extras)
                .build()
            val mediaItem = MediaItem.Builder()
                .setMediaId(episodeId)
                .setUri(mediaUri)
                .setMediaMetadata(metadata)
                .build()

            player.setMediaItem(mediaItem, startPositionMs.coerceAtLeast(0L))
            player.prepare()
            player.playWhenReady = true
            player.play()
            emitState(player)
        }

        // Queue, Cast, and downloads are delivered by later milestones.
        AsyncFunction("setQueue") { input: Map<String, Any?> -> true }
        AsyncFunction("showCastPicker") { true }
        AsyncFunction("stopCast") { input: Map<String, Any?> -> true }
        AsyncFunction("getCastState") {
            mapOf(
                "connected" to false,
                "session" to null,
                "availableDevices" to emptyList<String>()
            )
        }
        AsyncFunction("setCastVolume") { volume: Float -> true }
        AsyncFunction("addDownload") { input: Map<String, Any?>, reason: String -> true }
        AsyncFunction("removeDownload") { episodeId: String -> true }
        AsyncFunction("getDownloads") { emptyList<Map<String, Any?>>() }
        AsyncFunction("runDownloadMaintenance") {
            mapOf(
                "removedCount" to 0,
                "freedBytes" to 0L,
                "errors" to emptyList<String>()
            )
        }
    }

    private fun emitState(player: androidx.media3.common.Player?) {
        val stateMap = MediaStateMapper.mapStateToMap(player)
        sendEvent("media.state.changed", stateMap)
    }

    private fun emitPosition(player: androidx.media3.common.Player?) {
        val positionMap = MediaStateMapper.mapPositionToMap(player)
        sendEvent("media.position.changed", positionMap)
    }

    private fun ensureServiceStarted() {
        if (PodwaffleMediaService.instance == null) {
            // Commands originate while the app is foregrounded. MediaSessionService
            // promotes itself when playback starts and owns the notification.
            context.startService(Intent(context, PodwaffleMediaService::class.java))
        }
    }
}
