package moe.blankie.chimireader;

import com.getcapacitor.BridgeActivity;

/** The `github` flavor's own plugins: the Mihon extension host. */
final class FlavorPlugins {

    static void register(BridgeActivity activity) {
        activity.registerPlugin(MihonHostPlugin.class);
    }
}
