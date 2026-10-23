/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The reader's account on the social hub (deploy/social-hub): sign up, log in, the recovery
 * code, and the hub client. The hub is another origin: a bearer token kept in this origin's
 * localStorage, never cookies. Nothing is sent before the reader signs up or logs in, except
 * the salt lookup that logging in starts with. Not part of upstream.
 */

import { scryptAsync } from '@noble/hashes/scrypt';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { BehaviorSubject } from 'rxjs';
import { standalone } from '$lib/data/env';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import type { MessageKey } from '$lib/i18n';

/** Our hub. shortcut: a placeholder until the Worker is deployed; set it then (deploy/social-hub/README.md). */
export const socialHubDefault = 'https://chimi-hub.blankiekun.workers.dev';

/** Another hub (Settings → Social; standalone builds only, server builds use ours) */
export const socialHub$ = writableStringLocalStorageSubject()('socialHub', '');

/** The 24 preset avatars: a kanji on one of 8 colours (theme tokens --avatar-1…8, by index % 8) */
export const avatarKanji = [...'秋蓮澪花空月本猫雪風森星光海桜竹火石鳥夢詩灯雨山'];

export interface SocialMe {
  id: string;
  username: string;
  name: string;
  avatar: number;
  /** The uploaded picture's version, 0 (or absent, older hubs) for the preset */
  picture?: number;
  /** 'dev' for the hub's moderators: the badge and /moderation */
  role?: string;
  code: string;
  share: Partial<Record<ShareKey, boolean>>;
  created: number;
}

export type ShareKey =
  | 'public'
  | 'current'
  | 'finished'
  | 'activity'
  | 'stats'
  | 'wordsKnown'
  | 'hideManga'
  | 'hideVn';

/** On unless turned off, except words known (opt-in) and the hide switches */
export const shareDefaults: Record<ShareKey, boolean> = {
  public: true,
  current: true,
  finished: true,
  activity: true,
  stats: true,
  wordsKnown: false,
  hideManga: false,
  hideVn: false
};

export interface SocialSession {
  token: string;
  me: SocialMe;
}

export const socialSession$ = writableObjectLocalStorageSubject<SocialSession | null>()(
  'socialSession',
  null
);

/** The hub failed without its own answer (unreachable, or over Cloudflare's daily limit): social parts hide. */
export const hubDown$ = new BehaviorSubject(false);

export class HubError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(`Hub: ${code}`);
  }
}

/** The hub's origin: HTTPS, or HTTP on this machine (a local `wrangler dev`). */
export function hubOrigin(address = socialHub$.getValue()) {
  const url = new URL((standalone && address.trim()) || socialHubDefault);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The hub address must start with https://');
  }
  return url.origin;
}

/** An image on the hub: a picture (`avatar/<id>/<version>`) or a cover thumbnail (`cover/<hash>`) */
export function hubImageUrl(path: string) {
  try {
    return `${hubOrigin()}/v1/${path}`;
  } catch (_) {
    return '';
  }
}

/** A person's uploaded picture, '' for the preset */
export function pictureUrl(person: { id: string; picture?: number } | undefined) {
  return person?.picture ? hubImageUrl(`avatar/${person.id}/${person.picture}`) : '';
}

