/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * How long the analysis worker (Sudachi and Pyodide, ~700 MB) stays alive after its last job, by
 * the machine (analysis-tools.ts). Kept alive, the next job (the book's other part, the next book of
 * a background run) skips the ~2 s start. Small machines (4 cores or fewer, under 8 GB), 0, keep it
 * only for the book's other part and end it after the book: ~300 MB less at a batch's peak.
 * deviceMemory is Chromium's, capped at 8; other browsers don't say and count by their cores. Not part of upstream.
 */
export function analysisKeepAlive(
  machine: { hardwareConcurrency?: number; deviceMemory?: number } = navigator
) {
  const small =
    (machine.hardwareConcurrency ?? 8) <= 4 ||
    (machine.deviceMemory !== undefined && machine.deviceMemory < 8);

  return small ? 0 : 10_000;
}

/**
 * How many analysis workers run at once: two on machines that keep the worker (background batches
 * then analyse two books at once, ~1.3-1.6x faster, ~400-700 MB more), one on small ones.
 */
export function analysisWorkers(
  machine: { hardwareConcurrency?: number; deviceMemory?: number } = navigator
) {
  return analysisKeepAlive(machine) ? 2 : 1;
}
