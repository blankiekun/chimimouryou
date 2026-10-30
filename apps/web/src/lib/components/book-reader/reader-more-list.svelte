<script lang="ts">
  /** The rows of the manga (/m) and VN (/v) players' More sheet. Not upstream. */
  interface Item {
    label: string;
    lang?: string;
    disabled?: boolean;
    onclick: () => void;
  }

  interface Props {
    items: Item[];
  }

  let { items }: Props = $props();
</script>

<ul class="reader-more">
  {#each items as item (item.label)}
    <li>
      <button disabled={item.disabled} lang={item.lang} onclick={item.onclick}>
        {item.label}
      </button>
    </li>
  {/each}
</ul>

<style>
  .reader-more {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .reader-more button {
    display: flex;
    width: 100%;
    min-height: 3.25rem;
    align-items: center;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    text-align: left;
  }

  .reader-more button:hover:not(:disabled) {
    color: var(--accent-strong-color);
  }

  .reader-more button:disabled {
    opacity: 0.5;
  }
</style>
