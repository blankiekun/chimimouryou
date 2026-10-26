/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The Discord plugin's hub relay (Settings → Discord → Show activity from my other devices):
 * this device PUTs its rendered activity to the social hub's /v1/presence, which a paired Anki
 * add-on on a computer reads. Budget rules (SPEC): a change is sent at most once a minute, a
 * page turn refreshes it when it is within 2 minutes of expiring (ttl = Away minutes, 5-30),
 * DELETE on Away, leaving or switching off; no timer keeps it alive. Also pairing (a presence
 * key handed to this computer's add-on, or a code typed into Anki) and Unpair. Nothing goes to
 * the hub unless the discord and social plugins, Show my status and the switch are on and the
 * reader is signed in to the hub. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { activityKey, type DiscordActivity, type DiscordKind } from '$lib/data/discord-template';
import { discordOptions } from '$lib/data/discord-settings';
import { hubFetch, hubOrigin, socialSession$ } from '$lib/data/social-account';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

const addonUrl = 'http://127.0.0.1:41918';
export const relayGap = 60_000;
const refreshLeft = 2 * 60_000;
/** The add-on key this browser paired automatically (Unpair also unpairs this computer's add-on) */
const pairedKeyItem = 'discordPairedKey';
/** Set by Unpair on this computer: no automatic pairing until the relay switch is turned on again */
const noAutoPairItem = 'discordNoAutoPair';

/** Minutes the hub keeps a status: the Away time, clamped like the hub does */
export const relayTtl = () => Math.min(30, Math.max(5, Math.round(discordOptions().awayMinutes)));

export const relayAllowed = () => {
  const plugins = enabledPlugins$.getValue();
  const options = discordOptions();

  return (
    plugins.includes('discord') &&
    plugins.includes('social') &&
    options.show &&
    options.relay &&
    !!socialSession$.getValue()
  );
};

/** Epoch ms of this device's last send to the hub */
export const relayLastSent$ = new BehaviorSubject<number | null>(null);

let current: { kind: DiscordKind; activity: DiscordActivity } | undefined;
let lastKey = '';
let lastAt = 0;
let sent = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function send() {
  timer = undefined;
  if (!current || !relayAllowed()) return;

  const { kind, activity } = current;
  const key = `${kind}:${activityKey(activity)}`;

  lastKey = key;
  lastAt = Date.now();
  sent = true;
  hubFetch('/v1/presence', 'PUT', { activity, kind, ttl: relayTtl() })
    .then(() => relayLastSent$.next(Date.now()))
    .catch(() => {
      // 429 "soon" or offline: the next change or page turn tries again.
      if (lastKey === key) lastKey = '';
    });
}

function schedule() {
  const wait = lastAt + relayGap - Date.now();

  if (wait <= 0) send();
  else timer ??= setTimeout(send, wait);
}

/** The activity this device shows now: sent when it changed, at most once a minute (the newest wins) */
export function relayActivity(kind: DiscordKind, activity: DiscordActivity | undefined) {
  if (!activity) {
    relayClear();
    return;
  }
  if (!relayAllowed()) return;
  current = { kind, activity };
  if (`${kind}:${activityKey(activity)}` === lastKey) {
    clearTimeout(timer);
    timer = undefined;
    return;
  }
  schedule();
}

/** A page turn: resend an unchanged status before the hub lets it expire */
export function relayPageTurn() {
  if (!sent || !current || timer || !relayAllowed()) return;
  if (Date.now() - lastAt > relayTtl() * 60_000 - refreshLeft) schedule();
}

/** DELETE, once, if this device sent a status */
export function relayClear(keepalive = false) {
  clearTimeout(timer);
  timer = undefined;
  current = undefined;
  if (!sent) return;
  sent = false;
  lastKey = '';
  if (socialSession$.getValue()) {
    hubFetch('/v1/presence', 'DELETE', undefined, keepalive).catch(() => {});
  }
}

/** For tests */
export function resetRelay() {
  clearTimeout(timer);
  timer = current = undefined;
  lastKey = '';
  lastAt = 0;
  sent = false;
  relayLastSent$.next(null);
}

// Pairing (the hub's /v1/presence/keys and /codes; the add-on's /v1/pair)

export interface PairedAddon {
  id: string;
  name: string;
  /** Unix seconds */
  createdAt: number;
  lastSeen: number | null;
}

export const pairedAddons = () => hubFetch<PairedAddon[]>('/v1/presence/keys');

/** A one-time code for Anki → Tools → Pair chimimouryou Discord… (expiresAt in Unix seconds) */
export const newPairingCode = () =>
  hubFetch<{ code: string; expiresAt: number }>('/v1/presence/codes', 'POST');

const addonPair = (method: 'PUT' | 'DELETE', body?: unknown) =>
  fetch(`${addonUrl}/v1/pair`, {
    method,
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout?.(5000)
  });

/** A new presence key handed to this computer's add-on; the key is dropped again if the add-on refuses it */
export async function pairAutomatically(name: string) {
  const { id, key } = await hubFetch<{ id: string; key: string }>('/v1/presence/keys', 'POST', {
    name
  });
  const response = await addonPair('PUT', { hub: hubOrigin(), key }).catch(() => undefined);

  if (!response?.ok) {
    await hubFetch(`/v1/presence/keys/${id}`, 'DELETE').catch(() => {});
    throw new Error('addon');
  }
  window.localStorage.setItem(pairedKeyItem, id);
  return id;
}

/** Revokes the key on the hub; this computer's add-on forgets it too when it is the one paired here */
export async function unpairAddon(id: string) {
  await hubFetch(`/v1/presence/keys/${id}`, 'DELETE');
  if (window.localStorage.getItem(pairedKeyItem) === id) {
    window.localStorage.removeItem(pairedKeyItem);
    window.localStorage.setItem(noAutoPairItem, '1');
    await addonPair('DELETE').catch(() => {});
  }
}

export const autoPairAllowed = () => !window.localStorage.getItem(noAutoPairItem);

/** The relay switch turned on: automatic pairing may run again */
export const allowAutoPair = () => window.localStorage.removeItem(noAutoPairItem);
