package com.podwaffle.media

import android.content.Context
import org.json.JSONArray
import java.time.Instant

/** Device-local policy for retaining completed episode downloads. */
object PodwaffleCachePolicy {
    private const val PREFERENCES = "podwaffle.cache.policy.v1"
    private const val PLAYED_PREFIX = "played:"
    private const val PLAYBACK_PREFERENCES = "podwaffle.native.playback.v2"
    const val PLAYED_GRACE_MS = 24L * 60L * 60L * 1_000L

    fun markPlayed(context: Context, episodeId: String, playedAtMs: Long = System.currentTimeMillis()) {
        val profileId = currentProfileId(context) ?: return
        context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putLong(key(profileId, episodeId), playedAtMs)
            .apply()
    }

    fun markQueued(context: Context, episodeId: String) {
        val profileId = currentProfileId(context) ?: return
        context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .remove(key(profileId, episodeId))
            .apply()
    }

    fun clear(context: Context) {
        context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }

    fun protectedEpisodeIds(context: Context): Set<String> {
        val raw = context.applicationContext
            .getSharedPreferences(PLAYBACK_PREFERENCES, Context.MODE_PRIVATE)
            .getString("items", null)
            ?: return emptySet()
        return runCatching {
            val items = JSONArray(raw)
            buildSet {
                for (index in 0 until items.length()) {
                    val episodeId = items.getJSONObject(index).optString("episodeId")
                    if (episodeId.isNotBlank()) add(episodeId)
                }
            }
        }.getOrDefault(emptySet())
    }

    fun summary(store: PodwaffleDownloadStore): Map<String, Any?> {
        val completed = store.getDownloads().filter { it["state"] == "completed" }
        return mapOf(
            "completedCount" to completed.size,
            "completedBytes" to completed.sumOf {
                (it["progressBytes"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L
            },
        )
    }

    fun clearCompleted(
        context: Context,
        store: PodwaffleDownloadStore,
        protectedIds: Set<String> = protectedEpisodeIds(context),
    ): Map<String, Any?> = removeMatching(context, store) { download, _ ->
        download["state"] == "completed" &&
            (download["episodeId"] as? String) !in protectedIds
    }

    fun cleanupPlayed(
        context: Context,
        store: PodwaffleDownloadStore,
        protectedIds: Set<String> = protectedEpisodeIds(context),
        nowMs: Long = System.currentTimeMillis(),
        graceMs: Long = PLAYED_GRACE_MS,
    ): Map<String, Any?> {
        val profileId = currentProfileId(context)
            ?: return emptyResult()
        val preferences = context.applicationContext
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        return removeMatching(context, store) { download, episodeId ->
            if (download["state"] != "completed" || episodeId in protectedIds) {
                return@removeMatching false
            }
            val playedAt = preferences.getLong(key(profileId, episodeId), 0L)
            if (playedAt <= 0L) return@removeMatching false
            val downloadedAt = (download["downloadedAt"] as? String)
                ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                ?: 0L
            val retainFrom = maxOf(playedAt, downloadedAt)
            nowMs - retainFrom >= graceMs
        }
    }

    private fun removeMatching(
        context: Context,
        store: PodwaffleDownloadStore,
        shouldRemove: (Map<String, Any?>, String) -> Boolean,
    ): Map<String, Any?> {
        val profileId = currentProfileId(context)
        var removedCount = 0
        var freedBytes = 0L
        val errors = mutableListOf<String>()
        for (download in store.getDownloads()) {
            val episodeId = download["episodeId"] as? String ?: continue
            if (!shouldRemove(download, episodeId)) continue
            try {
                val bytes = (download["progressBytes"] as? Number)
                    ?.toLong()
                    ?.coerceAtLeast(0L)
                    ?: 0L
                if (store.remove(episodeId)) {
                    removedCount += 1
                    freedBytes += bytes
                    if (profileId != null) {
                        context.applicationContext
                            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                            .edit()
                            .remove(key(profileId, episodeId))
                            .apply()
                    }
                }
            } catch (error: Exception) {
                errors += "$episodeId: ${error.message ?: "cache cleanup failed"}"
            }
        }
        return mapOf(
            "removedCount" to removedCount,
            "freedBytes" to freedBytes,
            "errors" to errors,
        )
    }

    private fun currentProfileId(context: Context): String? =
        NativeConfigurationStore.current?.profileId
            ?: NativeConfigurationPersistence.load(context)?.profileId

    private fun key(profileId: String, episodeId: String): String =
        "$PLAYED_PREFIX$profileId:$episodeId"

    private fun emptyResult(): Map<String, Any?> = mapOf(
        "removedCount" to 0,
        "freedBytes" to 0L,
        "errors" to emptyList<String>(),
    )
}
