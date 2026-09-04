package com.podwaffle.media

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    @Test
    fun keepsTheCurrentCastItemLoadedWhenOnlyTheFutureQueueChanges() {
        assertTrue(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = true,
                currentId = "current",
                currentIndex = 0,
                candidateIds = listOf("current", "next", "new"),
            ),
        )
        assertFalse(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = true,
                currentId = "current",
                currentIndex = 1,
                candidateIds = listOf("previous", "current", "next"),
            ),
        )
        assertFalse(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = true,
                currentId = "current",
                currentIndex = 0,
                candidateIds = listOf("replacement", "next"),
            ),
        )
        assertFalse(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = false,
                currentId = "current",
                currentIndex = 0,
                candidateIds = listOf("current", "next"),
            ),
        )
    }

    @Test
    fun holdsLocalPlaybackDuringTransientOrSavedCastRecovery() {
        assertTrue(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = false,
                pendingCastRequest = false,
                hadActiveCast = true,
                savedCastAuthority = false,
            ),
        )
        assertTrue(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = false,
                pendingCastRequest = false,
                hadActiveCast = false,
                savedCastAuthority = true,
            ),
        )
        assertFalse(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = true,
                pendingCastRequest = false,
                hadActiveCast = true,
                savedCastAuthority = true,
            ),
        )
        assertFalse(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = false,
                pendingCastRequest = true,
                hadActiveCast = true,
                savedCastAuthority = true,
            ),
        )
    }

    @Test
    fun adoptsOnlyKnownOrRecoveringCastSessions() {
        val known = listOf("current", "next")
        assertTrue(
            shouldAdoptExistingCastSession(
                sessionAvailable = true,
                recoveryExpected = false,
                currentMediaId = "current",
                knownMediaIds = known,
            ),
        )
        assertTrue(
            shouldAdoptExistingCastSession(
                sessionAvailable = true,
                recoveryExpected = true,
                currentMediaId = null,
                knownMediaIds = known,
            ),
        )
        assertFalse(
            shouldAdoptExistingCastSession(
                sessionAvailable = true,
                recoveryExpected = false,
                currentMediaId = "another-app",
                knownMediaIds = known,
            ),
        )
        assertFalse(
            shouldAdoptExistingCastSession(
                sessionAvailable = false,
                recoveryExpected = true,
                currentMediaId = "current",
                knownMediaIds = known,
            ),
        )
    }

    @Test
    fun suppressesOnlyUnexpectedAutomaticTransitionsDuringCastStartup() {
        assertTrue(
            shouldSuppressCastStartupTransition(
                Player.MEDIA_ITEM_TRANSITION_REASON_AUTO,
                guardActive = true,
                expectedMediaId = "current",
                transitionedMediaId = "next",
            ),
        )
        assertFalse(
            shouldSuppressCastStartupTransition(
                Player.MEDIA_ITEM_TRANSITION_REASON_AUTO,
                guardActive = true,
                expectedMediaId = "current",
                transitionedMediaId = "current",
            ),
        )
        assertFalse(
            shouldSuppressCastStartupTransition(
                Player.MEDIA_ITEM_TRANSITION_REASON_SEEK,
                guardActive = true,
                expectedMediaId = "current",
                transitionedMediaId = "next",
            ),
        )
    }

    @Test
    fun guardsOnlyUnfinishedCastStartupPositions() {
        assertTrue(shouldGuardCastStartupPosition(positionMs = 120_000L, durationMs = 3_600_000L))
        assertFalse(shouldGuardCastStartupPosition(positionMs = 3_596_000L, durationMs = 3_600_000L))
        assertTrue(shouldGuardCastStartupPosition(positionMs = 120_000L, durationMs = null))
    }
}
