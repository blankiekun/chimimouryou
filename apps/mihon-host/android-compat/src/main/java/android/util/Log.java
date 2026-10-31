/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.util;

/** Android logging on the host's stderr (stdout carries the protocol). */
public final class Log {
    private Log() {}

    private static int print(String level, String tag, String msg, Throwable tr) {
        System.err.println(level + "/" + tag + ": " + msg);
        if (tr != null) tr.printStackTrace(System.err);
        return 0;
    }

    public static int v(String tag, String msg) { return 0; }
    public static int v(String tag, String msg, Throwable tr) { return 0; }
    public static int d(String tag, String msg) { return 0; }
    public static int d(String tag, String msg, Throwable tr) { return 0; }
    public static int i(String tag, String msg) { return print("I", tag, msg, null); }
    public static int i(String tag, String msg, Throwable tr) { return print("I", tag, msg, tr); }
    public static int w(String tag, String msg) { return print("W", tag, msg, null); }
    public static int w(String tag, String msg, Throwable tr) { return print("W", tag, msg, tr); }
    public static int w(String tag, Throwable tr) { return print("W", tag, "", tr); }
    public static int e(String tag, String msg) { return print("E", tag, msg, null); }
    public static int e(String tag, String msg, Throwable tr) { return print("E", tag, msg, tr); }
}
