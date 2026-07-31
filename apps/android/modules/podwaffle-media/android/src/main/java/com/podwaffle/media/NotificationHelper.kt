package com.podwaffle.media

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object NotificationHelper {
    const val PLAYBACK_CHANNEL_ID = "podwaffle_playback_channel"
    const val DOWNLOAD_CHANNEL_ID = "podwaffle_download_channel"
    const val PLAYBACK_NOTIFICATION_ID = 1001

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                PLAYBACK_CHANNEL_ID,
                "Podwaffle playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Podcast playback controls"
                setSound(null, null)
                enableVibration(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                DOWNLOAD_CHANNEL_ID,
                "Podwaffle downloads",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Podcast download progress"
                setSound(null, null)
                enableVibration(false)
            },
        )
    }
}
