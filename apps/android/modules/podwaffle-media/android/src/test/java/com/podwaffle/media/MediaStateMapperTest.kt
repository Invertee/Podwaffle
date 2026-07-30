package com.podwaffle.media

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaStateMapperTest {

    @Test
    fun testMapPlayerStatus() {
        assertEquals("idle", MediaStateMapper.mapPlayerStatus(Player.STATE_IDLE))
        assertEquals("buffering", MediaStateMapper.mapPlayerStatus(Player.STATE_BUFFERING))
        assertEquals("ready", MediaStateMapper.mapPlayerStatus(Player.STATE_READY))
        assertEquals("ended", MediaStateMapper.mapPlayerStatus(Player.STATE_ENDED))
    }

    @Test
    fun testNullPlayerMapping() {
        val result = MediaStateMapper.mapStateToMap(null)
        assertNull(result["episodeId"])
        assertEquals(0L, result["positionMs"])
        assertEquals("idle", result["playbackStatus"])
        assertEquals(false, result["playWhenReady"])
    }
}
