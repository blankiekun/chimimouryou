package moe.blankie.chimireader;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DriveAuthPlugin.class);
        registerPlugin(FileSavePlugin.class);
        super.onCreate(savedInstanceState);

        // The readers hide the bars (Capacitor's SystemBars, android-bars.ts); a swipe from the
        // edge shows them for a moment over the page instead of bringing them back for good.
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        // Back goes back in the app's history; at its first page it leaves the app.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });
    }
}
