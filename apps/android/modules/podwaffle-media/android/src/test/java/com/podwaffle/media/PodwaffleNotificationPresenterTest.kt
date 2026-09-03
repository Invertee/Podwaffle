package com.podwaffle.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PodwaffleNotificationPresenterTest {
    @Test
    fun createsStableNonNegativeNotificationIds() {
        val first = PodwaffleNotificationPresenter.notificationId("message-one")
        val repeated = PodwaffleNotificationPresenter.notificationId("message-one")
        val second = PodwaffleNotificationPresenter.notificationId("message-two")

        assertEquals(first, repeated)
        assertNotEquals(first, second)
        assertTrue(first >= 0)
    }
}
