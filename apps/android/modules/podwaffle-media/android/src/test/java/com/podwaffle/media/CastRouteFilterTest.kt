package com.podwaffle.media

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CastRouteFilterTest {
    @Test
    fun `group member speakers are hidden when enabled`() {
        listOf("Dining Room", "Kitchen", "Office Left", "Office Right").forEach { name ->
            assertFalse(CastRouteFilter.shouldShow(name, hideGroupSpeakers = true))
        }
    }

    @Test
    fun `group member speakers remain visible when disabled`() {
        assertTrue(CastRouteFilter.shouldShow("Dining Room", hideGroupSpeakers = false))
    }

    @Test
    fun `other cast routes remain visible`() {
        assertTrue(CastRouteFilter.shouldShow("Whole Home", hideGroupSpeakers = true))
    }
}
