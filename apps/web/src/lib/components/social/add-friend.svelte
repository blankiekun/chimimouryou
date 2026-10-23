<script lang="ts">
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { pagePath } from '$lib/data/env';
  import { sendFriendRequest } from '$lib/data/social';
  import { formatCode, hubErrorKey, newFriendCode, socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import qrcode from 'qrcode-generator';
  import { onMount } from 'svelte';

  /** Your code (Copy, Copy link, QR, New code) and a field for someone else's */
  export let number: number;
  /** From a /friends?add=CODE link */
  export let initialCode = '';

  let entered = initialCode ? formatCode(initialCode.toUpperCase()) : '';
  let error = '';
  let sent = '';
  let busy = false;
  let origin = '';

  onMount(() => (origin = location.origin));

  $: code = $socialSession$?.me.code ?? '';
  $: link = `${origin}${pagePath}/friends?add=${code}`;
  $: qr = code && origin ? qrPath(link) : undefined;

  /** The code's dark modules as one SVG path */
  function qrPath(text: string) {
    const qrCode = qrcode(0, 'M');

    qrCode.addData(text);
    qrCode.make();

    const size = qrCode.getModuleCount();
    let d = '';

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (qrCode.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size, d };
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  async function run(action: () => Promise<unknown>) {
    error = '';
    sent = '';
    busy = true;
    try {
      await action();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
    busy = false;
  }

  function add() {
    run(async () => {
      await sendFriendRequest(entered);
      sent = $t$('social.requestSent', { code: formatCode(entered.toUpperCase()) });
      entered = '';
    });
  }
</script>

<section class="add-friend" aria-labelledby="add-friend-heading">
  <SectionHead id="add-friend-heading" {number} title={$t$('social.addFriend')} />
  <PointBox label={$t$('social.yourCode')}>
    <p class="add-friend-code">{formatCode(code)}</p>
    <span class="add-friend-actions">
      <button type="button" class="app-button" on:click={() => copy(formatCode(code))}>
        {$t$('social.copy')}
      </button>
      <button type="button" class="app-button" on:click={() => copy(link)}>
        {$t$('social.copyLink')}
      </button>
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={busy}
        on:click={() => run(newFriendCode)}
      >
        {$t$('social.newCode')}
      </button>
    </span>
    <div class="add-friend-qr">
      {#if qr}
        <svg
          viewBox="-1 -1 {qr.size + 2} {qr.size + 2}"
          role="img"
          aria-label={$t$('social.qrLabel')}
          shape-rendering="crispEdges"
        >
          <rect
            x="-1"
            y="-1"
            width={qr.size + 2}
            height={qr.size + 2}
            class="add-friend-qr-paper"
          />
          <path d={qr.d} />
        </svg>
      {/if}
      <p>{$t$('social.qrHint')}</p>
    </div>
  </PointBox>

  <form class="add-friend-enter" on:submit|preventDefault={add}>
    <label for="add-friend-input">{$t$('social.enterCode')}</label>
    <span class="add-friend-row">
      <input
        id="add-friend-input"
        class="app-input"
        bind:value={entered}
        placeholder="XXXX-XXXX"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        maxlength="12"
        required
      />
      <button type="submit" class="app-button app-button-primary" disabled={busy}>
        {$t$('social.add')}
      </button>
    </span>
    {#if error}<p class="add-friend-error" role="alert">{error}</p>{/if}
    {#if sent}<p class="add-friend-sent" role="status">{sent}</p>{/if}
  </form>
</section>

<style>
  .add-friend {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1.25rem;
  }

  .add-friend-code {
    font-size: var(--type-h1);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.06em;
    line-height: 1.2;
  }

  .add-friend-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .add-friend-qr {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-top: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .add-friend-qr svg {
    width: 6rem;
    height: 6rem;
    flex: none;
    fill: var(--font-color);
  }

  .add-friend-qr-paper {
    fill: var(--background-color);
  }

  .add-friend-enter {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .add-friend-enter label {
    font-weight: 700;
  }

  .add-friend-row {
    display: flex;
    gap: 0.5rem;
  }

  .add-friend-row input {
    min-width: 0;
    flex: 1 1 auto;
  }

  .add-friend-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .add-friend-sent {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
