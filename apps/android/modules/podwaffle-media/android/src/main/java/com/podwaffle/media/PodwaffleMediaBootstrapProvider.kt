package com.podwaffle.media

import android.content.ComponentName
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken

/**
 * Establishes an in-process MediaController connection to the playback service.
 *
 * Podwaffle invokes the service directly through the Expo native module instead
 * of through a MediaController. Without a controller connection,
 * MediaSessionService.onGetSession() is never called and the service does not
 * register the MediaSession that drives Android's foreground media notification,
 * lock-screen controls and system media carousel.
 */
class PodwaffleMediaBootstrapProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val applicationContext = context?.applicationContext ?: return false
        Handler(Looper.getMainLooper()).post {
            ensureControllerConnected(applicationContext)
        }
        return true
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(
        uri: Uri,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    private companion object {
        @Volatile
        private var controllerConnection: Any? = null

        private fun ensureControllerConnected(context: android.content.Context) {
            if (controllerConnection != null) return
            synchronized(PodwaffleMediaBootstrapProvider::class.java) {
                if (controllerConnection != null) return
                val token = SessionToken(
                    context,
                    ComponentName(context, PodwaffleMediaService::class.java),
                )
                // Keep the future for the lifetime of the process. Once connected,
                // it retains the MediaController and therefore the service binding.
                controllerConnection = MediaController.Builder(context, token).buildAsync()
            }
        }
    }
}
