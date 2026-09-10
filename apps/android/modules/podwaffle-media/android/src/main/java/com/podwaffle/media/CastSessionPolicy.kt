package com.podwaffle.media

internal object CastSessionPolicy {
    const val PREFERENCES = "podwaffle.native.playback.v2"
    const val IDLE_TIMEOUT_MS = 30 * 60 * 1000L
    const val RECOVERY_TIMEOUT_MS = 30_000L

    fun canResume(saved: Boolean, lastActivityMs: Long, recoveryDeadlineMs: Long, nowMs: Long): Boolean =
        saved && lastActivityMs > 0L && nowMs >= lastActivityMs &&
            nowMs - lastActivityMs < IDLE_TIMEOUT_MS &&
            (recoveryDeadlineMs == 0L || nowMs < recoveryDeadlineMs)
}
