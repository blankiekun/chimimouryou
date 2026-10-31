/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.content;

import android.net.Uri;
import java.util.HashMap;
import java.util.Map;

/** Enough for an extension's UrlActivity to build its intent; nothing ever receives it. */
public class Intent {
    private String action;
    private Uri data;
    private final Map<String, Object> extras = new HashMap<>();

    public Intent() {}

    public Intent(String action) { this.action = action; }

    public Intent setAction(String action) {
        this.action = action;
        return this;
    }

    public String getAction() { return action; }

    public Uri getData() { return data; }

    public Intent setData(Uri data) {
        this.data = data;
        return this;
    }

    public Intent putExtra(String name, String value) {
        extras.put(name, value);
        return this;
    }

    public String getStringExtra(String name) { return (String) extras.get(name); }

    public Intent addFlags(int flags) { return this; }

    public Intent setFlags(int flags) { return this; }
}
