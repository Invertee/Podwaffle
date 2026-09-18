package com.podwaffle.media

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Keep reporting receiver observations even when the React Native runtime sleeps. */
internal class CastProgressReporter {
    private val executor = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private var lastReportAt = 0L

    fun report(snapshot: CastPlaybackSnapshot, playbackRate: Float) {
        val media = snapshot.episode ?: return
        if (!snapshot.connected || snapshot.connecting || !snapshot.mediaLoaded) return
        val configuration = NativeConfigurationStore.current ?: return
        val now = System.currentTimeMillis()
        if (now - lastReportAt < 10_000L || !busy.compareAndSet(false, true)) return
        lastReportAt = now
        val body = JSONObject().apply {
            put("commandId", UUID.randomUUID().toString())
            put("takeover", false)
            put("background", true)
            put("confirmed", JSONObject().apply {
                put("episodeId", media.episodeId)
                put("castSessionId", snapshot.sessionId)
                put("positionMs", snapshot.positionMs)
                put("durationMs", snapshot.durationMs ?: JSONObject.NULL)
                put("state", if (snapshot.playing) "playing" else "paused")
                put("playbackRate", playbackRate.toDouble())
            })
        }.toString()
        executor.execute {
            try {
                val connection = URL("${configuration.serverBaseUrl}/api/v1/playback/cast")
                    .openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 3_000
                    connection.readTimeout = 3_000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Authorization", "Bearer ${configuration.deviceToken}")
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    val status = connection.responseCode
                    (if (status in 200..299) connection.inputStream else connection.errorStream)?.close()
                } finally {
                    connection.disconnect()
                }
            } catch (_: Exception) {
                // Retry the newest observation on the next tick; never queue stale positions.
            } finally {
                busy.set(false)
            }
        }
    }

    fun close() { executor.shutdownNow() }
}
