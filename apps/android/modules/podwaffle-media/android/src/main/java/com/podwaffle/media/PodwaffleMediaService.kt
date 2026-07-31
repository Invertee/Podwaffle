package com.podwaffle.media

import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
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

        val player = ExoPlayer.Builder(this).build().apply {
            setHandleAudioBecomingNoisy(true)
        }
        exoPlayer = player

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

            override fun onPlaybackParametersChanged(
                playbackParameters: androidx.media3.common.PlaybackParameters
            ) {
                notifyStateChanged()
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                notifyStateChanged(
                    error = Pair(error.errorCodeName, error.message ?: "Playback error")
                )
            }
        })

        mediaSession = MediaSession.Builder(this, player).build()
        startPositionUpdates()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    fun getPlayer(): ExoPlayer? = exoPlayer

    fun notifyStateChanged(error: Pair<String, String>? = null) {
        val map = MediaStateMapper.mapStateToMap(exoPlayer, lastError = error)
        eventEmitter?.invoke("media.state.changed", map)
    }

    private fun startPositionUpdates() {
        positionNotifierRunnable = object : Runnable {
            override fun run() {
                val player = exoPlayer
                if (player != null && player.isPlaying) {
                    eventEmitter?.invoke(
                        "media.position.changed",
                        MediaStateMapper.mapPositionToMap(player)
                    )
                }
                handler.postDelayed(this, 1_000L)
            }
        }
        handler.post(positionNotifierRunnable!!)
    }

    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        // Keep the MediaSessionService alive while audio is playing. If playback
        // is paused or stopped, allow Android to reclaim it with the task.
        if (exoPlayer?.isPlaying != true) stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        positionNotifierRunnable?.let { handler.removeCallbacks(it) }
        mediaSession?.release()
        mediaSession = null
        exoPlayer?.release()
        exoPlayer = null
        instance = null
        super.onDestroy()
    }
}
