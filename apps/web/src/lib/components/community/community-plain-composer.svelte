<script lang="ts">
  import CommunityMentions from '$lib/components/community/community-mentions.svelte';
  import { bodyLength, postPlain } from '$lib/data/community';
  import { communityErrorKey } from '$lib/data/community-book';
  import { t$ } from '$lib/i18n';

  /**
   * The Community page's post box: a plain post on no book line (a question, a recommendation,
   * chat), with a Spoiler mark and @ mentions; plain text, 1,000 characters and 20 lines at most.
   * Signed in only (the page shows the sign-up line otherwise).
   */
  let { onposted }: { onposted: () => void } = $props();

  let body = $state('');
  let spoiler = $state(false);
  let sending = $state(false);
  let error = $state('');
  let box = $state<HTMLTextAreaElement>();

  const tooLong = $derived(body.split('\n').length > 20);

  async function post(event: SubmitEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    sending = true;
    error = '';
    try {
      await postPlain(body.trim(), spoiler);
      body = '';
      spoiler = false;
      onposted();
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      sending = false;
    }
  }
</script>

<form class="plain" onsubmit={post}>
  <textarea
    class="app-input"
    rows="3"
    maxlength={bodyLength}
    aria-label={$t$('community.plainTitle')}
    placeholder={$t$('community.plainPlaceholder')}
    bind:this={box}
    bind:value={body}></textarea>
  <CommunityMentions textarea={box} />
  {#if tooLong}<p class="plain-error">{$t$('community.tooManyLines')}</p>{/if}
  <div class="plain-row">
    <label class="plain-spoiler">
      <input type="checkbox" bind:checked={spoiler} />
      {$t$('community.spoiler')}
    </label>
    <span class="plain-count" class:plain-over={tooLong}
      >{[...body].length.toLocaleString('en-US')} / {bodyLength.toLocaleString('en-US')}</span
    >
    <button
      type="submit"
      class="app-button app-button-primary"
      disabled={sending || tooLong || !body.trim()}>{$t$('community.post')}</button
    >
  </div>
  {#if error}<p class="plain-error" role="alert">{error}</p>{/if}
</form>

<style>
  .plain {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .plain textarea {
    width: 100%;
    resize: vertical;
  }

  .plain-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .plain-spoiler {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .plain-count {
    margin-left: auto;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .plain-over,
  .plain-error {
    color: var(--app-danger-color);
  }

  .plain-error {
    font-size: var(--type-small);
  }
</style>
