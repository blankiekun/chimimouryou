<script lang="ts">
  import Switch from '$lib/components/switch.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { t$ } from '$lib/i18n';
  import { enabledPlugins$, isPluginEnabled, plugins, setPluginEnabled } from '$lib/plugins';
</script>

<SettingsSection id="general-plugins" keywords="plugin extension">
  {#each plugins as plugin (plugin.id)}
    {@const enabled = isPluginEnabled(plugin.id, $enabledPlugins$)}
    <SettingsItemGroup title={$t$(plugin.name)} tooltip={$t$(plugin.description)}>
      <Switch
        checked={enabled}
        aria-label={$t$(plugin.name)}
        onchange={() => setPluginEnabled(plugin.id, !enabled)}
      />
    </SettingsItemGroup>
  {/each}
</SettingsSection>
