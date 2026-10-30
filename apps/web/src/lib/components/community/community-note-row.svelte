<script lang="ts">
  import { goto } from '$app/navigation';
  import CommunityWork from '$lib/components/community/community-work.svelte';
  import { markNotesSeen, notePath, type NoteGroup } from '$lib/data/social/community-book';
  import { relativeTime } from '$lib/functions/format-time';
  import { t$, uiLanguage$ } from '$lib/i18n';

  /** "3 replies to your post" (board 7): opens the post (a line comment: its line) and marks the replies seen */
  export let group: NoteGroup;

  $: names =
    group.names.length > 1
      ? $t$('community.namesAnd', {
          names: group.names.slice(0, -1).join(', '),
          last: group.names[group.names.length - 1]
        })
      : (group.names[0] ?? '');

  function open() {
    markNotesSeen(group.parent, group.at);
    goto(notePath(group));
  }
</script>

<li class="note-row">
  <button type="button" class="note-open" on:click={open}>
    <span class="note-head">
      <strong
        >{$t$(group.count === 1 ? 'community.noteOne' : 'community.note', {
          count: group.count
        })}</strong
      >
      <time datetime={new Date(group.at * 1000).toISOString()}
        >{relativeTime(group.at, $uiLanguage$)}</time
      >
    </span>
    <CommunityWork title={group.title} vol={group.vol} cover={group.cover} meta={names} />
  </button>
</li>

<style>
  .note-row {
    border-bottom: 1px solid var(--border-color);
  }

  .note-open {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 0;
    text-align: left;
  }

  .note-open:hover strong {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .note-head {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: 1rem;
  }

  .note-head time {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
