package moe.blankie.chimireader;

import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Holds the app in landscape while a phone is on the visual novel screen (apps/web's android-bars.ts). */
@CapacitorPlugin(name = "LandscapeLock")
public class LandscapeLockPlugin extends Plugin {

    @PluginMethod
    public void lock(PluginCall call) {
        set(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, call);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        set(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, call);
    }

    private void set(int orientation, PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(orientation);
            call.resolve();
        });
    }
}
