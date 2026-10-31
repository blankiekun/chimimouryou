/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package eu.kanade.tachiyomi.network

import eu.kanade.tachiyomi.network.interceptor.UncaughtExceptionInterceptor
import eu.kanade.tachiyomi.network.interceptor.UserAgentInterceptor
import okhttp3.Cache
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.io.File
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * Mihon's NetworkHelper as extensions see it (`client`, `cloudflareClient`,
 * `defaultUserAgentProvider`), built by the host: its own cookie jar, DNS and guard instead of
 * Android's WebView cookies and Cloudflare solver (none in phase 1).
 */
class NetworkHelper(
    cacheDir: File,
    cookieJar: CookieJar,
    dns: Dns,
    guard: Interceptor,
    private val userAgent: String,
) {
    val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .dns(dns)
        .connectTimeout(30.seconds)
        .readTimeout(30.seconds)
        .callTimeout(2.minutes)
        .cache(Cache(directory = File(cacheDir, "network_cache"), maxSize = 5L * 1024 * 1024))
        .addInterceptor(UncaughtExceptionInterceptor())
        .addInterceptor(UserAgentInterceptor(::defaultUserAgentProvider))
        // Every hop, redirects included, passes the guard.
        .addNetworkInterceptor(guard)
        .build()

    @Deprecated("The regular client handles Cloudflare by default")
    @Suppress("UNUSED")
    val cloudflareClient: OkHttpClient get() = client

    fun defaultUserAgentProvider() = userAgent
}
