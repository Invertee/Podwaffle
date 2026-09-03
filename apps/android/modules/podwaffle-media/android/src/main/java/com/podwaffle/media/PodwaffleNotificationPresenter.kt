package com.podwaffle.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/** Posts decrypted Home Assistant messages without relying on a scheduled task. */
object PodwaffleNotificationPresenter {
    private const val CHANNEL_ID = "podwaffle-messages"
    private const val CHANNEL_NAME = "Podwaffle messages"
    private const val CHANNEL_DESCRIPTION =
        "Messages sent to this profile from Home Assistant"

    fun show(context: Context, input: Map<String, Any?>): Map<String, Any?> {
        val identifier = input.string("identifier")
        val title = input.string("title").trim()
        val message = input.string("message").trim()
        require(title.isNotEmpty() && title.length <= 200) {
            "Invalid notification title"
        }
        require(message.isNotEmpty() && message.length <= 2_000) {
            "Invalid notification message"
        }

        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannel(manager)
        val notificationId = notificationId(identifier)
        val channelImportance = manager.getNotificationChannel(CHANNEL_ID)?.importance
        val notificationsEnabled = manager.areNotificationsEnabled()

        if (!notificationsEnabled) {
            return result(
                shown = false,
                notificationId = notificationId,
                notificationsEnabled = false,
                channelImportance = channelImportance,
                reason = "App notifications are disabled",
            )
        }
        if (channelImportance == NotificationManager.IMPORTANCE_NONE) {
            return result(
                shown = false,
                notificationId = notificationId,
                notificationsEnabled = true,
                channelImportance = channelImportance,
                reason = "The Podwaffle messages notification channel is disabled",
            )
        }

        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(notificationIcon(context))
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setContentIntent(launchIntent(context))
            .build()

        manager.notify(notificationId, notification)
        return result(
            shown = true,
            notificationId = notificationId,
            notificationsEnabled = true,
            channelImportance = channelImportance,
            reason = null,
        )
    }

    internal fun notificationId(identifier: String): Int =
        identifier.hashCode() and Int.MAX_VALUE

    private fun ensureChannel(manager: NotificationManager) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = CHANNEL_DESCRIPTION
            enableVibration(true)
            vibrationPattern = longArrayOf(0L, 250L, 150L, 250L)
        }
        manager.createNotificationChannel(channel)
    }

    private fun launchIntent(context: Context): PendingIntent? {
        val intent = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            ?: return null
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun notificationIcon(context: Context): Int {
        val resources = context.resources
        val packageName = context.packageName
        return sequenceOf("notification_icon", "expo_notification_icon")
            .map { resources.getIdentifier(it, "drawable", packageName) }
            .firstOrNull { it != 0 }
            ?: context.applicationInfo.icon.takeIf { it != 0 }
            ?: android.R.drawable.ic_dialog_info
    }

    private fun result(
        shown: Boolean,
        notificationId: Int,
        notificationsEnabled: Boolean,
        channelImportance: Int?,
        reason: String?,
    ): Map<String, Any?> = mapOf(
        "shown" to shown,
        "notificationId" to notificationId,
        "notificationsEnabled" to notificationsEnabled,
        "channelImportance" to channelImportance,
        "reason" to reason,
    )

    private fun Map<String, Any?>.string(key: String): String =
        this[key] as? String ?: throw IllegalArgumentException("Missing notification $key")
}
