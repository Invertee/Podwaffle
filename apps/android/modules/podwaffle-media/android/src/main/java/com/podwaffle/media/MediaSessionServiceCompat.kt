package com.podwaffle.media

import androidx.media3.session.MediaSessionService

/**
 * Media3 1.5.0 does not expose triggerNotificationUpdate(). Registered
 * MediaSession instances are observed by MediaSessionService automatically, so
 * this compatibility extension intentionally does nothing on that version.
 *
 * If a future Media3 release adds a member with this name, Kotlin will prefer
 * the real member over this extension without requiring another call-site change.
 */
internal fun MediaSessionService.triggerNotificationUpdate() = Unit
