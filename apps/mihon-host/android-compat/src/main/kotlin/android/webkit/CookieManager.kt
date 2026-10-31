/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.webkit

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * The WebView cookie store Mihon's client shares; here it is the host's OkHttp cookie jar, which
 * the host sets once at start (`CookieManager.jar`). Only what extensions call.
 */
class CookieManager private constructor() {
    fun setCookie(url: String, value: String) {
        val parsed = url.toHttpUrlOrNull() ?: return
        val cookie = Cookie.parse(parsed, value) ?: return
        jar.saveFromResponse(parsed, listOf(cookie))
    }

    fun setCookie(url: String, value: String, callback: ValueCallback<Boolean>?) {
        setCookie(url, value)
        callback?.onReceiveValue(true)
    }

    fun getCookie(url: String): String? {
        val parsed = url.toHttpUrlOrNull() ?: return null
        return jar.loadForRequest(parsed).joinToString("; ") { "${it.name}=${it.value}" }.ifEmpty { null }
    }

    fun setAcceptCookie(accept: Boolean) = Unit

    fun acceptCookie() = true

    fun flush() = Unit

    companion object {
        @JvmStatic
        var jar: CookieJar = CookieJar.NO_COOKIES

        private val instance = CookieManager()

        @JvmStatic
        fun getInstance() = instance
    }
}

fun interface ValueCallback<T> {
    fun onReceiveValue(value: T)
}
