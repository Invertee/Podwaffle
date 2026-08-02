package com.podwaffle.media

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.util.UnstableApi
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Expo bridge for the long-lived Media3 service. */
@UnstableApi
class PodwaffleMediaModule : Module() {
    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "ReactContext is null" }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var skipBackwardMs = 15_000L
    private var skipForwardMs = 30_000L

    override fun definition() = ModuleDefinition {
        Name("PodwaffleMedia")

        Events(
            "media.state.changed",
            "media.position.changed",
            "media.metadata.changed",
            "media.queue.changed",
            "media.item.ended",
            "media.error",
            "media.audio-focus.changed",
            "cast.state.changed",
            "cast.volume.changed",
            "download.state.changed",
            "download.maintenance.completed",
            "native.connection.changed",
            "native.command.result",
        )

        OnCreate {
            PodwaffleMediaService.eventEmitter = { eventName, params ->
                this@PodwaffleMediaModule.sendEvent(eventName, params)
            }
            // Warm the service on Android's main thread so the first playback
            // command does not race service creation.
            mainHandler.post { ensureServiceStartedOnMain() }
        }

        OnDestroy {
            PodwaffleMediaService.eventEmitter = null
        }

        AsyncFunction("configure") { input: Map<String, Any?> ->
            val configuration = NativeConfiguration.fromMap(input)
            NativeConfigurationPersistence.save(context, configuration)
            skipBackwardMs = configuration.skipBackwardMs
            skipForwardMs = configuration.skipForwardMs
            withServiceOnMain { service ->
                service.getDownloadStore().maintenance(
                    maxAutomaticAgeDays = configuration.downloadRetentionDays,
                    maxStorageBytes = configuration.maxDownloadStorageBytes,
                )
            }
            true
        }

        AsyncFunction("clearConfiguration") {
            NativeConfigurationPersistence.clear(context)
            true
        }

        AsyncFunction("bind") {
            withServiceOnMain(PodwaffleMediaService::stateMap)
        }

        AsyncFunction("getState") {
            onMain {
                PodwaffleMediaService.instance?.stateMap()
                    ?: MediaStateMapper.mapStateToMap(null)
            }
        }

        AsyncFunction("setQueue") { input: Map<String, Any?> ->
            val snapshot = QueueSnapshot.fromMap(input)
            withServiceOnMain { service ->
                val store = service.getDownloadStore()
                // Automatically cache every queued episode. DownloadManager.add()
                // is idempotent for queued, active and completed items, while a
                // storage or network failure must never block the queue update.
                snapshot.items.forEach { media ->
                    if (
                        media.enclosureUrl.isNotBlank() &&
                        store.completedPath(media.episodeId) == null
                    ) {
                        runCatching { store.add(media.toMap(), "automatic") }
                    }
                }
                val enriched = snapshot.items.map { media ->
                    media.withDownloadPath(
                        store.completedPath(media.episodeId) ?: media.localDownloadPath,
                    )
                }
                service.setQueue(
                    local = enriched.map { it.toMediaItem(useDownload = true) },
                    remote = enriched.map { it.toMediaItem(useDownload = false) },
                    requestedIndex = snapshot.currentIndex,
                )
            }
            true
        }

        AsyncFunction("playEpisode") { input: Map<String, Any?>, startPositionMs: Long ->
            val media = EpisodeMedia.fromMap(input)
            withServiceOnMain { service ->
                val enriched = media.withDownloadPath(
                    service.getDownloadStore().completedPath(media.episodeId)
                        ?: media.localDownloadPath,
                )
                service.playEpisode(
                    local = enriched.toMediaItem(useDownload = true),
                    remote = enriched.toMediaItem(useDownload = false),
                    startPositionMs = startPositionMs,
                )
            }
            true
        }

        AsyncFunction("play") {
            withServiceOnMain(PodwaffleMediaService::play)
            true
        }

        AsyncFunction("pause") {
            withServiceOnMain(PodwaffleMediaService::pause)
            true
        }

        AsyncFunction("stop") {
            withServiceOnMain(PodwaffleMediaService::stop)
            true
        }

        AsyncFunction("seekTo") { positionMs: Long ->
            withServiceOnMain { it.seekTo(positionMs) }
            true
        }

        AsyncFunction("skipForward") {
            withServiceOnMain { it.skipBy(skipForwardMs) }
            true
        }

        AsyncFunction("skipBackward") {
            withServiceOnMain { it.skipBy(-skipBackwardMs) }
            true
        }

        AsyncFunction("next") {
            withServiceOnMain(PodwaffleMediaService::next)
            true
        }

        AsyncFunction("previous") {
            withServiceOnMain(PodwaffleMediaService::previous)
            true
        }

        AsyncFunction("setPlaybackRate") { rate: Float ->
            withServiceOnMain { it.setPlaybackRate(rate) }
            true
        }

        AsyncFunction("startCast") { input: Map<String, Any?>, startPositionMs: Long, autoplay: Boolean ->
            val media = EpisodeMedia.fromMap(input)
            withServiceOnMain { service ->
                val enriched = media.withDownloadPath(
                    service.getDownloadStore().completedPath(media.episodeId)
                        ?: media.localDownloadPath,
                )
                service.playEpisode(
                    local = enriched.toMediaItem(useDownload = true),
                    remote = enriched.toMediaItem(useDownload = false),
                    startPositionMs = startPositionMs,
                    autoplay = false,
                )
                service.prepareCast(media.episodeId, startPositionMs, autoplay)
                if (!(service.getCastState()["connected"] as? Boolean ?: false)) {
                    openCastPickerOnMain()
                }
                service.getCastState()
            }
        }

        AsyncFunction("castPlay") {
            withServiceOnMain(PodwaffleMediaService::castPlay)
        }

        AsyncFunction("castPause") {
            withServiceOnMain(PodwaffleMediaService::castPause)
        }

        AsyncFunction("castSeek") { positionMs: Long ->
            withServiceOnMain { it.castSeek(positionMs) }
        }

        AsyncFunction("showCastPicker") {
            withServiceOnMain { service ->
                service.markCastPickerOpened()
                openCastPickerOnMain()
                service.getCastState()
            }
        }

        AsyncFunction("stopCast") { input: Map<String, Any?> ->
            withServiceOnMain {
                it.stopCast(input["stopReceiver"] as? Boolean ?: true)
            }
        }

        AsyncFunction("getCastState") {
            onMain {
                PodwaffleMediaService.instance?.getCastState()
                    ?: mapOf(
                        "available" to false,
                        "connecting" to false,
                        "connected" to false,
                        "session" to null,
                        "availableDevices" to emptyList<String>(),
                    )
            }
        }

        AsyncFunction("setCastVolume") { volume: Float ->
            withServiceOnMain { it.setCastVolume(volume) }
        }

        AsyncFunction("addDownload") { input: Map<String, Any?>, reason: String ->
            val media = EpisodeMedia.fromMap(input)
            withServiceOnMain {
                it.getDownloadStore().add(media.toMap(), reason)
            }
        }

        AsyncFunction("removeDownload") { episodeId: String ->
            withServiceOnMain {
                it.getDownloadStore().remove(episodeId)
            }
        }

        AsyncFunction("getDownloads") {
            withServiceOnMain {
                it.getDownloadStore().getDownloads()
            }
        }

        AsyncFunction("runDownloadMaintenance") {
            val configuration = NativeConfigurationStore.current
            withServiceOnMain {
                it.getDownloadStore().maintenance(
                    maxAutomaticAgeDays = configuration?.downloadRetentionDays ?: 30,
                    maxStorageBytes = configuration?.maxDownloadStorageBytes
                        ?: 2_000_000_000L,
                )
            }
        }
    }

    /**
     * Expo AsyncFunctions run away from the JavaScript thread by default, while
     * Media3 and Cast require their player APIs to be called on the application
     * main looper. This helper synchronously marshals short player operations to
     * that looper and propagates any native exception back to the Promise.
     */
    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val task = FutureTask(Callable(block))
        mainHandler.post(task)
        return task.get(MAIN_OPERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }

    private fun service(): PodwaffleMediaService {
        PodwaffleMediaService.instance?.let { return it }
        onMain { ensureServiceStartedOnMain() }
        repeat(SERVICE_START_RETRIES) {
            PodwaffleMediaService.instance?.let { return it }
            Thread.sleep(SERVICE_START_RETRY_MS)
        }
        throw IllegalStateException("The media service did not start")
    }

    private fun <T> withServiceOnMain(
        block: (PodwaffleMediaService) -> T,
    ): T {
        val service = service()
        return onMain { block(service) }
    }

    private fun ensureServiceStartedOnMain() {
        if (PodwaffleMediaService.instance != null) return
        context.startService(Intent(context, PodwaffleMediaService::class.java))
    }

    private fun openCastPickerOnMain() {
        val activity = appContext.currentActivity
            ?: throw IllegalStateException("The Cast picker requires an active Android screen")
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
            ?: throw IllegalStateException("The Cast picker could not attach to the current screen")

        // Use CAF's supported MediaRouteButton path rather than constructing a
        // MediaRouteChooserDialog directly. The direct dialog path can resolve
        // an incompatible theme layout in React Native activities and crash
        // while trying to update a missing title TextView.
        val button = MediaRouteButton(activity).apply {
            alpha = 0.01f
            contentDescription = "Cast Podwaffle"
        }
        val layout = FrameLayout.LayoutParams(1, 1, Gravity.TOP or Gravity.END)
        root.addView(button, layout)
        try {
            CastButtonFactory.setUpMediaRouteButton(activity.applicationContext, button)
            if (!button.showDialog()) {
                throw IllegalStateException("The Cast device picker could not be opened")
            }
        } finally {
            button.postDelayed({
                (button.parent as? ViewGroup)?.removeView(button)
            }, CAST_BUTTON_CLEANUP_DELAY_MS)
        }
    }

    private companion object {
        const val MAIN_OPERATION_TIMEOUT_SECONDS = 15L
        const val SERVICE_START_RETRIES = 100
        const val SERVICE_START_RETRY_MS = 50L
        const val CAST_BUTTON_CLEANUP_DELAY_MS = 2_000L
    }
}
