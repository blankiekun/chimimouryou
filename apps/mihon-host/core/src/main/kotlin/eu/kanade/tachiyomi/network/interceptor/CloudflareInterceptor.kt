/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package eu.kanade.tachiyomi.network.interceptor

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/**
 * Extensions check that the default client has an interceptor by this simple name. Mihon's solves
 * the challenge in a hidden WebView; this one only names it (no Cloudflare handling in phase 1).
 */
class CloudflareInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        if (response.code in ERROR_CODES && response.header("Server") in SERVER_CHECK) {
            response.close()
            throw IOException("Cloudflare blocks ${chain.request().url.host}; not supported yet")
        }
        return response
    }

    private companion object {
        val ERROR_CODES = listOf(403, 503)
        val SERVER_CHECK = arrayOf("cloudflare-nginx", "cloudflare")
    }
}
