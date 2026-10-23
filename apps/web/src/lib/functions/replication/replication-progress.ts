/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Entry } from '@zip.js/zip.js';
import { Subject } from 'rxjs';

export interface ReplicationContext {
  title: string;
  id?: number;
  imagePath?: string | Blob | Entry;
  /** A visual novel kept on this device: its book data is not replicated. */
  keepOnDevice?: boolean;
}

export interface ReplicationProgress {
  progressToAdd?: number;
  progressBase?: number;
  maxProgress?: number;
  skipStep?: boolean;
  completeStep?: boolean;
  /** Bytes done in a long phase of the current step (large visual novels), for the label */
  bytes?: BytesProgress;
}

export type BytesPhase = 'reading' | 'saving' | 'packing' | 'uploading';

export interface BytesProgress {
  phase: BytesPhase;
  done: number;
  total: number;
}

export interface ReplicationDeleteResult {
  error: string;
  deleted: number[];
}

export const replicationProgress$ = new Subject<ReplicationProgress>();
export function reportBytes(phase: BytesPhase, done: number, total: number) {
  replicationProgress$.next({ bytes: { phase, done, total } });
}

export const executeReplicate$ = new Subject<void>();
