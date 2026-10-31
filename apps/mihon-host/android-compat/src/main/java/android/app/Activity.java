/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.app;

import android.content.Intent;
import android.os.Bundle;

/** Extensions ship a UrlActivity (open a link in Mihon); the desktop never starts one. */
public class Activity {
    public Activity() {}

    protected void onCreate(Bundle savedInstanceState) {}

    public Intent getIntent() { return new Intent(); }

    public void startActivity(Intent intent) {}

    public void finish() {}
}
