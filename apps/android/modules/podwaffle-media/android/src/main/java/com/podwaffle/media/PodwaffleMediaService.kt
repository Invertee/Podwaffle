package com.podwaffle.media

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

class PodwaffleMediaService : MediaSessionService() {

    private var exoPlayer: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private val handler = Handler(Looper.getMainLooper())
    private var positionNotifierRunnable: Runnable? = null

    companion object {
        var instance: PodwaffleMediaService? = null
            private set

        var eventEmitter: ((eventName: String, params: Map<String, Any?>) -> Unit)? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        NotificationHelper.createNotificationChannel(this)

        val player = ExoPlayer.Builder(this).build()
        this.exoPlayer = player

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                notifyStateChanged()
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                notifyStateChanged()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                notifyStateChanged()
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                notifyStateChanged(error = Pair(error.errorCodeName, error.message ?: "Playback error"))
            }
        })

        // Create MediaSession
        mediaSession = MediaSession.Builder(this, player).build()

        // Load default test media for Milestone 14 spike
        val testMediaItem = MediaItem.Builder()
            .setMediaId("test-episode-m14")
            .setUri(Uri.parse("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle("Test Episode (Milestone 14 Spike)")
                    .setArtist("Podwaffle Android Native")
                    .setAlbumTitle("Podwaffle Feasibility Test")
                    .build()
            )
            .build()

        player.setMediaItem(testMediaItem)
        player.prepare()

        startPositionUpdates()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    fun getPlayer(): ExoPlayer? = exoPlayer

    fun notifyStateChanged(error: Pair<String, String>? = null) {
        val player = exoPlayer ?: return
        val map = MediaStateMapper.mapStateToMap(player, lastError = error)
        eventEmitter?.invoke("media.state.changed", map)
    }

    private fun startPositionUpdates() {
        positionNotifierRunnable = object : Runnable {
            override fun run() {
                val player = exoPlayer
                if (player != null && player.isPlaying) {
                    val posMap = MediaStateMapper.mapPositionToMap(player)
                    eventEmitter?.invoke("media.position.changed", posMap)
                }
                handler.postDelayed(this, 1000L)
            }
        }
        handler.post(positionNotifierRunnable!!)
    }

    override fun onDestroy() {
        positionNotifierRunnable?.let { handler.removeCallbacks(it) }
        mediaSession?.run {
            player.release()
            release()
            mediaSession = null
        }
        exoPlayer = null
        instance = null
        super.onDestroy()
    }
}
