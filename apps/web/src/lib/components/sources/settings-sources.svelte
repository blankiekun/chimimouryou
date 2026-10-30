<script lang="ts">
  import { browser } from '$app/env';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import Switch from '$lib/components/switch.svelte';
  import {
    connection,
    sourcesAutoUpdate$,
    sourcesCheckHours$,
    sourcesWifiOnly$
  } from '$lib/data/sources/sources-settings';
  import { onMount } from 'svelte';

  /**
   * Settings → Sync → Sources (standalone, board 7s): how followed works update on this device,
   * and where fetched volumes go. The three settings follow the account (sharedSettings).
   */

  const hours = [1, 3, 6, 12, 24];
  const network = browser ? connection() : 'unknown';
  let used = $state('');

  onMount(() => {
    navigator.storage
      ?.estimate?.()
      .then(({ usage }) => {
        if (usage) used = `${Math.round(usage / 1e6).toLocaleString('en-US')} MB used`;
      })
      .catch(() => undefined);
  });
</script>

<SettingsSection
  id="sync-web-sources"
  keywords="sources web novels syosetu kakuyomu opds suwayomi follow updates wifi"
>
  <SettingsItemGroup
    title="Update followed works"
    tooltip="While the app is open. There is no server to check when it is closed."
  >
    <Switch
      checked={$sourcesAutoUpdate$}
      stateText={false}
      aria-label="Update followed works"
      onchange={(next) => sourcesAutoUpdate$.next(next)}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title="Check every">
    <select
      class="app-input"
      aria-label="Check every"
      value={$sourcesCheckHours$}
      onchange={(event) => sourcesCheckHours$.next(Number(event.currentTarget.value))}
    >
      {#each hours as hour (hour)}
        <option value={hour}>{hour} h</option>
      {/each}
    </select>
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Update on Wi-Fi only"
    tooltip="Skips checks and fetches on mobile data. {network === 'unknown'
      ? 'Can’t tell the connection here; updates run anyway.'
      : network === 'wifi'
        ? 'On Wi-Fi now.'
        : 'On mobile data: waiting.'}"
  >
    <Switch
      checked={$sourcesWifiOnly$}
      stateText={false}
      aria-label="Update on Wi-Fi only"
      onchange={(next) => sourcesWifiOnly$.next(next)}
    />
  </SettingsItemGroup>
  <p class="sources-where">
    Fetched volumes go into this device’s library{used ? ` (${used})` : ''} and sync like imported books
    if sync is set up.
  </p>
</SettingsSection>

<style>
  .sources-where {
    padding: 1rem 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
