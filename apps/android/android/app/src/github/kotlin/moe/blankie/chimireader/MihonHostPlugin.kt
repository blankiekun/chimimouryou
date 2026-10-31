package moe.blankie.chimireader

import android.app.Application
import android.content.pm.ApplicationInfo
import android.webkit.CookieManager
import android.webkit.WebSettings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import moe.chimimouryou.mihon.Guard
import moe.chimimouryou.mihon.Host
import moe.chimimouryou.mihon.HostError
import moe.chimimouryou.mihon.Remembered
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * Mihon extensions in the app (`github` flavor only): the desktop host's protocol (apps/mihon-host
 * `Host`, the same core) in-process. `install {url, signingKey}` → `{sha256}` (MihonApks);
 * `call {pin, op, …}` loads the pinned apk once, then answers `load` (its sources) or the op;
 * `pages`/`image` answer image files under the cache, which the page reads with
 * `Capacitor.convertFileSrc` (never base64 over the bridge) and hands back to `drop {paths}`.
 * Used by apps/web's lib/data/sources/mihon-runtime.ts.
 */
@CapacitorPlugin(name = "MihonHost")
class MihonHostPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val loaded = ConcurrentHashMap<String, JsonElement>()
    private val app get() = context.applicationContext as Application
    private val tmp by lazy { File(app.cacheDir, "mihon-tmp").apply { deleteRecursively() } }

    private val network by lazy {
        val debuggable = app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        // The phone E2E (apps/android/e2e) reaches its proxy on the phone's loopback.
        val testHosts = if (debuggable) activity?.intent?.getStringExtra("mihonTestHosts").orEmpty() else ""
        val guard = Guard(testHosts.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet())
        // The WebView's user agent made Chrome's (no "; wv", no "Version/4.0"): some sites refuse WebViews.
        val userAgent = WebSettings.getDefaultUserAgent(app).replace("; wv", "").replace(Regex("Version/\\S+ "), "")
        NetworkHelper(File(app.cacheDir, "mihon"), WebViewCookieJar(), guard, guard, userAgent)
    }

    private val host by lazy {
        Host(app, network, tmp, Remembered(File(app.filesDir, "mihon/remembered"))) { MihonApks.load(app, it) }
    }

    private fun run(call: PluginCall, block: suspend () -> JsonElement) {
        scope.launch {
            try {
                call.resolve(JSObject(block().toString()))
            } catch (e: TimeoutCancellationException) {
                call.reject("The extension took too long")
            } catch (e: Throwable) {
                call.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    @PluginMethod
    fun install(call: PluginCall) = run(call) {
        val pin = MihonApks.install(app, network.client, call.getString("url").orEmpty(), call.getString("signingKey").orEmpty())
        buildJsonObject { put("sha256", JsonPrimitive(pin)) }
    }

    @PluginMethod
    fun call(call: PluginCall) = run(call) {
        val pin = call.getString("pin").orEmpty()
        val op = call.getString("op").orEmpty()
        val sources = loaded[pin] ?: host.handle("load", buildJsonObject { put("jar", JsonPrimitive(MihonApks.open(app, pin))) })
            .also { loaded[pin] = it }
        when (op) {
            "load" -> sources
            // A call can't be stopped once an extension runs it: the answer stops waiting instead.
            "popular", "latest", "search", "detail", "pages", "image" ->
                withTimeout(if (op == "pages") 10.minutes else 60.seconds) {
                    host.handle(op, Json.parseToJsonElement(call.data.toString()).jsonObject)
                }
            else -> throw HostError("Unknown op $op")
        }
    }

    /** Deletes image files the page has read (only ones under the host's own folder). */
    @PluginMethod
    fun drop(call: PluginCall) {
        val paths = call.getArray("paths")?.toList<String>().orEmpty()
        for (path in paths) {
            val file = File(path).canonicalFile
            if (file.parentFile == tmp.canonicalFile) file.delete()
        }
        call.resolve()
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }
}

/** Mihon's AndroidCookieJar: the extensions' cookies in the WebView's store, as extensions expect. */
private class WebViewCookieJar : CookieJar {
    private val manager = CookieManager.getInstance()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val address = url.toString()
        for (cookie in cookies) manager.setCookie(address, cookie.toString())
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        manager.getCookie(url.toString())?.split(';')?.mapNotNull { Cookie.parse(url, it.trim()) }.orEmpty()
}
