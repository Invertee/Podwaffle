package com.podwaffle.media

import android.content.Context
import org.json.JSONObject

/**
 * App-private persistence for the native media configuration.
 *
 * Android Auto can start the media browser service without first opening the
 * React Native activity, so the service needs the last successful connection
 * details after a process restart. The preferences file remains private to the
 * Podwaffle application sandbox and is cleared when the device signs out.
 */
object NativeConfigurationPersistence {
    private const val PREFERENCES = "podwaffle.native.configuration.v1"
    private const val KEY_CONFIGURATION = "configuration"

    fun save(context: Context, configuration: NativeConfiguration) {
        val value = JSONObject().apply {
            put("serverBaseUrl", configuration.serverBaseUrl)
            put("deviceId", configuration.deviceId)
            put("deviceToken", configuration.deviceToken)
            put("profileId", configuration.profileId)
            put("skipBackwardMs", configuration.skipBackwardMs)
            put("skipForwardMs", configuration.skipForwardMs)
            put("downloadRetentionDays", configuration.downloadRetentionDays)
            put("maxDownloadStorageBytes", configuration.maxDownloadStorageBytes)
            put("revision", configuration.revision)
        }
        context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CONFIGURATION, value.toString())
            .apply()
        NativeConfigurationStore.current = configuration
        PodwaffleCacheMaintenanceJobService.schedule(context.applicationContext)
    }

    fun load(context: Context): NativeConfiguration? {
        NativeConfigurationStore.current?.let { return it }
        val raw = context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(KEY_CONFIGURATION, null)
            ?: return null
        return runCatching {
            val value = JSONObject(raw)
            NativeConfiguration(
                serverBaseUrl = value.getString("serverBaseUrl"),
                deviceId = value.getString("deviceId"),
                deviceToken = value.getString("deviceToken"),
                profileId = value.getString("profileId"),
                skipBackwardMs = value.optLong("skipBackwardMs", 15_000L)
                    .coerceIn(1_000L, 120_000L),
                skipForwardMs = value.optLong("skipForwardMs", 30_000L)
                    .coerceIn(1_000L, 120_000L),
                downloadRetentionDays = value.optInt("downloadRetentionDays", 30)
                    .coerceIn(1, 3650),
                maxDownloadStorageBytes = value.optLong(
                    "maxDownloadStorageBytes",
                    2_000_000_000L,
                ).coerceAtLeast(50_000_000L),
                revision = value.optLong("revision", 0L).coerceAtLeast(0L),
            )
        }.getOrNull()?.also { NativeConfigurationStore.current = it }
    }

    fun clear(context: Context) {
        context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
        PodwaffleCacheMaintenanceJobService.cancel(context.applicationContext)
        PodwaffleCachePolicy.clear(context.applicationContext)
        NativeConfigurationStore.current = null
        PodwaffleAutoCatalog.clear(context)
    }
}
