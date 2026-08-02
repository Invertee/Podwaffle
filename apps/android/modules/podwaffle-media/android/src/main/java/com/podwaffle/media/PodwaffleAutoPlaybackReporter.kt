package com.podwaffle.media

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Reports Android Auto playback when the React Native runtime is not attached.
 *
 * The normal Android controller remains authoritative whenever its event bridge
 * exists. This reporter only covers a cold car launch so other Podwaffle clients
 * still receive an owner, state and position through the existing REST/sync path.
 */
class PodwaffleAutoPlaybackReporter(private val context: Context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    fun report(
        episodeId: String,
        positionMs: Long,
        durationMs: Long?,
        state: String,
        playbackRate: Float,
    ) {
        if (episodeId.isBlank()) return
        executor.execute {
            val stateBody = JSONObject().apply {
                put("episodeId", episodeId)
                put("positionMs", positionMs.coerceAtLeast(0L))
                durationMs?.takeIf { it > 0L }?.let { put("durationMs", it) }
                put("state", state)
                put("playbackRate", playbackRate.coerceIn(0.5f, 4f).toDouble())
            }
            if (runCatching { request("/api/v1/playback/state", stateBody) }.isSuccess) {
                return@execute
            }

            // A cold Auto launch may race the initial lease request, or the
            // previous lease may have expired. Reacquire once and retry state.
            val leaseBody = JSONObject().apply {
                put("episodeId", episodeId)
                put("positionMs", positionMs.coerceAtLeast(0L))
                durationMs?.takeIf { it > 0L }?.let { put("durationMs", it) }
                put("playbackRate", playbackRate.coerceIn(0.5f, 4f).toDouble())
            }
            runCatching {
                request("/api/v1/playback/lease", leaseBody)
                request("/api/v1/playback/state", stateBody)
            }
        }
    }

    fun close() {
        executor.shutdownNow()
    }

    private fun request(path: String, body: JSONObject): JSONObject {
        val configuration = NativeConfigurationStore.current
            ?: NativeConfigurationPersistence.load(context)
            ?: throw IOException("Podwaffle is not configured")
        val connection = URL("${configuration.serverBaseUrl}$path")
            .openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${configuration.deviceToken}")
            connection.outputStream.use { output ->
                output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IOException("Podwaffle request failed ($status)")
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 20_000
    }
}
