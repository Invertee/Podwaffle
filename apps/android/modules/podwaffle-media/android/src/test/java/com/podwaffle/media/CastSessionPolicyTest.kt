package com.podwaffle.media

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CastSessionPolicyTest {
    private val now = 2_000_000L

    @Test fun resumesRecentSessionsDuringTransientDisconnection() {
        assertTrue(CastSessionPolicy.canResume(true, now - 10_000L, now))
    }

    @Test fun expiresAtThirtyMinutesWithoutActivity() {
        assertTrue(CastSessionPolicy.canResume(true, now - CastSessionPolicy.IDLE_TIMEOUT_MS + 1L, now))
        assertFalse(CastSessionPolicy.canResume(true, now - CastSessionPolicy.IDLE_TIMEOUT_MS, now))
    }

    @Test fun neverRestoresAnOvernightSession() {
        assertFalse(CastSessionPolicy.canResume(true, now, now + 12 * 60 * 60 * 1000L))
    }

    @Test fun recoveryUsesTheSameBoundedWindowAsCastOwnership() {
        assertTrue(CastSessionPolicy.RECOVERY_TIMEOUT_MS == CastSessionPolicy.IDLE_TIMEOUT_MS)
    }

    @Test fun rejectsEndedAndLegacySessionsWithoutAnActivityTimestamp() {
        assertFalse(CastSessionPolicy.canResume(false, now, now))
        assertFalse(CastSessionPolicy.canResume(true, 0L, now))
    }

    @Test fun clockRollbackCannotExtendAnOldSession() {
        assertFalse(CastSessionPolicy.canResume(true, now + 1L, now))
    }
}
