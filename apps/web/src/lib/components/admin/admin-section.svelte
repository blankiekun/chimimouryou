<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';

  /** One numbered section of the admin panel: head, optional description, then the content. */
  export let number: number;
  export let title: string;
  export let count: number | undefined = undefined;
  export let description = '';

  const id = `admin-${title.toLowerCase().replace(/\W+/g, '-')}`;
</script>

<section class="admin-section" aria-labelledby={id}>
  <SectionHead {id} {number} {title} {count} />
  {#if description}<p class="admin-section-text">{description}</p>{/if}
  <div class="admin-section-body">
    <slot />
  </div>
</section>

<style>
  .admin-section-text {
    max-width: 50rem;
    margin-top: 0.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.6;
  }

  .admin-section-body {
    margin-top: 1rem;
  }

  /* Shared by the tools: a ruled key/value table, the row of buttons under it and status lines */
  .admin-section-body :global(.tool-table th) {
    width: 10rem;
  }

  .admin-section-body :global(.tool-table td) {
    overflow-wrap: anywhere;
  }

  .admin-section-body :global(.tool-actions) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
    margin-top: 1rem;
  }

  .admin-section-body :global(.tool-text) {
    max-width: 50rem;
    margin-bottom: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.6;
  }

  .admin-section-body :global(.tool-text a) {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .admin-section-body :global(.tool-status) {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .admin-section-body :global(.tool-status::before) {
    content: '';
    width: 0.45rem;
    height: 0.45rem;
    flex: none;
    border-radius: 9999px;
    background: var(--app-muted-fg);
    transform: translateY(-0.1rem);
  }

  .admin-section-body :global(.tool-status[data-state='ok']::before) {
    background: var(--app-success-color);
  }

  .admin-section-body :global(.tool-status[data-state='warn']::before) {
    background: var(--app-warning-color);
  }

  .admin-section-body :global(.tool-status[data-state='error']::before) {
    background: var(--app-danger-color);
  }

  .admin-section-body :global(.tool-error) {
    margin-top: 0.75rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .admin-section-body :global(.tool-note) {
    margin-top: 0.75rem;
    font-size: var(--type-small);
  }

  .admin-section-body :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
  }

  @media (max-width: 639px) {
    .admin-section-body :global(.tool-table th) {
      width: 7rem;
    }
  }
</style>
