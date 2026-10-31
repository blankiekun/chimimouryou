/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.content;

public class ActivityNotFoundException extends RuntimeException {
    public ActivityNotFoundException() {}

    public ActivityNotFoundException(String name) { super(name); }
}
