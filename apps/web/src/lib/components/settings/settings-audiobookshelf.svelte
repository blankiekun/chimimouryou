<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { absLogin, audiobookshelfToken$ } from '$lib/data/audiobookshelf';
  import { t$ } from '$lib/i18n';

  let username = '';
  let password = '';
  let apiKey = '';
  let error = '';
  let busy = false;

  async function signIn() {
    busy = true;
    error = '';
    try {
      audiobookshelfToken$.next(await absLogin(username, password));
      password = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }
</script>

<SettingsSection id="audiobookshelf-connect" keywords="abs audiobook server token api key">
  {#if $audiobookshelfToken$}
    <SettingsItemGroup title={$t$('prefs.abs.connected')} tooltip={$t$('prefs.abs.connectedHint')}>
      <button class="app-button" on:click={() => audiobookshelfToken$.next('')}>
        {$t$('prefs.abs.disconnect')}
      </button>
    </SettingsItemGroup>
  {:else}
    <SettingsItemGroup title={$t$('prefs.username')}>
      <input
        aria-label={$t$('prefs.username')}
        class="app-input"
        autocomplete="off"
        bind:value={username}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.password')} tooltip={$t$('prefs.abs.passwordHint')}>
      <input
        aria-label={$t$('prefs.password')}
        type="password"
        class="app-input"
        autocomplete="off"
        bind:value={password}
      />
    </SettingsItemGroup>
    <div class="abs-sign-in" data-settings-item>
      <button
        class="app-button app-button-primary"
        disabled={busy || !username || !password}
        on:click={signIn}
      >
        {$t$('nav.signIn')}
      </button>
    </div>
    <SettingsItemGroup title={$t$('prefs.abs.apiKey')} tooltip={$t$('prefs.abs.apiKeyHint')}>
      <input
        aria-label={$t$('prefs.abs.apiKeyLabel')}
        type="password"
        class="app-input"
        autocomplete="off"
        bind:value={apiKey}
        on:change={() => apiKey.trim() && audiobookshelfToken$.next(apiKey.trim())}
      />
    </SettingsItemGroup>
    {#if error}
      <p class="abs-error" role="alert">{error}</p>
    {/if}
  {/if}
</SettingsSection>

<style>
  .abs-sign-in {
    display: flex;
    justify-content: flex-end;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .abs-error {
    padding-top: 0.75rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
