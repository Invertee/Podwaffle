package com.podwaffle.media

import android.content.DialogInterface
import androidx.media3.common.util.UnstableApi
import androidx.mediarouter.app.MediaRouteChooserDialogFragment

/** Retains the SDK chooser/theme while observing outside-tap and Back cancellation. */
@UnstableApi
class PodwaffleCastChooserDialogFragment : MediaRouteChooserDialogFragment() {
    override fun onCancel(dialog: DialogInterface) {
        super.onCancel(dialog)
        PodwaffleMediaService.instance?.cancelCastPicker()
    }
}
