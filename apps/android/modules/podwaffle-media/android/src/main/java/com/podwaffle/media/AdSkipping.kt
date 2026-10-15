package com.podwaffle.media

import org.json.JSONArray
import org.json.JSONObject

data class AdRegion(val startMs: Long, val endMs: Long)

object AdSkipping {
    fun publisherFallback(media: EpisodeMedia): EpisodeMedia? = media.analysedUrl?.let {
        media.copy(analysedUrl = null, analysisSha256 = null, adSegments = "[]", localDownloadPath = null)
    }
    fun parse(raw: String?): List<AdRegion> = runCatching {
        val array = JSONArray(raw ?: "[]")
        buildList {
            for (index in 0 until array.length().coerceAtMost(2000)) {
                val item = array.optJSONObject(index) ?: continue
                val start = item.optLong("startMs", -1L)
                val end = item.optLong("endMs", -1L)
                if (start >= 0L && end > start && end <= 8L * 3_600_000L) add(AdRegion(start, end))
            }
        }.sortedBy { it.startMs }
    }.getOrDefault(emptyList())

    fun target(positionMs: Long, durationMs: Long, regions: List<AdRegion>): Long? {
        var target = positionMs
        for (region in regions.sortedBy { it.startMs }) {
            if (region.startMs <= target && target < region.endMs) target = region.endMs
        }
        // Never seek past the end: normal completion still advances the queue.
        return target.takeIf { it > positionMs }?.coerceAtMost((durationMs - 100L).coerceAtLeast(0L))
            ?.takeIf { it > positionMs }
    }

    fun json(regions: List<AdRegion>): String = JSONArray(regions.map {
        JSONObject().put("startMs", it.startMs).put("endMs", it.endMs)
    }).toString()
}
