/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { hubFetch } from '$lib/data/social-account';
import type { Person, SocialEvent } from '$lib/data/social';

/** The hub's moderation API (`/v1/admin/*`, role 'dev' only; /moderation). Not part of upstream. */

export interface OpenReport {
  what: 'name' | 'picture' | 'cover';
  /** A user id, or for covers the book key */
  target: string;
  count: number;
  first: number;
  last: number;
  /** The reported reader (names and pictures) */
  user: Person | null;
  /** Covers: the thumbnail's file, whether it is already removed, a title and who uploaded it */
  cover: string | null;
  removed: boolean;
  title: string;
  uploader: string;
}

export interface LookedUp {
  user: Person & { created: number; lastSeen: number; public: boolean };
  books: {
    slot: number;
    key: string;
    title: string;
    author: string;
    kind: string;
    pct: number;
    readAt: number;
  }[];
  finished: { key: string; title: string; kind: string; month: string; at: number }[];
  events: SocialEvent[];
}

export type UserRows = 'status' | 'finished' | 'events';

export async function loadReports() {
  return (await hubFetch<{ reports: OpenReport[] }>('/v1/admin/reports')).reports;
}

export async function dismissReports(report: Pick<OpenReport, 'what' | 'target'>) {
  const query = new URLSearchParams({ what: report.what, target: report.target });

  await hubFetch(`/v1/admin/reports?${query}`, 'DELETE');
}

/** The thumbnail goes (title card instead) and the key takes no new one */
export async function removeCover(key: string) {
  await hubFetch(`/v1/admin/cover?${new URLSearchParams({ key })}`, 'DELETE');
}

export async function lookUpUser(username: string) {
  return hubFetch<LookedUp>(`/v1/admin/user/${encodeURIComponent(username)}`);
}

/** The display name becomes the username */
export async function resetName(userId: string) {
  await hubFetch(`/v1/admin/user/${userId}/name`, 'POST');
}

export async function removeUserPicture(userId: string) {
  await hubFetch(`/v1/admin/user/${userId}/picture`, 'DELETE');
}

/** One row: a current book (by slot), a finished book (by key) or an event (by id) */
export async function deleteUserRow(userId: string, rows: UserRows, id: string | number) {
  await hubFetch(`/v1/admin/user/${userId}/${rows}/${encodeURIComponent(String(id))}`, 'DELETE');
}
