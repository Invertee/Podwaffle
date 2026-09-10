package com.podwaffle.media

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CastSessionPolicyTest {
    private val now = 2_000_000L

    @Test fun resumesRecentSessionsDuringTransientDisconnection() {
        assertTrue(CastSessionPolicy.canResume(true, now - 10_000L, now + 20_000L, now))
        assertTrue(CastSessionPolicy.canResume(true, now - 10_000L, 0L, now))
    }

    @Test fun expiresAtThirtyMinutesWithoutActivity() {
        assertTrue(CastSessionPolicy.canResume(true, now - CastSessionPolicy.IDLE_TIMEOUT_MS + 1L, 0L, now))
        assertFalse(CastSessionPolicy.canResume(true, now - CastSessionPolicy.IDLE_TIMEOUT_MS, 0L, now))
    }

    @Test fun neverRestoresAnOvernightSession() {
        assertFalse(CastSessionPolicy.canResume(true, now, 0L, now + 12 * 60 * 60 * 1000L))
    }

    @Test fun recoveryDeadlineSurvivesProcessRestart() {
        val deadline = now + CastSessionPolicy.RECOVERY_TIMEOUT_MS
        assertTrue(CastSessionPolicy.canResume(true, now, deadline, deadline - 1L))
        assertFalse(CastSessionPolicy.canResume(true, now, deadline, deadline))
        assertFalse(CastSessionPolicy.canResume(true, now, deadline, deadline + 1L))
    }

    @Test fun rejectsEndedAndLegacySessionsWithoutAnActivityTimestamp() {
        assertFalse(CastSessionPolicy.canResume(false, now, 0L, now))
        assertFalse(CastSessionPolicy.canResume(true, 0L, 0L, now))
    }

    @Test fun clockRollbackCannotExtendAnOldSession() {
        assertFalse(CastSessionPolicy.canResume(true, now + 1L, 0L, now))
    }
}
