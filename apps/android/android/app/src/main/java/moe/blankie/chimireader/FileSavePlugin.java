package moe.blankie.chimireader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Saves the page's downloads (backups, CSVs), which the WebView drops: pick() asks where with
 * Android's "Save to" screen (no storage permission), write() appends base64 chunks, close() ends
 * it (and deletes the file when the page failed). One file at a time. Used by apps/web's
 * lib/data/native-save.ts.
 */
@CapacitorPlugin(name = "FileSave")
public class FileSavePlugin extends Plugin {

    private Uri uri;
    private OutputStream out;

    /** { name, mimeType } */
    @PluginMethod
    public void pick(PluginCall call) {
        closeQuietly(false);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mimeType", "application/octet-stream"))
            .putExtra(Intent.EXTRA_TITLE, call.getString("name", "download"));
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Saving was cancelled", "cancelled");
            return;
        }
        try {
            uri = data.getData();
            out = getContext().getContentResolver().openOutputStream(uri, "w");
            if (out == null) throw new IOException("no output stream");
            call.resolve();
        } catch (IOException e) {
            closeQuietly(false);
            call.reject("Could not save the file: " + e.getMessage(), e);
        }
    }

    /** { data }: base64 */
    @PluginMethod
    public void write(PluginCall call) {
        if (out == null) {
            call.reject("No file is being saved");
            return;
        }
        try {
            out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            closeQuietly(false);
            call.reject("Could not save the file: " + e.getMessage(), e);
        }
    }

    /** { ok }: false deletes the partial file. */
    @PluginMethod
    public void close(PluginCall call) {
        boolean ok = Boolean.TRUE.equals(call.getBoolean("ok", true));
        if (closeQuietly(ok)) call.resolve();
        else call.reject("Could not save the file");
    }

    private boolean closeQuietly(boolean ok) {
        boolean closed = true;
        try {
            if (out != null) out.close();
        } catch (IOException e) {
            closed = false;
        }
        if ((!ok || !closed) && uri != null) {
            try {
                DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
            } catch (Exception ignored) {
                // The provider may not allow deleting: the partial file stays.
            }
        }
        out = null;
        uri = null;
        return closed;
    }
}
