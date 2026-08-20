package com.podwaffle.media

import org.junit.Assert.assertEquals
import org.junit.Test

class QueueSelectionTest {
    @Test
    fun preservesPositionWhenTheCurrentEpisodeRemainsInTheQueue() {
        assertEquals(
            QueueSelection(index = 1, positionMs = 58_000L),
            reconcileQueueSelection(
                candidateIds = listOf("next", "current"),
                currentId = "current",
                currentPositionMs = 58_000L,
                requestedIndex = 0,
            ),
        )
    }

    @Test
    fun resetsPositionWhenQueueRefreshSelectsADifferentEpisode() {
        assertEquals(
            QueueSelection(index = 0, positionMs = 0L),
            reconcileQueueSelection(
                candidateIds = listOf("next", "later"),
                currentId = "completed",
                currentPositionMs = 58_000L,
                requestedIndex = 0,
            ),
        )
    }
}
