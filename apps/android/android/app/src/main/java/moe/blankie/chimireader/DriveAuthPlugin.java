package moe.blankie.chimireader;

import android.app.Activity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

/**
 * Google Drive access tokens from Play services' Authorization API (Google refuses its web sign-in
 * in a WebView). The Android OAuth client is matched by package name and signing key, so nothing
 * here holds a client id. No refresh token: an expired token is asked for again, silently once
 * the reader has consented. Used by apps/web's lib/data/standalone/android-drive.ts.
 */
@CapacitorPlugin(name = "DriveAuth")
public class DriveAuthPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall pending;

    @Override
    public void load() {
        consent = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), (result) -> {
            PluginCall call = pending;
            pending = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) {
                call.reject("Sign-in was cancelled", "cancelled");
                return;
            }
            try {
                resolve(call, client().getAuthorizationResultFromIntent(result.getData()));
            } catch (ApiException e) {
                call.reject("Sign-in failed: " + e.getStatusCode(), e);
            }
        });
    }

    private AuthorizationClient client() {
        return Identity.getAuthorizationClient(getActivity());
    }

    private void resolve(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("Google gave no access token");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", token);
        call.resolve(ret);
    }

    /** { scope, interactive }: interactive may show Google's account and consent screens. */
    @PluginMethod
    public void authorize(PluginCall call) {
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) != ConnectionResult.SUCCESS) {
            call.reject("Google Drive needs Google Play services", "unavailable");
            return;
        }
        String scope = call.getString("scope", "https://www.googleapis.com/auth/drive.file");
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(scope)))
            .build();
        client()
            .authorize(request)
            .addOnSuccessListener((result) -> {
                if (!result.hasResolution()) {
                    resolve(call, result);
                } else if (!interactive) {
                    call.reject("Sign in to Drive again", "needsConsent");
                } else if (pending != null) {
                    call.reject("A sign-in is already open");
                } else {
                    pending = call;
                    consent.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
                }
            })
            .addOnFailureListener((e) -> call.reject("Sign-in failed: " + e.getMessage(), e));
    }
}
