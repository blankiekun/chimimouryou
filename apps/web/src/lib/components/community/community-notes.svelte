<script lang="ts">
  import CommunityNoteRow from '$lib/components/community/community-note-row.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import {
    communityNotes$,
    communityNotesSeen$,
    refreshNotes,
    unseenNotes
  } from '$lib/data/social/community-book';
  import { socialSession$ } from '$lib/data/social/social-account';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  /** New replies to the reader's posts (the Community page's side), signed in only */
  export let number: number;

  onMount(() => {
    refreshNotes();
  });

  $: groups =
    $socialSession$ && $communityNotes$?.user === $socialSession$.me.id
      ? unseenNotes($communityNotes$.notes, $communityNotesSeen$)
      : [];
</script>

<section aria-labelledby="community-notes-head">
  <SectionHead
    id="community-notes-head"
    {number}
    title={$t$('community.newReplies')}
    count={groups.length}
  />
  {#if groups.length}
    <ul class="notes">
      {#each groups as group (group.parent)}
        <CommunityNoteRow {group} />
      {/each}
    </ul>
  {:else}
    <p class="notes-empty">{$t$('community.noNewReplies')}</p>
  {/if}
</section>

<style>
  .notes {
    margin-top: 1rem;
    border-top: 2px solid var(--font-color);
  }

  .notes-empty {
    margin-top: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
