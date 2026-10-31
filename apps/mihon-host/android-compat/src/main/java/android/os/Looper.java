/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.os;

/** One looper: Handler runs its posts on a single background thread. */
public final class Looper {
    private static final Looper MAIN = new Looper();

    private Looper() {}

    public static Looper getMainLooper() { return MAIN; }

    public static Looper myLooper() { return MAIN; }
}
