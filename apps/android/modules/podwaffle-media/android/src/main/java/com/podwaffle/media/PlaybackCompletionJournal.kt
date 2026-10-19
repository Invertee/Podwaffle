package com.podwaffle.media

import android.content.Context
import androidx.media3.common.MediaItem
import org.json.JSONObject

/** Durable media ends, including those observed while the JS bridge is asleep. */
internal class PlaybackCompletionJournal(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "podwaffle.playback.completions.v1", Context.MODE_PRIVATE,
    )

    private fun profileId(): String? = NativeConfigurationStore.current?.profileId

    fun record(episodeId: String, queueItemId: String?, positionMs: Long, durationMs: Long, source: String) {
        val profile = profileId() ?: return
        val value = JSONObject().apply {
            put("episodeId", episodeId)
            put("positionMs", positionMs)
            put("durationMs", durationMs)
            put("source", source)
            put("queueItemId", queueItemId ?: JSONObject.NULL)
        }
        // Commit before removing the native queue entry so a process death
        // cannot lose the only evidence of completion.
        preferences.edit().putString("$profile:$episodeId", value.toString()).commit()
    }

    fun pending(): List<Map<String, Any?>> {
        val profile = profileId() ?: return emptyList()
        return preferences.all.filterKeys { it.startsWith("$profile:") }
            .values.mapNotNull { raw ->
                runCatching {
                    val value = JSONObject(raw as String)
                    if (value.optBoolean("acknowledged", false)) return@runCatching null
                    mapOf<String, Any?>(
                        "episodeId" to value.getString("episodeId"),
                        "positionMs" to value.getLong("positionMs"),
                        "durationMs" to value.getLong("durationMs"),
                        "source" to value.getString("source"),
                    )
                }.getOrNull()
            }
    }

    fun acknowledge(episodeId: String) {
        val profile = profileId() ?: return
        val raw = preferences.getString("$profile:$episodeId", null) ?: return
        val value = JSONObject(raw).put("acknowledged", true)
        preferences.edit().putString("$profile:$episodeId", value.toString()).commit()
    }

    fun allowReplay(episodeId: String) {
        val profile = profileId() ?: return
        preferences.edit().remove("$profile:$episodeId").commit()
    }

    fun clear() {
        preferences.edit().clear().commit()
    }

    fun excludeCompleted(items: List<MediaItem>): List<MediaItem> {
        val profile = profileId() ?: return items.distinctBy { it.mediaId }
        return items.distinctBy { it.mediaId }.filter { item ->
            val raw = preferences.getString("$profile:${item.mediaId}", null)
            if (raw == null) true else {
                val completedQueueId = JSONObject(raw).optString("queueItemId")
                val queuedId = EpisodeMedia.fromMediaItem(item)?.queueItemId
                // A newly created queue row is an intentional replay. A stale
                // snapshot of the completed row must never restore it.
                queuedId != null && completedQueueId.isNotBlank() &&
                    completedQueueId != "null" && queuedId != completedQueueId
            }
        }
    }
}
