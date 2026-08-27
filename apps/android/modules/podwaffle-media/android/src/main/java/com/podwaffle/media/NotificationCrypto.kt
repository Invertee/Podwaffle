package com.podwaffle.media

import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Decrypts the data-only FCM envelope produced by the Podwaffle server. */
object NotificationCrypto {
    private const val VERSION = "1"
    private const val ITERATIONS = 210_000
    private const val KEY_BITS = 256
    private const val GCM_TAG_BITS = 128
    private const val AAD = "podwaffle.notification.v1"

    fun decrypt(input: Map<String, Any?>, joinCode: String): Map<String, String> {
        val content = JSONObject(decryptPlaintext(input, joinCode))
        val title = content.getString("title").trim()
        val message = content.getString("message").trim()
        require(title.isNotEmpty() && title.length <= 200) {
            "Invalid notification title"
        }
        require(message.isNotEmpty() && message.length <= 2000) {
            "Invalid notification message"
        }
        return mapOf("title" to title, "message" to message)
    }

    internal fun decryptPlaintext(input: Map<String, Any?>, joinCode: String): String {
        require(input["v"] == VERSION) { "Unsupported notification encryption version" }
        require(joinCode.isNotEmpty()) { "The notification join code is missing" }
        val salt = decode(input.string("salt"))
        val iv = decode(input.string("iv"))
        val ciphertext = decode(input.string("ciphertext"))
        require(salt.size == 16) { "Invalid notification salt" }
        require(iv.size == 12) { "Invalid notification IV" }
        require(ciphertext.size > 16) { "Invalid notification ciphertext" }

        val keySpec = PBEKeySpec(joinCode.toCharArray(), salt, ITERATIONS, KEY_BITS)
        val key = try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(keySpec)
                .encoded
        } finally {
            keySpec.clearPassword()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(GCM_TAG_BITS, iv),
        )
        cipher.updateAAD(AAD.toByteArray(StandardCharsets.UTF_8))
        return cipher.doFinal(ciphertext).toString(StandardCharsets.UTF_8)
    }

    private fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)

    private fun Map<String, Any?>.string(key: String): String =
        this[key] as? String ?: throw IllegalArgumentException("Missing notification $key")
}
