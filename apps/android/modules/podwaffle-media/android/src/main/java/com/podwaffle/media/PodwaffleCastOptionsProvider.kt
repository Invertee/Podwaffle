package com.podwaffle.media

import android.content.Context
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions

/** Uses Google's Default Media Receiver unless a custom receiver is added later. */
class PodwaffleCastOptionsProvider : OptionsProvider {
    override fun getCastOptions(appContext: Context): CastOptions {
        val mediaOptions = CastMediaOptions.Builder()
            // Podwaffle supplies its own MediaSessionService for both local and
            // Cast playback. Disable the Cast SDK session to avoid duplicate
            // lock-screen sessions and notifications.
            .setMediaSessionEnabled(false)
            .build()
        return CastOptions.Builder()
            .setReceiverApplicationId(
                CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID
            )
            .setCastMediaOptions(mediaOptions)
            .setEnableReconnectionService(true)
            .setResumeSavedSession(true)
            .setSessionTransferEnabled(true)
            .setRemoteToLocalEnabled(true)
            .setStopReceiverApplicationWhenEndingSession(false)
            .build()
    }

    override fun getAdditionalSessionProviders(
        appContext: Context
    ): List<SessionProvider>? = null
}
