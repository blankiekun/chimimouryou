<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import { t$, uiLanguage$, type UiLanguage } from '$lib/i18n';

  const options: ToggleOption<UiLanguage>[] = [
    { id: 'en', text: 'English' },
    { id: 'ja', text: '日本語' }
  ];
</script>

<SettingsItemGroup title={$t$('settings.uiLanguage')} tooltip={$t$('settings.uiLanguageHint')}>
  <ButtonToggleGroup {options} bind:selectedOptionId={$uiLanguage$} />
</SettingsItemGroup>
