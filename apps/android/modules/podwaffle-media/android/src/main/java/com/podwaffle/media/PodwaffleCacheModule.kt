package com.podwaffle.media

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Expo bridge for cache statistics, manual clearing and maintenance. */
class PodwaffleCacheModule : Module() {
    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "ReactContext is null" }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun definition() = ModuleDefinition {
        Name("PodwaffleCache")

        OnCreate {
            PodwaffleCacheMaintenanceJobService.schedule(context)
        }

        AsyncFunction("getSummary") {
            withStoreOnMain(PodwaffleCachePolicy::summary)
        }

        AsyncFunction("clearCompleted") {
            withStoreOnMain { store ->
                PodwaffleCachePolicy.clearCompleted(
                    context,
                    store,
                    PodwaffleCachePolicy.protectedEpisodeIds(context),
                )
            }
        }

        AsyncFunction("runMaintenance") {
            val configuration = NativeConfigurationStore.current
                ?: NativeConfigurationPersistence.load(context)
            withStoreOnMain { store ->
                val bounded = store.maintenance(
                    maxAutomaticAgeDays = configuration?.downloadRetentionDays ?: 30,
                    maxStorageBytes = configuration?.maxDownloadStorageBytes
                        ?: 2_000_000_000L,
                )
                val played = PodwaffleCachePolicy.cleanupPlayed(
                    context,
                    store,
                    PodwaffleCachePolicy.protectedEpisodeIds(context),
                )
                mergeResults(bounded, played)
            }
        }
    }

    private fun <T> withStoreOnMain(block: (PodwaffleDownloadStore) -> T): T {
        val service = service()
        return onMain { block(service.getDownloadStore()) }
    }

    private fun service(): PodwaffleMediaService {
        PodwaffleMediaService.instance?.let { return it }
        onMain {
            context.startService(Intent(context, PodwaffleMediaService::class.java))
        }
        repeat(SERVICE_START_RETRIES) {
            PodwaffleMediaService.instance?.let { return it }
            Thread.sleep(SERVICE_START_RETRY_MS)
        }
        throw IllegalStateException("The media service did not start")
    }

    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val task = FutureTask(Callable(block))
        mainHandler.post(task)
        return task.get(MAIN_OPERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }

    private fun mergeResults(
        first: Map<String, Any?>,
        second: Map<String, Any?>,
    ): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        val firstErrors = first["errors"] as? List<String> ?: emptyList()
        @Suppress("UNCHECKED_CAST")
        val secondErrors = second["errors"] as? List<String> ?: emptyList()
        return mapOf(
            "removedCount" to (
                (first["removedCount"] as? Number)?.toInt().orZero() +
                    (second["removedCount"] as? Number)?.toInt().orZero()
                ),
            "freedBytes" to (
                (first["freedBytes"] as? Number)?.toLong().orZero() +
                    (second["freedBytes"] as? Number)?.toLong().orZero()
                ),
            "errors" to firstErrors + secondErrors,
        )
    }

    private fun Int?.orZero(): Int = this ?: 0
    private fun Long?.orZero(): Long = this ?: 0L

    private companion object {
        const val MAIN_OPERATION_TIMEOUT_SECONDS = 15L
        const val SERVICE_START_RETRIES = 100
        const val SERVICE_START_RETRY_MS = 50L
    }
}
