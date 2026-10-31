/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.graphics;

/** Canvas draws bitmaps without paint effects: descrambling only copies tiles. */
public class Paint {
    public static final int ANTI_ALIAS_FLAG = 1;
    public static final int FILTER_BITMAP_FLAG = 2;

    public Paint() {}

    public Paint(int flags) {}

    public void setAntiAlias(boolean aa) {}

    public void setFilterBitmap(boolean filter) {}
}
