package com.podwaffle.media

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaStateMapperTest {
    @Test
    fun mapsPlayerStatuses() {
        assertEquals("idle", MediaStateMapper.mapPlayerStatus(Player.STATE_IDLE))
        assertEquals("buffering", MediaStateMapper.mapPlayerStatus(Player.STATE_BUFFERING))
        assertEquals("ready", MediaStateMapper.mapPlayerStatus(Player.STATE_READY))
        assertEquals("ended", MediaStateMapper.mapPlayerStatus(Player.STATE_ENDED))
    }

    @Test
    fun mapsAnEmptyPlayerState() {
        val result = MediaStateMapper.mapStateToMap(null)
        assertNull(result["episodeId"])
        assertEquals(0L, result["positionMs"])
        assertEquals("idle", result["playbackStatus"])
        assertEquals(false, result["playWhenReady"])
        assertEquals("stream", result["source"])
    }

    @Test
    fun parsesQueueAndClampsItsCurrentIndex() {
        val queue = QueueSnapshot.fromMap(
            mapOf(
                "currentIndex" to 99,
                "items" to listOf(
                    mapOf(
                        "episodeId" to "episode-1",
                        "podcastId" to "podcast-1",
                        "title" to "Episode",
                        "podcastTitle" to "Podcast",
                        "enclosureUrl" to "https://example.test/episode.mp3",
                    ),
                ),
            ),
        )
        assertEquals(1, queue.items.size)
        assertEquals(0, queue.currentIndex)
    }

    @Test
    fun castSnapshotOnlyExposesASessionWhenConnected() {
        val idle = CastPlaybackSnapshot(available = true)
        assertNull(idle.sessionMap())
        assertFalse(idle.toMap()["connected"] as Boolean)

        val connected = CastPlaybackSnapshot(
            available = true,
            connected = true,
            sessionId = "session-1",
            deviceName = "Kitchen speaker",
            playerState = "paused",
            positionMs = 42_000L,
        )
        assertTrue(connected.toMap()["connected"] as Boolean)
        assertEquals("session-1", connected.sessionMap()?.get("sessionId"))
        assertEquals(42_000L, connected.sessionMap()?.get("positionMs"))
    }
}
