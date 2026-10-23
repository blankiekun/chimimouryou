/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * AI connections and which one each feature uses: per-id merging for sync, the
 * one-time move from the OpenRouter/ElevenLabs settings, and mirroring back into
 * those old settings so devices on the previous release keep working (drop the
 * mirror one release after this). Not part of upstream.
 */

import { combineLatest, map, type BehaviorSubject } from 'rxjs';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiFeatureDefaults,
  aiFeatures$,
  defaultAiFeatures,
  elevenLabsApiKey$,
  elevenLabsModel$,
  openRouterApiKey$,
  openRouterModel$,
  openRouterRecapModel$,
  type AiConnection,
  type AiFeature,
  type AiFeatureSetting,
  type AiSamplers
} from '$lib/data/ai-settings';
import { findProvider, type AiProvider } from '$lib/data/ai-providers';
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

/** Key of the previous release's settings, while devices may still set only those. */
function legacyKey(connection: AiConnection) {
  if (connection.provider === 'openrouter') {
    return openRouterApiKey$.getValue();
  }

  return connection.provider === 'elevenlabs' ? elevenLabsApiKey$.getValue() : '';
}

export function connectionKey(connection: AiConnection) {
  return aiConnectionKeys$.getValue()[connection.id] || legacyKey(connection);
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
  let connection = live.find((c) => c.id === setting.connection) ?? live[0];

  // shortcut: the previous release's OpenRouter key works without a connection; drop with the mirror.
  if (!connection && feature !== 'voice' && openRouterApiKey$.getValue()) {
    connection = {
      id: 'openrouter',
      name: 'OpenRouter',
      provider: 'openrouter',
      kind: 'text',
      modified: 0
    };
  }

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
  aiConnectionCache$,
  openRouterApiKey$,
  elevenLabsApiKey$
]).pipe(
  map(
    () =>
      Object.fromEntries(
        (['ask', 'recap', 'lore', 'voice'] as AiFeature[]).map((f) => [f, resolveFeature(f)])
      ) as Record<AiFeature, ResolvedFeature>
  )
);

function setIfChanged<T>(store: BehaviorSubject<T>, value: T) {
  if (store.getValue() !== value) {
    store.next(value);
  }
}

/** Writes the previous release's settings from the connections (older devices read only those). */
export function mirrorOldSettings() {
  const live = liveConnections();
  const openRouter = live.find((c) => c.provider === 'openrouter');
  const elevenLabs = live.find((c) => c.provider === 'elevenlabs');

  setIfChanged(openRouterApiKey$, openRouter ? connectionKey(openRouter) : '');
  setIfChanged(elevenLabsApiKey$, elevenLabs ? connectionKey(elevenLabs) : '');

  const ask = resolveFeature('ask');
  const recap = resolveFeature('recap');
  const voice = resolveFeature('voice');

  if (ask.provider?.id === 'openrouter' && ask.model) {
    setIfChanged(openRouterModel$, ask.model);
  }

  if (featureSetting('recap').connection === 'inherit') {
    setIfChanged(openRouterRecapModel$, '');
  } else if (recap.provider?.id === 'openrouter' && recap.model) {
    setIfChanged(openRouterRecapModel$, recap.model);
  }

  if (voice.provider?.id === 'elevenlabs' && voice.model) {
    setIfChanged(elevenLabsModel$, voice.model);
  }
}

/** Adds or changes a connection; an empty key removes it from this browser and the account. */
export function saveConnection(connection: Omit<AiConnection, 'modified'>, key: string) {
  const saved: AiConnection = { ...connection, modified: Date.now() };
  const keys = { ...aiConnectionKeys$.getValue() };

  aiConnections$.next([...aiConnections$.getValue().filter((c) => c.id !== saved.id), saved]);

  if (key.trim()) {
    keys[saved.id] = key.trim();
  } else {
    delete keys[saved.id];
    // Or connectionKey would fall back to the old setting.
    if (saved.provider === 'openrouter') {
      setIfChanged(openRouterApiKey$, '');
    } else if (saved.provider === 'elevenlabs') {
      setIfChanged(elevenLabsApiKey$, '');
    }
  }

  aiConnectionKeys$.next(keys);
  mirrorOldSettings();

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
  mirrorOldSettings();
}

export function setFeature(feature: AiFeature, changes: Partial<AiFeatureSetting>) {
  aiFeatures$.next({
    ...defaultAiFeatures,
    ...aiFeatures$.getValue(),
    [feature]: { ...featureSetting(feature), ...changes }
  });
  mirrorOldSettings();
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

const versionKey = 'aiSettingsVersion';

/**
 * Moves the OpenRouter and ElevenLabs settings into connections, once. Runs when
 * the app loads and after each settings sync: a device signing in may get the old
 * settings only then. Nothing to move leaves the version unset for a later run.
 */
export function migrateAiSettings() {
  const storage = window.localStorage;

  if (Number(storage.getItem(versionKey)) >= 1) {
    return;
  }

  if (aiConnections$.getValue().length) {
    // Another device moved them already.
    storage.setItem(versionKey, '1');
    return;
  }

  const has = (key: string) => storage.getItem(key) !== null;
  const now = Date.now();
  const connections: AiConnection[] = [];
  const keys: Record<string, string> = {};
  const features = { ...defaultAiFeatures, ...aiFeatures$.getValue() };

  if (openRouterApiKey$.getValue() || has('openRouterModel')) {
    connections.push({
      id: 'openrouter',
      name: 'OpenRouter',
      provider: 'openrouter',
      kind: 'text',
      modified: now
    });
    keys.openrouter = openRouterApiKey$.getValue();
    features.ask = {
      connection: 'openrouter',
      model: has('openRouterModel') ? openRouterModel$.getValue().trim() : '',
      params: {}
    };

    const recapModel = openRouterRecapModel$.getValue().trim();

    features.recap =
      has('openRouterRecapModel') && !recapModel
        ? { connection: 'inherit', model: '', params: {} }
        : {
            connection: 'openrouter',
            model: has('openRouterRecapModel') ? recapModel : '',
            params: {}
          };
    features.lore = { connection: 'inherit', model: '', params: {} };
  }

  if (elevenLabsApiKey$.getValue() || has('elevenLabsModel')) {
    connections.push({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      provider: 'elevenlabs',
      kind: 'voice',
      modified: now
    });
    keys.elevenlabs = elevenLabsApiKey$.getValue();
    features.voice = {
      connection: 'elevenlabs',
      model: has('elevenLabsModel') ? elevenLabsModel$.getValue().trim() : '',
      params: {}
    };
  }

  if (!connections.length) {
    return;
  }

  aiConnections$.next(connections);
  aiConnectionKeys$.next(
    Object.fromEntries(
      Object.entries({ ...aiConnectionKeys$.getValue(), ...keys }).filter(([, k]) => k)
    )
  );
  aiFeatures$.next(features);
  storage.setItem(versionKey, '1');
}

if (typeof window !== 'undefined') {
  migrateAiSettings();
}
