<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import { followSystemTheme$ } from '$lib/data/theme/theme-store';
  import { t$ } from '$lib/i18n';

  $: toggle = [
    { id: false, text: $t$('settings.off') },
    { id: true, text: $t$('settings.on') }
  ] as ToggleOption<boolean>[];
</script>

<SettingsItemGroup title={$t$('prefs.themes.follow')} tooltip={$t$('prefs.themes.followHint')}>
  <ButtonToggleGroup options={toggle} bind:selectedOptionId={$followSystemTheme$} />
</SettingsItemGroup>
