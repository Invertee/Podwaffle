package com.podwaffle.media

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import androidx.media3.common.util.UnstableApi
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Runs bounded download maintenance and played-episode cleanup once per day. */
@OptIn(UnstableApi::class)
class PodwaffleCacheMaintenanceJobService : JobService() {
    private var work: Future<*>? = null
    @Volatile
    private var stopped = false

    override fun onStartJob(params: JobParameters): Boolean {
        stopped = false
        work = EXECUTOR.submit {
            var retry = false
            try {
                val configuration = NativeConfigurationPersistence.load(applicationContext)
                if (configuration != null) {
                    val existingStore = PodwaffleMediaService.instance?.getDownloadStore()
                    val temporaryStore = existingStore == null
                    val store = existingStore
                        ?: PodwaffleDownloadStore(applicationContext) { _, _ -> }
                    try {
                        store.maintenance(
                            maxAutomaticAgeDays = configuration.downloadRetentionDays,
                            maxStorageBytes = configuration.maxDownloadStorageBytes,
                        )
                        PodwaffleCachePolicy.cleanupPlayed(
                            applicationContext,
                            store,
                            PodwaffleCachePolicy.protectedEpisodeIds(applicationContext),
                        )
                    } finally {
                        if (temporaryStore) store.release()
                    }
                }
            } catch (_: Exception) {
                retry = true
            } finally {
                if (!stopped) jobFinished(params, retry)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        work?.cancel(true)
        work = null
        return true
    }

    companion object {
        private const val JOB_ID = 0x50574348
        private const val INTERVAL_MS = 24L * 60L * 60L * 1_000L
        private const val FLEX_MS = 6L * 60L * 60L * 1_000L
        private val EXECUTOR = Executors.newSingleThreadExecutor()

        fun schedule(context: Context) {
            val scheduler = context.applicationContext
                .getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            val job = JobInfo.Builder(
                JOB_ID,
                ComponentName(
                    context.applicationContext,
                    PodwaffleCacheMaintenanceJobService::class.java,
                ),
            )
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
                .setPeriodic(INTERVAL_MS, FLEX_MS)
                .build()
            scheduler.schedule(job)
        }

        fun cancel(context: Context) {
            val scheduler = context.applicationContext
                .getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            scheduler.cancel(JOB_ID)
        }
    }
}
