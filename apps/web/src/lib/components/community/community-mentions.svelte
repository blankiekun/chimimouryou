<script lang="ts">
  import { mentionQuery, searchMentions } from '$lib/data/social/community-mentions';
  import { t$ } from '$lib/i18n';

  /**
   * @ mentions for a Community textarea: typing `@` and 2 characters lists AniList/VNDB works
   * (debounced; nothing is asked before), ↑↓ Enter/Tab picks, Esc closes; picking puts the
   * mention token in the text (an `input` event, so the host's bind:value follows).
   */
  let { textarea }: { textarea: HTMLTextAreaElement | undefined } = $props();

  let found = $state<Awaited<ReturnType<typeof searchMentions>>>([]);
  let active = $state(0);
  let open = $state(false);
  let searching = $state(false);
  let at: { query: string; start: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  const id = `mentions-${Math.random().toString(36).slice(2, 8)}`;

  function close() {
    clearTimeout(timer);
    asked++;
    open = searching = false;
    found = [];
    textarea?.removeAttribute('aria-activedescendant');
  }

  function onInput() {
    if (!textarea) return;
    const next = mentionQuery(textarea.value, textarea.selectionStart);

    if (!next) return close();
    if (next.query === at?.query && open) return;
    at = next;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const ask = ++asked;

      open = searching = true;
      const results = await searchMentions(next.query).catch(() => []);

      if (ask !== asked) return;
      found = results;
      active = 0;
      searching = false;
    }, 400);
  }

  function pick(index: number) {
    const choice = found[index];

    if (!textarea || !choice || !at) return;
    const end = at.start + 1 + at.query.length;
    const text = `${choice.token} `;

    textarea.value = textarea.value.slice(0, at.start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = at.start + text.length;
    close();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  function onKey(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (found.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length;
      textarea?.setAttribute('aria-activedescendant', `${id}-${active}`);
    } else if (found.length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      pick(active);
    }
  }

  $effect(() => {
    const element = textarea;

    if (!element) return;
    element.setAttribute('aria-autocomplete', 'list');
    element.setAttribute('aria-controls', id);
    element.addEventListener('input', onInput);
    element.addEventListener('keydown', onKey);
    element.addEventListener('blur', close);
    return () => {
      element.removeEventListener('input', onInput);
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('blur', close);
      clearTimeout(timer);
    };
  });
</script>

<div class="mentions" {id} role="listbox" aria-label={$t$('community.mentionList')} hidden={!open}>
  {#if searching}
    <p class="mentions-quiet">{$t$('community.loading')}</p>
  {:else if !found.length}
    <p class="mentions-quiet">{$t$('community.mentionNone')}</p>
  {:else}
    {#each found as one, index (one.token)}
      <!-- mousedown keeps the textarea's focus (its blur closes the list) -->
      <button
        type="button"
        id="{id}-{index}"
        role="option"
        class="mentions-item"
        aria-selected={index === active}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => pick(index)}
      >
        <span lang="ja">{one.title}</span>
        <small>{one.source === 'vndb' ? 'VNDB' : 'AniList'}</small>
      </button>
    {/each}
  {/if}
</div>

<style>
  .mentions {
    display: flex;
    max-height: 16rem;
    flex-direction: column;
    overflow-y: auto;
    border: 1px solid var(--c-ink, var(--font-color));
    border-radius: 2px;
  }

  .mentions[hidden] {
    display: none;
  }

  .mentions-quiet {
    padding: 0.6rem 0.75rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .mentions-item {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.4rem 0.75rem;
    text-align: left;
  }

  .mentions-item + .mentions-item {
    border-top: 1px solid var(--c-rule, var(--border-color));
  }

  .mentions-item[aria-selected='true'],
  .mentions-item:hover {
    background: var(--app-spot-tint);
  }

  .mentions-item small {
    flex: none;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-label);
  }
</style>
