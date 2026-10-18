<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
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
      <button class={buttonClasses} on:click={() => audiobookshelfToken$.next('')}>
        {$t$('prefs.abs.disconnect')}
      </button>
    </SettingsItemGroup>
  {:else}
    <SettingsItemGroup title={$t$('prefs.username')}>
      <input
        aria-label={$t$('prefs.username')}
        class={inputClasses}
        autocomplete="off"
        bind:value={username}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.password')} tooltip={$t$('prefs.abs.passwordHint')}>
      <input
        aria-label={$t$('prefs.password')}
        type="password"
        class={inputClasses}
        autocomplete="off"
        bind:value={password}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="">
      <button class={buttonClasses} disabled={busy || !username || !password} on:click={signIn}>
        {$t$('nav.signIn')}
      </button>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.abs.apiKey')} tooltip={$t$('prefs.abs.apiKeyHint')}>
      <input
        aria-label={$t$('prefs.abs.apiKeyLabel')}
        type="password"
        class={inputClasses}
        autocomplete="off"
        bind:value={apiKey}
        on:change={() => apiKey.trim() && audiobookshelfToken$.next(apiKey.trim())}
      />
    </SettingsItemGroup>
    {#if error}
      <p class="text-danger" role="alert">{error}</p>
    {/if}
  {/if}
</SettingsSection>
