/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * AI connections and which one each feature uses, with per-id merging for sync.
 * Not part of upstream.
 */

import { combineLatest, map } from 'rxjs';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiFeatureDefaults,
  aiFeatures$,
  defaultAiFeatures,
  type AiConnection,
  type AiFeature,
  type AiFeatureSetting,
  type AiSamplers
} from '$lib/data/ai-settings';
import { connectionBaseUrl, findProvider, type AiProvider } from '$lib/data/ai-providers';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';

/** A model from a provider's list. */
export interface AiModel {
  id: string;
  name?: string;
  /** Context window in tokens */
  context?: number;
  /** US dollars per million input tokens */
  price?: number;
  free?: boolean;
  /** OpenRouter's supported_parameters */
  params?: string[];
}

export interface AiConnectionTest {
  ok: boolean;
  title: string;
  detail: string;
  at: number;
}

/** Per browser, not synced: each connection's model list and last test. */
export interface AiConnectionCache {
  models?: AiModel[];
  loadedAt?: number;
  /** ElevenLabs: voices in the account's library */
  voices?: number;
  /** ElevenLabs: the voices themselves, for the Voice picker */
  voiceList?: { id: string; name: string; lang?: string }[];
  test?: AiConnectionTest;
}

export const aiConnectionCache$ = writableObjectLocalStorageSubject<
  Record<string, AiConnectionCache>
>()('aiModelCache', {});

export function updateConnectionCache(id: string, changes: Partial<AiConnectionCache>) {
  const cache = aiConnectionCache$.getValue();

  aiConnectionCache$.next({ ...cache, [id]: { ...cache[id], ...changes } });
}

export function liveConnections(kind?: AiConnection['kind']) {
  return aiConnections$
    .getValue()
    .filter((connection) => !connection.deleted && (!kind || connection.kind === kind));
}

