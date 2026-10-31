/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.widget;

/** EditTextPreference hands one to its bind listener; there is no settings screen on the desktop. */
public class EditText {
    private CharSequence text = "";

    public CharSequence getText() { return text; }

    public void setText(CharSequence text) { this.text = text; }

    public void setHint(CharSequence hint) {}

    public void setInputType(int type) {}
}
