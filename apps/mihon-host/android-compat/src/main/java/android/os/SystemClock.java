/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.os;

public final class SystemClock {
    private static final long START = System.nanoTime();

    private SystemClock() {}

    public static long uptimeMillis() { return (System.nanoTime() - START) / 1_000_000; }

    public static long elapsedRealtime() { return uptimeMillis(); }

    public static long elapsedRealtimeNanos() { return System.nanoTime() - START; }

    public static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
