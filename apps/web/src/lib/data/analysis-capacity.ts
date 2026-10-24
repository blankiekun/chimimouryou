/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * How long the analysis worker (Sudachi and Pyodide, ~700 MB) stays alive after its last job, by
 * the machine (analysis-tools.ts). Kept alive, the next job (the book's other part, the next book of
 * a background run) skips the ~2 s start. Small machines (4 cores or fewer, under 8 GB) end it after
 * every job instead: ~300 MB less at a batch's peak, ~2 s more per part. deviceMemory is
 * Chromium's, capped at 8; other browsers don't say and count by their cores. Not part of upstream.
 */
export function analysisKeepAlive(
  machine: { hardwareConcurrency?: number; deviceMemory?: number } = navigator
) {
  const small =
    (machine.hardwareConcurrency ?? 8) <= 4 ||
    (machine.deviceMemory !== undefined && machine.deviceMemory < 8);

  return small ? 0 : 10_000;
}
