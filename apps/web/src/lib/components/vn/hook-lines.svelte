<script lang="ts">
  /**
   * /hook's lines: the list Yomitan and the lookup popup read (`.hook-text`), and Select mode to
   * copy, edit or delete lines (tap is the lookup, so editing doesn't hang on a double click as in
   * texthooker-ui). The page keeps the lines and the undo history. Not upstream.
   */
  import type { HookLine } from '$lib/data/vn/texthooker';
  import { postOverlayLine } from '$lib/data/vn/native-games';
  import { tick, type Snippet } from 'svelte';

  interface Props {
    lines: HookLine[];
    fontSize: number;
    reverse: boolean;
    /** The line to light up: one that just came in */
    flashId: string | undefined;
    canUndo: boolean;
    /** Paste and Clear: shown outside Select mode */
    tools: Snippet;
    empty: string;
    ontap: (event: MouseEvent) => void;
    onremove: (ids: Set<string>) => void;
    onedit: (id: string, text: string) => void;
    onundo: () => void;
    list?: HTMLOListElement;
  }

  let {
    lines,
    fontSize,
    reverse,
    flashId,
    canUndo,
    tools,
    empty,
    ontap,
    onremove,
    onedit,
    onundo,
    list = $bindable()
  }: Props = $props();

  let selecting = $state(false);
  let selected = $state(new Set<string>());
  let editing = $state<string>();
  let draft = $state('');
  let copied = $state('');
  let editor = $state<HTMLTextAreaElement>();

  const shown = $derived(reverse ? [...lines].reverse() : lines);

  // The game overlay (desktop app) shows the newest line, edits and Clear included.
  $effect(() => postOverlayLine(lines.at(-1)?.text ?? ''));

  // Lines gone (cleared, past the 500 kept) drop out of the selection.
  $effect(() => {
    const ids = new Set(lines.map((line) => line.id));

    if ([...selected].some((id) => !ids.has(id))) {
      selected = new Set([...selected].filter((id) => ids.has(id)));
    }
    if (editing && !ids.has(editing)) editing = undefined;
  });

  function stop() {
    selecting = false;
    selected = new Set();
    editing = undefined;
    copied = '';
  }

  function toggle(id: string) {
    const next = new Set(selected);

    if (!next.delete(id)) next.add(id);
    selected = next;
    copied = '';
  }

  function onclick(event: MouseEvent) {
    if (!selecting) {
      ontap(event);
      return;
    }

    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-id]');

    if (item && !editing) toggle(item.dataset.id!);
  }

  async function copy() {
    const text = lines
      .filter((line) => selected.has(line.id))
      .map((line) => line.text)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      copied = selected.size === 1 ? 'Copied 1 line.' : `Copied ${selected.size} lines.`;
    } catch {
      copied = 'The browser refused the clipboard.';
    }
  }

  async function edit() {
    const [id] = selected;

    editing = id;
    draft = lines.find((line) => line.id === id)?.text ?? '';
    await tick();
    editor?.focus();
  }

  function saveEdit() {
    if (editing) onedit(editing, draft);
    editing = undefined;
  }

  function remove() {
    onremove(selected);
    selected = new Set();
  }

  function onkeydown(event: KeyboardEvent) {
    if (!selecting || editing) return;
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Escape') stop();
    else if (event.key === 'Delete' && selected.size) remove();
  }
</script>

<svelte:window {onkeydown} />

<div class="hl-bar" class:hl-bar-selecting={selecting}>
  {#if selecting}
    <span class="hl-count" role="status">{copied || `${selected.size} selected`}</span>
    <button type="button" class="app-button" onclick={copy} disabled={!selected.size}>Copy</button>
    <button
      type="button"
      class="app-button"
      onclick={edit}
      disabled={selected.size !== 1 || !!editing}
    >
      Edit
    </button>
    <button
      type="button"
      class="app-button app-button-danger"
      onclick={remove}
      disabled={!selected.size}
    >
      Delete
    </button>
    <button type="button" class="app-button app-button-quiet" onclick={stop}>Done</button>
  {:else}
    <span class="hl-count">{lines.length === 1 ? '1 line' : `${lines.length} lines`}</span>
    <button
      type="button"
      class="app-button app-button-quiet"
      onclick={() => (selecting = true)}
      disabled={!lines.length}
    >
      Select
    </button>
    <button type="button" class="app-button app-button-quiet" onclick={onundo} disabled={!canUndo}>
      Undo
    </button>
    {@render tools()}
  {/if}
</div>

{#if lines.length}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <ol
    class="hook-text"
    class:hl-selecting={selecting}
    lang="ja"
    style:font-size="{fontSize}px"
    bind:this={list}
    {onclick}
  >
    {#each shown as line (line.id)}
      {@const picked = selected.has(line.id)}
      <li data-id={line.id} class:hl-picked={picked} class:hl-new={line.id === flashId}>
        {#if editing === line.id}
          <textarea
            class="app-input hl-editor"
            aria-label="Line text"
            rows="3"
            bind:this={editor}
            bind:value={draft}
            onkeydown={(event) => {
              if (event.key === 'Escape') editing = undefined;
              else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                saveEdit();
              }
            }}></textarea>
          <span class="hl-edit-actions" lang="en">
            <button type="button" class="app-button app-button-primary" onclick={saveEdit}>
              Save
            </button>
            <button type="button" class="app-button" onclick={() => (editing = undefined)}>
              Cancel
            </button>
          </span>
        {:else}
          {line.text}
        {/if}
      </li>
    {/each}
  </ol>
{:else}
  <p class="hl-empty">{empty}</p>
{/if}

<style>
  .hl-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--font-color);
  }

  .hl-count {
    margin-right: auto;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .hl-bar-selecting .hl-count {
    color: var(--font-color);
    font-weight: 700;
  }

  /* Phones: the selection count gets its own row, the four actions one row under it. */
  @media (max-width: 639px) {
    .hl-bar-selecting .hl-count {
      flex-basis: 100%;
    }
  }

  .hl-empty {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hook-text {
    max-height: 70vh;
    max-height: 70dvh;
    overflow-y: auto;
    line-height: 2;
  }

  .hook-text li {
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid var(--border-color);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .hl-selecting li {
    cursor: pointer;
    user-select: none;
  }

  .hl-selecting li:hover {
    background: var(--surface-color);
  }

  .hook-text .hl-picked,
  .hook-text .hl-picked:hover {
    background: var(--app-spot-tint);
  }

  .hl-new {
    animation: hl-flash 1.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes hl-flash {
    from {
      background: var(--app-spot-tint);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hl-new {
      animation-duration: 0.01s;
    }
  }

  .hl-editor {
    display: block;
    width: 100%;
    height: auto;
    font-size: inherit;
    line-height: 1.6;
    resize: vertical;
  }

  .hl-edit-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
