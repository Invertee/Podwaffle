package com.podwaffle.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object NotificationHelper {
    const val PLAYBACK_CHANNEL_ID = "podwaffle_playback_channel_v2"
    const val PLAYBACK_NOTIFICATION_ID = 1002
    private const val LEGACY_DOWNLOAD_CHANNEL_ID = "podwaffle_download_channel"

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                PLAYBACK_CHANNEL_ID,
                "Podwaffle playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Podcast playback and lock-screen controls"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            },
        )
        manager.deleteNotificationChannel(LEGACY_DOWNLOAD_CHANNEL_ID)
    }
}
