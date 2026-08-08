package com.podwaffle.media

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reports the active Android network transport to the React Native runtime. */
class PodwaffleConnectivityModule : Module() {
    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "ReactContext is null" }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun definition() = ModuleDefinition {
        Name("PodwaffleConnectivity")
        Events("connection.changed")

        OnCreate {
            val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            connectivityManager = manager
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = emitChanged()

                override fun onLost(network: Network) = emitChanged()

                override fun onCapabilitiesChanged(
                    network: Network,
                    networkCapabilities: NetworkCapabilities,
                ) = emitChanged()
            }
            networkCallback = callback
            runCatching { manager.registerDefaultNetworkCallback(callback) }
            mainHandler.post { sendEvent("connection.changed", stateMap()) }
        }

        OnDestroy {
            networkCallback?.let { callback ->
                runCatching { connectivityManager?.unregisterNetworkCallback(callback) }
            }
            networkCallback = null
            connectivityManager = null
        }

        AsyncFunction("getState") {
            stateMap()
        }
    }

    private fun emitChanged() {
        mainHandler.post { sendEvent("connection.changed", stateMap()) }
    }

    private fun stateMap(): Map<String, Any?> {
        val manager = connectivityManager
            ?: context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork
            ?: return mapOf(
                "connected" to false,
                "transport" to "none",
                "metered" to true,
            )
        val capabilities = manager.getNetworkCapabilities(network)
            ?: return mapOf(
                "connected" to true,
                "transport" to "other",
                "metered" to manager.isActiveNetworkMetered,
            )
        val transport = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
        return mapOf(
            "connected" to true,
            "transport" to transport,
            "metered" to manager.isActiveNetworkMetered,
        )
    }
}
