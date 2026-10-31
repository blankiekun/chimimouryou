/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.util.concurrent.ConcurrentHashMap;
import moe.chimimouryou.mihon.compat.JsonSharedPreferences;

/** The host's one Application: preferences as JSON files under its data folder. */
public class Application extends Context {
    private final File dir;
    private final ConcurrentHashMap<String, SharedPreferences> prefs = new ConcurrentHashMap<>();

    public Application(File dir) { this.dir = dir; }

    @Override
    public SharedPreferences getSharedPreferences(String name, int mode) {
        return prefs.computeIfAbsent(name, n -> new JsonSharedPreferences(new File(new File(dir, "prefs"), n.replaceAll("[^A-Za-z0-9._-]", "_") + ".json")));
    }

    @Override
    public File getCacheDir() { return new File(dir, "cache"); }

    @Override
    public File getFilesDir() { return new File(dir, "files"); }
}
