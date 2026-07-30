package com.podwaffle.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PodwaffleMediaModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "ReactContext is null" }

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
            // Store configuration for server sync / lease renewal in future milestones
            true
        }

        AsyncFunction("bind") {
            ensureServiceStarted()
            val service = PodwaffleMediaService.instance
            val player = service?.getPlayer()
            MediaStateMapper.mapStateToMap(player)
        }

        AsyncFunction("getState") {
            val service = PodwaffleMediaService.instance
            val player = service?.getPlayer()
            MediaStateMapper.mapStateToMap(player)
        }

        AsyncFunction("play") {
            ensureServiceStarted()
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.playWhenReady = true
            player?.play()
            val stateMap = MediaStateMapper.mapStateToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.state.changed", stateMap)
        }

        AsyncFunction("pause") {
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.pause()
            val stateMap = MediaStateMapper.mapStateToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.state.changed", stateMap)
        }

        AsyncFunction("stop") {
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.stop()
            val stateMap = MediaStateMapper.mapStateToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.state.changed", stateMap)
        }

        AsyncFunction("seekTo") { positionMs: Long ->
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.seekTo(positionMs.coerceAtLeast(0L))
            val posMap = MediaStateMapper.mapPositionToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.position.changed", posMap)
        }

        AsyncFunction("skipForward") {
            val player = PodwaffleMediaService.instance?.getPlayer() ?: return@AsyncFunction
            val newPos = (player.currentPosition + 30000L).coerceAtMost(player.duration.coerceAtLeast(0L))
            player.seekTo(newPos)
            val posMap = MediaStateMapper.mapPositionToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.position.changed", posMap)
        }

        AsyncFunction("skipBackward") {
            val player = PodwaffleMediaService.instance?.getPlayer() ?: return@AsyncFunction
            val newPos = (player.currentPosition - 15000L).coerceAtLeast(0L)
            player.seekTo(newPos)
            val posMap = MediaStateMapper.mapPositionToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.position.changed", posMap)
        }

        AsyncFunction("setPlaybackRate") { rate: Float ->
            val player = PodwaffleMediaService.instance?.getPlayer()
            player?.playbackParameters = PlaybackParameters(rate)
            val stateMap = MediaStateMapper.mapStateToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.state.changed", stateMap)
        }

        AsyncFunction("playEpisode") { input: Map<String, Any?>, startPositionMs: Long ->
            ensureServiceStarted()
            val player = PodwaffleMediaService.instance?.getPlayer() ?: return@AsyncFunction

            val episodeId = input["episodeId"] as? String ?: "episode"
            val title = input["title"] as? String ?: "Episode"
            val podcastTitle = input["podcastTitle"] as? String ?: "Podcast"
            val enclosureUrl = input["enclosureUrl"] as? String ?: ""
            val artworkUrl = input["artworkUrl"] as? String

            val mediaItem = MediaItem.Builder()
                .setMediaId(episodeId)
                .setUri(Uri.parse(enclosureUrl))
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(title)
                        .setArtist(podcastTitle)
                        .setArtworkUri(artworkUrl?.let { Uri.parse(it) })
                        .build()
                )
                .build()

            player.setMediaItem(mediaItem, startPositionMs)
            player.prepare()
            player.playWhenReady = true
            player.play()

            val stateMap = MediaStateMapper.mapStateToMap(player)
            this@PodwaffleMediaModule.sendEvent("media.state.changed", stateMap)
        }

        // Stubs for future milestone interfaces (Cast / Downloads / Queue)
        AsyncFunction("setQueue") { input: Map<String, Any?> -> true }
        AsyncFunction("showCastPicker") { true }
        AsyncFunction("stopCast") { input: Map<String, Any?> -> true }
        AsyncFunction("getCastState") { mapOf("connected" to false, "session" to null, "availableDevices" to emptyList<String>()) }
        AsyncFunction("setCastVolume") { volume: Float -> true }
        AsyncFunction("addDownload") { input: Map<String, Any?>, reason: String -> true }
        AsyncFunction("removeDownload") { episodeId: String -> true }
        AsyncFunction("getDownloads") { emptyList<Map<String, Any?>>() }
        AsyncFunction("runDownloadMaintenance") { mapOf("removedCount" to 0, "freedBytes" to 0L, "errors" to emptyList<String>()) }
    }

    private fun ensureServiceStarted() {
        if (PodwaffleMediaService.instance == null) {
            val intent = Intent(context, PodwaffleMediaService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
