/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package moe.chimimouryou.mihon

import okhttp3.Dns
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * The fence on `network.client` (owner decision 7a): https only, and a host must resolve to
 * public addresses only (no LAN, loopback, link-local, CGNAT/Tailscale, multicast), as the
 * server's fetch proxy. An extension can still build its own client: the repository's trust and
 * the SHA-256 pin are the real fence. `testHosts` (E2E only) may resolve to loopback.
 */
class Guard(private val testHosts: Set<String> = emptySet()) : Dns, Interceptor {
    override fun lookup(hostname: String): List<InetAddress> {
        val addresses = Dns.SYSTEM.lookup(hostname)
        if (hostname.lowercase() in testHosts) return addresses
        val bad = addresses.firstOrNull { !isPublic(it) }
        if (bad != null) throw IOException("$hostname is not a public address")
        return addresses
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val url = chain.request().url
        if (!url.isHttps) throw IOException("Only https: ${url.host}")
        return chain.proceed(chain.request())
    }

    companion object {
        fun isPublic(address: InetAddress): Boolean {
            if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
                address.isSiteLocalAddress || address.isMulticastAddress
            ) {
                return false
            }
            val b = address.address.map { it.toInt() and 0xff }
            return when (address) {
                // 100.64/10 CGNAT and Tailscale, 0/8, 192.0.0/24, 198.18/15 benchmarking, 240/4
                is Inet4Address -> !(
                    b[0] == 0 || (b[0] == 100 && b[1] in 64..127) || (b[0] == 192 && b[1] == 0 && b[2] == 0) ||
                        (b[0] == 198 && b[1] in 18..19) || b[0] >= 240
                    )
                // fc00::/7 unique local; v4-mapped judged as v4
                is Inet6Address -> (b[0] and 0xfe) != 0xfc &&
                    !(b.subList(0, 10).all { it == 0 } && b[10] == 0xff && b[11] == 0xff &&
                        !isPublic(InetAddress.getByAddress(address.address.copyOfRange(12, 16))))
                else -> false
            }
        }
    }
}
