package com.podwaffle.media

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaController
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionToken
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor

/**
 * Android Auto browse service.
 *
 * Android Auto supplies the driver-safe UI. This service only exposes the
 * Podcasts -> Episodes hierarchy and forwards playback to the existing
 * Podwaffle media service through a MediaController. No Cast, show notes, or
 * phone-only actions are advertised to the car host.
 */
@UnstableApi
class PodwaffleAutoMediaService : MediaLibraryService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { command -> mainHandler.post(command) }

    private var fallbackPlayer: ExoPlayer? = null
    private var mediaController: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var librarySession: MediaLibrarySession? = null
    private var catalog: PodwaffleAutoCatalog? = null
    private var downloadStore: PodwaffleDownloadStore? = null

    override fun onCreate() {
        super.onCreate()
        NativeConfigurationPersistence.load(this)
        NotificationHelper.createNotificationChannels(this)
        catalog = PodwaffleAutoCatalog(this)
        downloadStore = PodwaffleDownloadStore(this) { _, _ -> }

        val fallback = ExoPlayer.Builder(this)
            .setSeekBackIncrementMs(
                NativeConfigurationStore.current?.skipBackwardMs ?: DEFAULT_SKIP_BACK_MS,
            )
            .setSeekForwardIncrementMs(
                NativeConfigurationStore.current?.skipForwardMs ?: DEFAULT_SKIP_FORWARD_MS,
            )
            .build()
            .also { player ->
                player.setHandleAudioBecomingNoisy(true)
                player.setPauseAtEndOfMediaItems(true)
            }
        fallbackPlayer = fallback

        val callback = AutoLibraryCallback()
        val sessionBuilder = MediaLibrarySession.Builder(this, fallback, callback)
        createSessionActivity()?.let(sessionBuilder::setSessionActivity)
        librarySession = sessionBuilder.build()

        val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId(NotificationHelper.PLAYBACK_CHANNEL_ID)
            .setNotificationId(AUTO_FALLBACK_NOTIFICATION_ID)
            .build()
        notificationProvider.setSmallIcon(R.drawable.ic_podwaffle_notification)
        setMediaNotificationProvider(notificationProvider)

        connectToPlaybackService()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? =
        librarySession

    override fun onUpdateNotification(
        session: MediaSession,
        startInForegroundRequired: Boolean,
    ) {
        if (mediaController == null) {
            super.onUpdateNotification(session, startInForegroundRequired)
        }
        // Once connected, PodwaffleMediaService owns playback and its foreground
        // notification. This browse-only service deliberately avoids a duplicate.
    }

    private fun connectToPlaybackService() {
        val token = SessionToken(
            this,
            ComponentName(this, PodwaffleMediaService::class.java),
        )
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener(
            {
                runCatching { future.get() }
                    .onSuccess(::attachController)
            },
            mainExecutor,
        )
    }

    private fun attachController(controller: MediaController) {
        if (mediaController != null) {
            controller.release()
            return
        }
        val fallback = fallbackPlayer
        val pendingItems = fallback?.let { player ->
            List(player.mediaItemCount) { index -> player.getMediaItemAt(index) }
        }.orEmpty()
        val pendingIndex = fallback?.currentMediaItemIndex ?: 0
        val pendingPosition = fallback?.currentPosition?.coerceAtLeast(0L) ?: 0L
        val pendingPlayWhenReady = fallback?.playWhenReady == true

        mediaController = controller
        librarySession?.setPlayer(controller)

        if (pendingItems.isNotEmpty()) {
            val index = pendingIndex.coerceIn(0, pendingItems.lastIndex)
            controller.setMediaItems(pendingItems, index, pendingPosition)
            controller.prepare()
            controller.playWhenReady = pendingPlayWhenReady
            if (pendingPlayWhenReady) controller.play()
        }

        fallback?.release()
        fallbackPlayer = null
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    private fun createSessionActivity(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            this,
            20,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    override fun onDestroy() {
        controllerFuture?.cancel(true)
        controllerFuture = null
        mediaController?.release()
        mediaController = null
        librarySession?.release()
        librarySession = null
        fallbackPlayer?.release()
        fallbackPlayer = null
        downloadStore?.release()
        downloadStore = null
        catalog?.close()
        catalog = null
        super.onDestroy()
    }

    private inner class AutoLibraryCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(
            LibraryResult.ofItem(requireCatalog().rootItem(), params),
        )

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            requireCatalog().children(
                parentId = parentId,
                page = page,
                pageSize = pageSize,
                params = params,
                downloadStore = requireDownloadStore(),
            )

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            requireCatalog().item(mediaId, requireDownloadStore())

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val resolved = requireCatalog().resolvePlayable(
                mediaItems,
                requireDownloadStore(),
            )
            if (resolved.isEmpty()) {
                return Futures.immediateFuture(
                    MediaSession.MediaItemsWithStartPosition(
                        emptyList(),
                        C.INDEX_UNSET,
                        C.TIME_UNSET,
                    ),
                )
            }
            val index = if (startIndex == C.INDEX_UNSET) {
                0
            } else {
                startIndex.coerceIn(0, resolved.lastIndex)
            }
            val requestedPosition = if (startPositionMs == C.TIME_UNSET) {
                resolved[index].mediaMetadata.extras
                    ?.getLong("resumePositionMs", 0L)
                    ?.coerceAtLeast(0L)
                    ?: 0L
            } else {
                startPositionMs.coerceAtLeast(0L)
            }
            requireCatalog().acquirePlayback(
                resolved[index].mediaId,
                requestedPosition,
            )
            return Futures.immediateFuture(
                MediaSession.MediaItemsWithStartPosition(
                    resolved,
                    index,
                    requestedPosition,
                ),
            )
        }

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> {
            val resolved = requireCatalog().resolvePlayable(
                mediaItems,
                requireDownloadStore(),
            )
            requireCatalog().queueOnServer(resolved.map(MediaItem::mediaId))
            return Futures.immediateFuture(resolved.toMutableList())
        }
    }

    private fun requireCatalog(): PodwaffleAutoCatalog =
        requireNotNull(catalog) { "Android Auto catalogue is unavailable" }

    private fun requireDownloadStore(): PodwaffleDownloadStore =
        requireNotNull(downloadStore) { "Download store is unavailable" }

    private companion object {
        const val AUTO_FALLBACK_NOTIFICATION_ID = 1003
        const val DEFAULT_SKIP_BACK_MS = 15_000L
        const val DEFAULT_SKIP_FORWARD_MS = 30_000L
    }
}
