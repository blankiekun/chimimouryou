/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { hubFetch } from '$lib/data/social/social-account';
import type { Person, SocialEvent } from '$lib/data/social/social';

/** The hub's moderation API (`/v1/admin/*`, role 'dev' only; /moderation). Not part of upstream. */

export interface OpenReport {
  what: 'name' | 'picture' | 'cover';
  /** A user id, or for covers "<uploader id>:<book key>" */
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

export async function dismissReports(report: { what: string; target: string }) {
  const query = new URLSearchParams({ what: report.what, target: report.target });

  await hubFetch(`/v1/admin/reports?${query}`, 'DELETE');
}

/** One reader's thumbnail goes (title card instead) and they can't upload another for the key */
export async function removeCover(target: string) {
  await hubFetch(`/v1/admin/cover?${new URLSearchParams({ target })}`, 'DELETE');
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

/** Community reports (`/v1/admin/community/*`): posts, work matches, and works' titles and covers */
export interface CommunityReports {
  posts: {
    id: string;
    count: number;
    last: number;
    work: string;
    line: string;
    body: string;
    spoiler: boolean;
    quote: string;
    at: number;
    author: Person | null;
  }[];
  /** `target` is "<vol>|<book key>"; `work` the key it maps to, with its confirmations */
  works: { target: string; count: number; last: number; work: string | null; votes: number }[];
  infos: {
    work: string;
    count: number;
    last: number;
    title: string;
    vol: string;
    cover: string | null;
    uploader: string;
  }[];
}

export function loadCommunityReports() {
  return hubFetch<CommunityReports>('/v1/admin/community/reports');
}

export async function removePost(id: string) {
  await hubFetch(`/v1/admin/community/post/${id}`, 'DELETE');
}

/** Every post of one reader goes (posts with replies stay as tombstones) */
export async function removeUserPosts(userId: string) {
  await hubFetch(`/v1/admin/community/user/${userId}/posts`, 'DELETE');
}

/** Clear match: drops the confirmations that map a book to the wrong work */
export async function clearMatch(target: string, work: string) {
  const split = target.indexOf('|');
  const query = new URLSearchParams({
    vol: target.slice(0, split),
    book: target.slice(split + 1),
    work
  });

  await hubFetch(`/v1/admin/community/work?${query}`, 'DELETE');
}

/** The work's title and cover go (the next post names it again) */
export async function resetWorkInfo(work: string) {
  await hubFetch(`/v1/admin/community/workinfo?${new URLSearchParams({ work })}`, 'DELETE');
}
