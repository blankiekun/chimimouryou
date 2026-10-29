<script lang="ts">
  import PointBox from '$lib/components/point-box.svelte';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import { formatCode } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';

  /** A recovery code shown once (sign-up, a reset, Settings → New recovery code): 5-5 on two lines. */
  export let code: string;
  export let username: string;

  function copy() {
    navigator.clipboard?.writeText(formatCode(code, 5)).catch(() => {});
  }

  function download() {
    const text = `${$t$('social.recoveryFile', { username })}\n\n${formatCode(code, 5)}\n`;
    downloadBlob(new Blob([text], { type: 'text/plain' }), `chimimouryou-recovery-${username}.txt`);
  }
</script>

<PointBox label={$t$('social.recoveryCode')}>
  <p class="social-recovery" aria-label={$t$('social.recoveryCode')}>
    <span>{code.slice(0, 5)}-{code.slice(5, 10)}</span>
    <span>{code.slice(10, 15)}-{code.slice(15)}</span>
  </p>
  <span class="social-actions">
    <button type="button" class="app-button" on:click={copy}>{$t$('social.copy')}</button>
    <button type="button" class="app-button" on:click={download}>
      {$t$('social.downloadTxt')}
    </button>
  </span>
</PointBox>

<style>
  .social-recovery {
    display: flex;
    flex-direction: column;
    margin-bottom: 1rem;
    font-size: var(--type-h1);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    line-height: 1.25;
  }

  .social-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