/** keepalive: the request outlives the page (a push when the tab closes). A Blob body is sent as is. */
export async function hubFetch<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  keepalive = false
): Promise<T> {
  const session = socialSession$.getValue();
  const raw = body instanceof Blob;
  let response: Response;

  try {
    response = await fetch(`${hubOrigin()}${path}`, {
      method,
      credentials: 'omit',
      keepalive,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': raw ? body.type : 'application/json' }),
        ...(session ? { Authorization: `Bearer ${session.token}` } : {})
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
  } catch (_) {
    hubDown$.next(true);
    throw new HubError(0, 'network');
  }

  const data = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (!data?.error) hubDown$.next(true);
    if (response.status === 401 && data?.error === 'session') socialSession$.next(null);
    throw new HubError(response.status, data?.error ?? 'hub');
  }
  hubDown$.next(false);
  return data as T;
}

/**
 * The password stretched on this device (the hub's Workers have 10 ms of CPU): scrypt
 * N=2^16, r=8, p=1 (64 MB). Measured with @noble/hashes: ~165 ms in Node 24 on a desktop CPU.
 */
export async function stretchPassword(password: string, salt: string) {
  return bytesToHex(
    await scryptAsync(password.normalize('NFKC'), salt, { N: 2 ** 16, r: 8, p: 1, dkLen: 32 })
  );
}

async function saltFor(username: string) {
  return (await hubFetch<{ salt: string }>('/v1/salt', 'POST', { username })).salt;
}

/** Returns the recovery code, shown once. */
export async function signUp(username: string, name: string, password: string) {
  const salt = bytesToHex(randomBytes(16));
  const key = await stretchPassword(password, salt);
  const { token, recovery, me } = await hubFetch<SocialSession & { recovery: string }>(
    '/v1/signup',
    'POST',
    { username, name, salt, key }
  );

  socialSession$.next({ token, me });
  return recovery;
}

export async function logIn(username: string, password: string) {
  const key = await stretchPassword(password, await saltFor(username));

  socialSession$.next(await hubFetch<SocialSession>('/v1/login', 'POST', { username, key }));
}

/** A new password with the recovery code; returns the new recovery code. Other devices are signed out. */
export async function recoverAccount(username: string, recovery: string, password: string) {
  const key = await stretchPassword(password, await saltFor(username));
  const result = await hubFetch<SocialSession & { recovery: string }>('/v1/recover', 'POST', {
    username,
    recovery,
    key
  });

  socialSession$.next({ token: result.token, me: result.me });
  return result.recovery;
}

function forget() {
  socialSession$.next(null);
  window.localStorage.removeItem('socialFriends');
  window.localStorage.removeItem('socialBooks');
  window.localStorage.removeItem('socialFeed');
  window.localStorage.removeItem('socialFinishedPending');
}

export async function logOut() {
  await hubFetch('/v1/logout', 'POST').catch(() => {});
  forget();
}

/** Ends every session of the account, this one too. */
export async function logOutEverywhere() {
  await hubFetch('/v1/logout-all', 'POST');
  forget();
}

function sessionSalt() {
  const session = socialSession$.getValue();

  if (!session) throw new HubError(401, 'session');
  return saltFor(session.me.username);
}

/** A new password (checked against the current one); other devices are signed out. */
export async function changeSocialPassword(current: string, next: string) {
  const salt = await sessionSalt();
  const key = await stretchPassword(current, salt);

  await hubFetch('/v1/password', 'POST', { key, next: await stretchPassword(next, salt) });
}

/** A new recovery code for the current password; returns it, shown once. */
export async function newRecoveryCode(password: string) {
  const key = await stretchPassword(password, await sessionSalt());

  return (await hubFetch<{ recovery: string }>('/v1/recovery', 'POST', { key })).recovery;
}

export async function deleteSocialAccount() {
  await hubFetch('/v1/me', 'DELETE');
  forget();
}

function setMe(me: SocialMe) {
  const session = socialSession$.getValue();

  if (session) socialSession$.next({ ...session, me });
  return me;
}

export async function updateProfile(patch: Partial<Pick<SocialMe, 'name' | 'avatar' | 'share'>>) {
  return setMe(await hubFetch<SocialMe>('/v1/me', 'PUT', patch));
}

type ProfilePatch = Partial<Pick<SocialMe, 'name' | 'avatar' | 'share'>>;

let pendingPatch: ProfilePatch = {};
let patchTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Profile changes from Settings and the profile: shown at once, sent together after a pause
 * (the hub takes 10 a day). A share turned off is deleted on the hub with it.
 */
export function queueProfileChange(patch: ProfilePatch, onError: (error: unknown) => void) {
  const session = socialSession$.getValue();

  if (!session) return;
  pendingPatch = {
    ...pendingPatch,
    ...patch,
    share: { ...pendingPatch.share, ...patch.share }
  };
  socialSession$.next({
    ...session,
    me: { ...session.me, ...patch, share: { ...session.me.share, ...patch.share } }
  });
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => flushProfileChanges().catch(onError), 1500);
}

export async function flushProfileChanges() {
  const patch = pendingPatch;

  clearTimeout(patchTimer);
  pendingPatch = {};
  if (!Object.keys(patch.share ?? {}).length) delete patch.share;
  if (Object.keys(patch).length) await updateProfile(patch);
}

/** A 256 px WebP from the crop (social-images.ts); 5 a day on the hub */
export async function uploadPicture(picture: Blob) {
  return setMe(await hubFetch<SocialMe>('/v1/avatar', 'PUT', picture));
}

/** Back to the preset */
export async function removePicture() {
  return setMe(await hubFetch<SocialMe>('/v1/avatar', 'DELETE'));
}

/** The account as the hub has it now (a role granted since signing in) */
export async function refreshMe() {
  return setMe(await hubFetch<SocialMe>('/v1/me'));
}

/** Retires the friend code for a new one; friends stay. */
export async function newFriendCode() {
  return setMe(await hubFetch<SocialMe>('/v1/code', 'POST'));
}

/** Codes as people type them: any case, dashes and spaces (the hub also reads O as 0, I and L as 1) */
export function normalizeCode(text: string) {
  return text.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** K7QM2XPA → K7QM-2XPA; recovery codes in groups of five */
export function formatCode(code: string, group = 4) {
  return code.replace(new RegExp(`(.{${group}})(?=.)`, 'g'), '$1-');
}

/** What the hub's error codes mean, as i18n keys */
export function hubErrorKey(error: unknown): MessageKey {
  const code = error instanceof HubError ? error.code : '';
  const known = [
    'taken',
    'credentials',
    'locked',
    'limit',
    'code',
    'self',
    'friends',
    'pending',
    'username',
    'user',
    'name',
    'network',
    'paused'
  ];

  return `social.error.${known.includes(code) ? code : 'other'}` as MessageKey;
}
