package com.podwaffle.media

internal object CastSessionPolicy {
    const val PREFERENCES = "podwaffle.native.playback.v2"
    const val IDLE_TIMEOUT_MS = 30 * 60 * 1000L
    // Cast receivers continue independently of their Android sender. A short
    // sender-only recovery timeout can therefore orphan audio that is still
    // playing on the receiver. Keep trying for the same bounded period used by
    // the server's Cast ownership lease; confirmed activity extends the window.
    const val RECOVERY_TIMEOUT_MS = IDLE_TIMEOUT_MS

    fun canResume(saved: Boolean, lastActivityMs: Long, nowMs: Long): Boolean =
        saved && lastActivityMs > 0L && nowMs >= lastActivityMs &&
            nowMs - lastActivityMs < IDLE_TIMEOUT_MS
}
