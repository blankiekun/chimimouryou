<script lang="ts">
  import { faMagnifyingGlass, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import {
    defaultSource,
    jitenCharacters,
    saveBookMetadata,
    searchMetadata,
    sourceNames,
    type BookMetadata,
    type MetadataCandidate,
    type MetadataKind,
    type MetadataSource
  } from '$lib/data/library/book-metadata';
  import { guessSeriesName } from '$lib/data/library/series-overrides';
  import { database } from '$lib/data/store';
  import { vnBookmark } from '$lib/data/vn/vn';
  import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The book page's Find details (book-details.svelte): searches AniList, VNDB or Jiten and saves
   * a pick as the book's shared details, or sets a Windows game's length from Jiten.
   */

  interface Props {
    book: BookCardProps;
    kind: MetadataKind;
    /** Calibre source with the `series` permission: a pick saves the shared details */
    canEdit: boolean;
    /** A Windows game in this browser: a pick sets its length from Jiten (it has no count of its own) */
    windowsGame: boolean;
    metadata: BookMetadata | undefined;
    searchOpen: boolean;
    searchTerm: string;
    /** The saved details */
    onmetadata: (metadata: BookMetadata | undefined) => void;
    /** Saved details changed the library (a cover) */
    onchanged: () => void;
  }

  let {
    book,
    kind,
    canEdit,
    windowsGame,
    metadata,
    searchOpen = $bindable(),
    searchTerm = $bindable(),
    onmetadata,
    onchanged
  }: Props = $props();

  let searching = $state(false);
  let searchRequest = 0;
  let searchError = $state('');
  let saving = $state(false);
  let candidates = $state<MetadataCandidate[]>();
  let source = $state<MetadataSource>();
  let lengthNote = $state('');

  $effect.pre(() => {
    source ??= defaultSource(kind);
  });

  function openSearch() {
    searchOpen = true;
    searchTerm ||= guessSeriesName(book.title);
    search();
  }

  async function search() {
    if (!searchTerm.trim()) {
      return;
    }

    const request = (searchRequest += 1);

    searching = true;
    searchError = '';
    try {
      const results = await searchMetadata(kind, searchTerm.trim(), source);

      // An older search answering late must not replace a newer one's results.
      if (request === searchRequest) {
        candidates = results;
      }
    } catch (error: any) {
      if (request === searchRequest) {
        searchError = tr('book.searchFailed', {
          source: sourceNames[source ?? defaultSource(kind)],
          error: error.message
        });
      }
    } finally {
      if (request === searchRequest) {
        searching = false;
      }
    }
  }

  async function save(entry: MetadataCandidate | undefined) {
    saving = true;
    searchError = '';
    lengthNote = '';
    try {
      if (canEdit) onmetadata((await saveBookMetadata(book.title, entry))[book.title]);
      if (entry && windowsGame) await useJitenLength(entry);
      searchOpen = false;
      onchanged();
    } catch (error: any) {
      searchError = error.message;
    } finally {
      saving = false;
    }
  }

  /**
   * A Windows game's length from the pick's Jiten deck replaces the record's (and the 0 it was
   * saved with): a newer lastBookModified syncs it like any book record change.
   */
  async function useJitenLength(entry: MetadataCandidate) {
    const characters = await jitenCharacters(entry);
    const stored = characters && (await database.getDataByTitle(book.title));

    if (!characters) {
      lengthNote = $t$('book.noJitenLength');
      return;
    }
    if (!stored) return;
    await database.upsertData(
      { ...stored, characters, lastBookModified: Date.now() },
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );

    const bookmark = await database.getBookmark(stored.id);

    if (bookmark) {
      await database.putBookmark(
        vnBookmark(stored.id, bookmark.exploredCharCount ?? 0, characters)
      );
    }
  }
</script>

<section class="details-fetch" aria-labelledby="book-details-fetch">
  {#if !searchOpen}
    <button type="button" class="app-button" onclick={openSearch}>
      <Fa icon={faMagnifyingGlass} />
      {canEdit && metadata
        ? $t$('book.changeDetails')
        : $t$(canEdit ? 'book.findDetailsOn' : 'book.findLengthOn', {
            source: sourceNames[defaultSource(kind)]
          })}
    </button>
    {#if canEdit && metadata}
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={saving}
        onclick={() => save(undefined)}
      >
        {metadata.cover ? $t$('book.removeDetailsCover') : $t$('book.removeDetails')}
      </button>
    {/if}
  {:else}
    <h2 id="book-details-fetch" class="details-fetch-heading">
      {$t$('book.findDetails')}
    </h2>
    <form
      class="details-search"
      onsubmit={(ev) => {
        ev.preventDefault();
        search();
      }}
    >
      <select
        class="app-input"
        aria-label={$t$('book.source')}
        bind:value={source}
        onchange={() => ((candidates = undefined), search())}
      >
        <option value={defaultSource(kind)}>{sourceNames[defaultSource(kind)]}</option>
        <option value="jiten">Jiten</option>
      </select>
      <input
        class="app-input"
        type="search"
        lang="ja"
        aria-label={$t$('book.searchSource', {
          source: sourceNames[source ?? defaultSource(kind)]
        })}
        bind:value={searchTerm}
        onkeydown={(ev) => ev.key === 'Escape' && (searchOpen = false)}
      />
      <button type="submit" class="app-button">
        <Fa icon={searching ? faSpinner : faMagnifyingGlass} spin={searching} />
        {$t$('book.search')}
      </button>
      <button
        type="button"
        class="app-button app-button-quiet"
        onclick={() => (searchOpen = false)}
      >
        {$t$('book.cancel')}
      </button>
    </form>
    {#if candidates && !candidates.length && !searching}
      <p class="details-note">{$t$('book.nothingFound')}</p>
    {/if}
    {#if candidates?.length}
      <ul class="details-candidates">
        {#each candidates as candidate (candidate.url)}
          <li>
            {#if candidate.cover}
              <img src={candidate.cover} alt="" loading="lazy" referrerpolicy="no-referrer" />
            {:else}
              <span class="details-candidate-blank" />
            {/if}
            <span class="details-candidate-text">
              <a href={candidate.url} target="_blank" rel="noreferrer" lang="ja">
                {candidate.title}
              </a>
              <span class="details-note">
                {candidate.released.slice(0, 4) ||
                  $t$('book.undated')}{#if candidate.genres.length},
                  {candidate.genres.slice(0, 3).join(', ')}{/if}
              </span>
              <span class="details-candidate-buttons">
                <button
                  type="button"
                  class="app-button"
                  disabled={saving}
                  onclick={() => save({ ...candidate, cover: '' })}
                >
                  {$t$(canEdit ? 'book.useDetails' : 'book.useLength')}
                </button>
                {#if canEdit && candidate.cover}
                  <button
                    type="button"
                    class="app-button"
                    disabled={saving}
                    onclick={() => save(candidate)}
                  >
                    {$t$('book.useDetailsCover')}
                  </button>
                {/if}
              </span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if searchError}
    <p class="text-danger" role="alert">{searchError}</p>
  {/if}
  {#if lengthNote}
    <p class="details-note" role="status">{lengthNote}</p>
  {/if}
</section>

<style>
  .details-note {
    display: block;
    width: 100%;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .details-fetch {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .details-fetch-heading {
    width: 100%;
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .details-search {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .details-search input {
    min-width: 12rem;
    flex: 1;
  }

  .details-candidates {
    display: flex;
    width: 100%;
    flex-direction: column;
    border-top: 2px solid var(--font-color);
  }

  .details-candidates li {
    display: flex;
    gap: 0.9rem;
    padding: 0.8rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .details-candidates img,
  .details-candidate-blank {
    width: 4rem;
    flex: 0 0 auto;
    aspect-ratio: 375 / 529;
    object-fit: cover;
    background: var(--surface-color);
  }

  .details-candidate-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.2rem;
  }

  .details-candidate-text a {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .details-candidate-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
</style>