/** Per id, the newer `modified` wins; deletions stay as tombstones so they reach every device. */
export function mergeConnections(local: AiConnection[], remote: AiConnection[]) {
  const merged = new Map<string, AiConnection>();

  [...(remote ?? []), ...(local ?? [])].forEach((connection) => {
    const other = merged.get(connection.id);

    if (!other || connection.modified > other.modified) {
      merged.set(connection.id, connection);
    }
  });

  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Where a connection's key goes: a synced edit of either drops the key in this browser. */
function keyTarget(connection: AiConnection) {
  const provider = findProvider(connection.provider);

  return {
    provider: connection.provider,
    base: provider ? connectionBaseUrl(provider, connection.endpoint) : (connection.endpoint ?? '')
  };
}

/** The connection's key, if it was saved for the provider and address the connection has now. */
export function connectionKey(connection: AiConnection) {
  const stored = aiConnectionKeys$.getValue()[connection.id];
  const target = keyTarget(connection);

  return typeof stored === 'object' &&
    stored !== null &&
    stored.provider === target.provider &&
    stored.base === target.base
    ? stored.key
    : '';
}

// Keys saved before they were bound go with their connection as this browser has it, before any
// settings sync can change it.
const legacyKeys = Object.entries(aiConnectionKeys$.getValue()).filter(
  ([id, key]) => typeof key === 'string' && aiConnections$.getValue().some((c) => c.id === id)
);

if (legacyKeys.length) {
  aiConnectionKeys$.next({
    ...aiConnectionKeys$.getValue(),
    ...Object.fromEntries(
      legacyKeys.map(([id, key]) => [
        id,
        { key: key as string, ...keyTarget(aiConnections$.getValue().find((c) => c.id === id)!) }
      ])
    )
  });
}

export function featureSetting(feature: AiFeature): AiFeatureSetting {
  return { ...defaultAiFeatures[feature], ...aiFeatures$.getValue()[feature] };
}

/** The feature's settings over its defaults, without the ones turned off (null). */
export function featureParams(feature: AiFeature): AiSamplers {
  const params: Record<string, unknown> = {
    ...(feature === 'voice' ? {} : aiFeatureDefaults[feature]),
    ...featureSetting(feature).params
  };

  Object.keys(params).forEach((name) => {
    if (params[name] === null || params[name] === undefined) {
      delete params[name];
    }
  });

  return params as AiSamplers;
}

export interface ResolvedFeature {
  feature: AiFeature;
  connection?: AiConnection;
  provider?: AiProvider;
  key: string;
  model: string;
  params: AiSamplers;
  /** The feature uses another one's connection and model */
  inherited: boolean;
}

/** Connection value of the AI voice that picks this device's Web Speech voices. */
export const deviceVoice = 'device';

const parentFeature: Partial<Record<AiFeature, AiFeature>> = { lore: 'recap', recap: 'ask' };

/** The model a feature uses on a provider when none is chosen. */
export function defaultModel(provider: AiProvider, feature: AiFeature, connectionId: string) {
  const defaults = provider.defaultModels ?? {};
  const own =
    feature === 'voice' ? defaults.voice : defaults[feature === 'lore' ? 'recap' : feature];

  return (
    own ||
    (feature === 'voice' ? '' : defaults.ask) ||
    provider.models?.[0] ||
    aiConnectionCache$.getValue()[connectionId]?.models?.[0]?.id ||
    ''
  );
}

/** Which connection, key, model and settings a feature uses right now. */
export function resolveFeature(feature: AiFeature): ResolvedFeature {
  const setting = featureSetting(feature);
  const parent = parentFeature[feature];

  if (setting.connection === 'inherit' && parent) {
    return { ...resolveFeature(parent), feature, params: featureParams(feature), inherited: true };
  }

  const live = liveConnections(feature === 'voice' ? 'voice' : 'text');
  // 'device': the AI voice reads with this device's voices even when a voice connection exists.
  const connection =
    setting.connection === deviceVoice
      ? undefined
      : (live.find((c) => c.id === setting.connection) ?? live[0]);

  const provider = findProvider(connection?.provider);

  return {
    feature,
    connection,
    provider,
    key: connection ? connectionKey(connection) : '',
    model:
      (connection?.id === setting.connection && setting.model) ||
      (provider && connection ? defaultModel(provider, feature, connection.id) : ''),
    params: featureParams(feature),
    inherited: false
  };
}

/** The feature has a connection with a key (or one that needs none). */
export function featureReady(feature: AiFeature) {
  return isReady(resolveFeature(feature));
}

export function isReady({ connection, provider, key }: ResolvedFeature) {
  return !!connection && !!provider && (!!key || !provider.needsKey);
}

/** Every feature, resolved again whenever a connection, key, feature or model list changes. */
export const aiFeatureState$ = combineLatest([
  aiConnections$,
  aiConnectionKeys$,
  aiFeatures$,
  aiConnectionCache$
]).pipe(
  map(
    () =>
      Object.fromEntries(
        (['ask', 'recap', 'lore', 'voice'] as AiFeature[]).map((f) => [f, resolveFeature(f)])
      ) as Record<AiFeature, ResolvedFeature>
  )
);

/** Adds or changes a connection; an empty key removes it from this browser. */
export function saveConnection(connection: Omit<AiConnection, 'modified'>, key: string) {
  const saved: AiConnection = { ...connection, modified: Date.now() };
  const keys = { ...aiConnectionKeys$.getValue() };

  aiConnections$.next([...aiConnections$.getValue().filter((c) => c.id !== saved.id), saved]);

  if (key.trim()) {
    keys[saved.id] = { key: key.trim(), ...keyTarget(saved) };
  } else {
    delete keys[saved.id];
  }

  aiConnectionKeys$.next(keys);

  return saved;
}

export function deleteConnection(id: string) {
  const keys = { ...aiConnectionKeys$.getValue() };
  const features = aiFeatures$.getValue();

  delete keys[id];
  aiConnections$.next(
    aiConnections$
      .getValue()
      .map((c) => (c.id === id ? { ...c, deleted: true, modified: Date.now() } : c))
  );
  aiConnectionKeys$.next(keys);
  aiFeatures$.next(
    Object.fromEntries(
      Object.entries({ ...defaultAiFeatures, ...features }).map(([feature, setting]) => [
        feature,
        setting.connection === id ? { ...setting, connection: '', model: '' } : setting
      ])
    ) as Record<AiFeature, AiFeatureSetting>
  );
}

export function setFeature(feature: AiFeature, changes: Partial<AiFeatureSetting>) {
  aiFeatures$.next({
    ...defaultAiFeatures,
    ...aiFeatures$.getValue(),
    [feature]: { ...featureSetting(feature), ...changes }
  });
}

/** Get started: a new connection for a provider with the key the reader pasted or OpenRouter sent. */
export function connectProvider(providerId: string, key: string, endpoint = '') {
  const provider = findProvider(providerId);

  if (!provider) {
    throw new Error(`Unknown provider ${providerId}`);
  }

  return saveConnection(
    {
      id: newConnectionId(providerId),
      name: provider.label,
      provider: providerId,
      kind: provider.kind,
      ...(endpoint.trim() && { endpoint: endpoint.trim() })
    },
    key
  );
}

/** A new connection id from its provider: `openrouter`, then `openrouter-2`… */
export function newConnectionId(provider: string) {
  const taken = new Set(aiConnections$.getValue().map((c) => c.id));
  let id = provider;

  for (let n = 2; taken.has(id); n += 1) {
    id = `${provider}-${n}`;
  }

  return id;
}
