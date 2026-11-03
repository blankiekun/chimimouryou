package moe.blankie.chimireader;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.UnknownHostException;

/**
 * Refuses a host that resolves to a non-public address, before an extension's request goes out
 * (apps/web's lib/data/sources/transport.ts). The same ranges as the server's fetch proxy and the
 * Mihon host's Guard.kt.
 */
@CapacitorPlugin(name = "PublicAddress")
public class PublicAddressPlugin extends Plugin {

    /** { host }: resolves if every address of the host is public. */
    @PluginMethod
    public void check(PluginCall call) {
        String host = call.getString("host", "");
        try {
            for (InetAddress address : InetAddress.getAllByName(host)) {
                if (!isPublic(address)) {
                    call.reject(host + " is not a public address");
                    return;
                }
            }
            call.resolve();
        } catch (UnknownHostException e) {
            call.reject("Can't find " + host, e);
        }
    }

    static boolean isPublic(InetAddress address) {
        if (
            address.isAnyLocalAddress() ||
            address.isLoopbackAddress() ||
            address.isLinkLocalAddress() ||
            address.isSiteLocalAddress() ||
            address.isMulticastAddress()
        ) {
            return false;
        }
        byte[] raw = address.getAddress();
        if (address instanceof Inet4Address) {
            int a = raw[0] & 0xff;
            int b = raw[1] & 0xff;
            // 0/8, 100.64/10 CGNAT and Tailscale, 192.0.0/24, 198.18/15 benchmarking, 240/4
            return !(
                a == 0 ||
                (a == 100 && b >= 64 && b <= 127) ||
                (a == 192 && b == 0 && (raw[2] & 0xff) == 0) ||
                (a == 198 && (b == 18 || b == 19)) ||
                a >= 240
            );
        }
        // fc00::/7 unique local
        return (raw[0] & 0xfe) != 0xfc;
    }
}
