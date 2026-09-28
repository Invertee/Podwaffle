package com.podwaffle.media

import android.content.DialogInterface
import android.content.Context
import android.os.Bundle
import androidx.media3.common.util.UnstableApi
import androidx.mediarouter.app.MediaRouteChooserDialog
import androidx.mediarouter.app.MediaRouteChooserDialogFragment
import androidx.mediarouter.media.MediaRouter

internal object CastRouteFilter {
    private val groupMemberSpeakers = setOf(
        "Dining Room",
        "Kitchen",
        "Office Left",
        "Office Right",
    )

    fun shouldShow(routeName: String, hideGroupSpeakers: Boolean): Boolean =
        !hideGroupSpeakers || routeName.trim() !in groupMemberSpeakers
}

/** Retains the SDK chooser/theme while observing outside-tap and Back cancellation. */
@UnstableApi
class PodwaffleCastChooserDialogFragment : MediaRouteChooserDialogFragment() {
    override fun onCreateChooserDialog(
        context: Context,
        savedInstanceState: Bundle?,
    ): MediaRouteChooserDialog {
        val hideGroupSpeakers =
            NativeConfigurationPersistence.load(context)?.hideGroupSpeakers == true
        return object : MediaRouteChooserDialog(context) {
            override fun onFilterRoute(route: MediaRouter.RouteInfo): Boolean =
                super.onFilterRoute(route) &&
                    CastRouteFilter.shouldShow(route.name.toString(), hideGroupSpeakers)
        }
    }

    override fun onCancel(dialog: DialogInterface) {
        super.onCancel(dialog)
        PodwaffleMediaService.instance?.cancelCastPicker()
    }
}
