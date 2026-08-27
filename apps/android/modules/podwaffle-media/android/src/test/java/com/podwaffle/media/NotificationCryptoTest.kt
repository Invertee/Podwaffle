package com.podwaffle.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NotificationCryptoTest {
    private val encrypted = mapOf<String, Any?>(
        "v" to "1",
        "salt" to "ABEiM0RVZneImaq7zN3u_w",
        "iv" to "ABEiM0RVZneImaq7",
        "ciphertext" to
            "s8c0kXfFQRlJSu17Y-ODUctCOC1TV9R13F6xbbrOjisOr-qDKw9IYoW78yFuYo0KuhRUuknJwKpDzhvqLOQ0MhKIlYNJD0qvAg",
    )

    @Test
    fun decryptsServerCompatibleEnvelope() {
        assertEquals(
            "{\"title\":\"Front door\",\"message\":\"Someone is at the door\"}",
            NotificationCrypto.decryptPlaintext(
                encrypted,
                "correct horse battery staple",
            ),
        )
    }

    @Test
    fun rejectsWrongJoinCode() {
        assertThrows(Exception::class.java) {
            NotificationCrypto.decryptPlaintext(encrypted, "wrong code")
        }
    }
}
