/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.os;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Posts run in order on one daemon thread, as on a looper. */
public class Handler {
    private static final ScheduledExecutorService THREAD = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "android-main");
        t.setDaemon(true);
        return t;
    });

    public Handler() {}

    public Handler(Looper looper) {}

    public boolean post(Runnable r) {
        THREAD.execute(r);
        return true;
    }

    public boolean postDelayed(Runnable r, long delayMillis) {
        THREAD.schedule(r, delayMillis, TimeUnit.MILLISECONDS);
        return true;
    }
}
