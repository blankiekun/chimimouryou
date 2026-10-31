/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.content;

import java.io.File;

/** The part of Context extensions use: preferences, and the folders the host gives them. */
public abstract class Context {
    public static final int MODE_PRIVATE = 0;

    public abstract SharedPreferences getSharedPreferences(String name, int mode);

    public abstract File getCacheDir();

    public abstract File getFilesDir();

    public Context getApplicationContext() { return this; }

    public String getPackageName() { return "app.mihon"; }
}
