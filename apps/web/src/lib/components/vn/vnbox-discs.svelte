<script lang="ts">
  /**
   * The /v More sheet's disc swap for Windows games installed from several discs (VnInfo.discs):
   * puts another disc in VNBox's CD-ROM drive through the frame's insertCDRomDisc (VNBox's
   * boxedwine-shell.js; Ctrl+Shift+F12 there). Not upstream.
   */
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';

  interface Props {
    /** How many discs the game has */
    count: number;
    frame?: HTMLIFrameElement;
  }

  let { count, frame }: Props = $props();

  // VNBox's own state, -1 while the drive is empty
  const player = () => frame?.contentWindow as any;
  let current = $state<number>(player()?.cdromCurrent ?? 0);
  const options = $derived(
    Array.from({ length: count }, (_, index) => ({ id: index, text: `Disc ${index + 1}` }))
  );

  function insert(index: number) {
    if (index === current) return;
    player()?.insertCDRomDisc?.(index);
    current = index;
  }
</script>

<SettingsItemGroup title="Disc" tooltip="The disc in the game's CD-ROM drive.">
  <ButtonToggleGroup {options} bind:selectedOptionId={() => current, insert} />
</SettingsItemGroup>
