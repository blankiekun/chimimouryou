/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Which difficulty engine made an estimate. Every estimate (the server's difficulty service and the
 * browser's analysis tools) carries `engine`, a fingerprint of the models, the scoring code, the
 * frequency list, yurigana and the Sudachi dictionary (scripts/calibre/jiten/engine.py), and
 * difficulty-engine.json is this release's. An estimate from another engine (an older one, a
 * server's own frequency list or term dictionaries) is still shown, but only canonical ones count
 * where estimates must be comparable (reading rank). Not part of upstream.
 */

import release from '$lib/data/difficulty-engine.json';

export const canonicalEngine: string = release.engine;

/** Whether the estimate was made by this release's engine; estimates without `engine` are not. */
export function isCanonicalEstimate(estimate: { engine?: string } | null | undefined) {
  return !!estimate?.engine && estimate.engine === canonicalEngine;
}
