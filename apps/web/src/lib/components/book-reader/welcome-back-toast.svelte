<script lang="ts">
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { t$, type MessageKey } from '$lib/i18n';

  /** After days away, the reader offers a plugin tab (Story so far). */
  interface Props {
    days: number;
    label: MessageKey;
    onopen: () => void;
    ondismiss: () => void;
  }

  let { days, label, onopen, ondismiss }: Props = $props();
</script>

<div
  class="writing-horizontal-tb fixed left-1/2 top-10 z-20 flex -translate-x-1/2 items-center gap-4 rounded-sm bg-[var(--reader-panel-fg)] py-2 pl-4 pr-1 text-sm text-[var(--reader-panel-bg)]"
  role="status"
>
  <span>{$t$('reader.welcomeBack', { days })}</span>
  <button class="font-bold underline underline-offset-2" onclick={onopen}>
    {$t$(label)}
  </button>
  <button
    class="inline-flex h-9 w-9 items-center justify-center opacity-80"
    title={$t$('reader.dismiss')}
    onclick={ondismiss}
  >
    <Fa icon={faXmark} />
  </button>
</div>
