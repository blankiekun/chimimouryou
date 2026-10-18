<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsThemePicker from '$lib/components/settings/settings-theme-picker.svelte';
  import { theme$ } from '$lib/data/store';
  import { darkTheme$, followSystemTheme$, systemDark$ } from '$lib/data/theme/theme-store';
  import { t$ } from '$lib/i18n';

  $: toggle = [
    { id: false, text: $t$('settings.off') },
    { id: true, text: $t$('settings.on') }
  ] as ToggleOption<boolean>[];
</script>

<SettingsItemGroup title={$t$('prefs.themes.follow')} tooltip={$t$('prefs.themes.followHint')}>
  <ButtonToggleGroup options={toggle} bind:selectedOptionId={$followSystemTheme$} />
</SettingsItemGroup>

{#if $followSystemTheme$}
  <SettingsItemGroup
    title={$t$('prefs.themes.light')}
    tooltip={$t$($systemDark$ ? 'prefs.themes.usedInLight' : 'prefs.themes.inUseLight')}
    wide
  >
    <SettingsThemePicker bind:value={$theme$} label={$t$('prefs.themes.light')} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title={$t$('prefs.themes.dark')}
    tooltip={$t$($systemDark$ ? 'prefs.themes.inUseDark' : 'prefs.themes.usedInDark')}
    wide
  >
    <SettingsThemePicker bind:value={$darkTheme$} label={$t$('prefs.themes.dark')} preferDark />
  </SettingsItemGroup>
{:else}
  <SettingsItemGroup
    title={$t$('prefs.themes.theme')}
    tooltip={$t$('prefs.themes.themeHint')}
    wide
  >
    <SettingsThemePicker bind:value={$theme$} />
  </SettingsItemGroup>
{/if}

<p class="pt-3 text-sm">
  <a class="app-button app-button-quiet" href="?section=general#general-custom-themes">
    {$t$('prefs.themes.makeOwn')}
  </a>
</p>
