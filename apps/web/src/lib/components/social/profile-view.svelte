<script lang="ts">
  import RankBadge from '$lib/components/reading-rank/rank-badge.svelte';
  import { lightNovels } from '$lib/data/reading-rank';
  import CoverCard from '$lib/components/book-card/cover-card.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import SectionHead from '$lib/components/section-head.svelte';
  import ActivityFeed from '$lib/components/social/activity-feed.svelte';
  import FriendCover from '$lib/components/social/friend-cover.svelte';
  import PresenceCard from '$lib/components/social/presence-card.svelte';
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { pagePath } from '$lib/data/env';
  import {
    blockFriend,
    monthName,
    relativeTime,
    removeFriend,
    reportCover,
    reportProfile,
    requestByUsername,
    type Profile
  } from '$lib/data/social';
  import {
    hubErrorKey,
    queueProfileChange,
    shareDefaults,
    socialSession$,
    type ShareKey
  } from '$lib/data/social-account';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /**
   * A reader's profile (boards 07-11): who, the stats row, Now reading, Finished, the last
   * 12 weeks and (friends and oneself) Activity. Own profile: Edit, Copy link and what it
   * shows; a friend's: Remove friend, Block; a visitor: Add friend. Signed-in others get Report.
   */
  export let profile: Profile;
  export let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined =
    undefined;

  const dispatch = createEventDispatcher<{ removed: void }>();
  const showsRows: ShareKey[] = ['current', 'finished', 'activity', 'stats', 'wordsKnown'];

  let error = '';
  let note = '';

  $: person = profile.profile;
  $: self = profile.relation === 'self';
  $: me = $socialSession$?.me;
  $: shared = (key: ShareKey) => me?.share[key] ?? shareDefaults[key];
  // One's own toggles take effect here at once; the hub deletes the data with the change.
  $: show = (key: ShareKey) => !self || shared(key);
  $: stats = show('stats') ? profile.stats : null;
  $: dateFormat = new Intl.DateTimeFormat($uiLanguage$, { month: 'long', year: 'numeric' });
  $: shortMonth = (month: string) => {
    const [year, number] = month.split('-').map(Number);

    return new Intl.DateTimeFormat($uiLanguage$, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(Date.UTC(year, number - 1, 15));
  };
  $: link = `${typeof location === 'undefined' ? '' : location.origin}${pagePath}/u?name=${person.username}`;
  $: daysRead = stats ? [...stats.heat].filter((level) => level !== '0').length : 0;
  $: year = new Date().getFullYear();
  $: statCells = (
    stats
      ? [
          ...(stats.rank
            ? [
                { value: '', tier: stats.rank, label: $t$('social.rank') },
                {
                  value: lightNovels(stats.chars ?? 0).toFixed(1),
                  label: $t$('social.novels')
                }
              ]
            : []),
          {
            value: $t$(stats.streak === 1 ? 'social.dayOne' : 'social.days', {
              count: stats.streak
            }),
            label: $t$('social.streak')
          },
          { value: stats.weekChars.toLocaleString('en-US'), label: $t$('social.charsWeek') },
          { value: duration(stats.weekMinutes), label: $t$('social.timeWeek') },
          { value: String(stats.finishedYear), label: $t$('social.finishedIn', { year }) },
          ...(stats.wordsKnown !== undefined && show('wordsKnown')
            ? [{ value: stats.wordsKnown.toLocaleString('en-US'), label: $t$('social.wordsKnown') }]
            : [])
        ]
      : []
  ) as { value: string; label: string; tier?: number }[];
  $: books = show('current') ? profile.books : [];
  $: finished = show('finished') ? profile.finished.slice(0, 10) : [];
  $: events = self && !shared('activity') ? [] : profile.events;
  $: sections = [
    books.length && 'reading',
    finished.length && 'finished',
    stats && 'weeks',
    profile.relation !== 'visitor' && show('activity') && 'activity'
  ].filter(Boolean);
  $: numberOf = (section: string) => sections.indexOf(section) + 1;

  function duration(minutes: number) {
    const hours = Math.floor(minutes / 60);

    return hours
      ? $t$('dashboard.hours', { hours, minutes: minutes % 60 })
      : $t$('dashboard.minutes', { minutes });
  }

  function card(book: Profile['books'][number]): BookCardProps {
    return {
      id: -1,
      imagePath: '',
      title: book.kind === 'hidden' ? $t$('social.readingSomething') : book.title,
      characters: 0,
      lastBookModified: 0,
      lastBookOpen: 0,
      lastBookmarkModified: 0,
      isPlaceholder: false,
      progress: book.pct
    } as BookCardProps;
  }

  async function act(action: () => Promise<unknown>, done?: () => void) {
    error = '';
    note = '';
    try {
      await action();
      done?.();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  function copyLink() {
    navigator.clipboard
      ?.writeText(link)
      .then(() => (note = $t$('social.linkCopied')))
      .catch(() => {});
  }

  let reporting = false;

  // Covers shown from the hub (not the reader's own) can be reported too.
  $: hubCovers = [...profile.books, ...profile.finished].filter(
    (book, index, all) =>
      book.cover &&
      !covers?.get(book.key) &&
      all.findIndex((other) => other.key === book.key) === index
  );

  function report(what: 'name' | 'picture') {
    if (window.confirm($t$('social.reportConfirm', { name: person.name }))) {
      act(
        () => reportProfile(person.username, what),
        () => ((note = $t$('social.reported')), (reporting = false))
      );
    }
  }

  function reportBookCover(book: { key: string; title: string }) {
    if (window.confirm($t$('social.reportCoverConfirm', { title: book.title }))) {
      act(
        () => reportCover(book.key, profile.profile.username),
        () => ((note = $t$('social.reported')), (reporting = false))
      );
    }
  }

  const switchLabel = (on: boolean) => $t$(on ? 'settings.on' : 'settings.off');
  const showsLabel = (key: ShareKey) => `social.shows.${key}` as MessageKey;
</script>

<div class="profile">
  <aside class="profile-who">
    <SocialAvatar avatar={person.avatar} {person} size={7.5} />
    <div>
      <h1 id="profile-name" class="profile-name">
        {person.name}<RoleBadge role={person.role} />
      </h1>
      <p class="profile-meta">
        @{person.username} · {$t$('social.memberSinceShort', {
          since: dateFormat.format(person.created * 1000)
        })}
      </p>
      {#if profile.relation === 'friend' && profile.since}
        <p class="profile-meta">
          {$t$('social.friendsSince', { since: dateFormat.format(profile.since * 1000) })}
        </p>
      {/if}
    </div>

    {#if self}
      <div class="profile-actions">
        <a class="app-button" href="{pagePath}/settings?section=social#social-profile"
          >{$t$('social.editProfile')}</a
        >
        <button type="button" class="app-button-quiet" on:click={copyLink}
          >{$t$('social.copyLink')}</button
        >
      </div>
      <p class="profile-public">
        <strong>{$t$('social.publicProfile')}</strong> · {switchLabel(shared('public'))}
        <span class="profile-link">{link.replace(/^https?:\/\//, '')}</span>
      </p>
      <div class="profile-shows">
        <h2 class="profile-shows-title">{$t$('social.whatProfileShows')}</h2>
        {#each showsRows as key (key)}
          <div class="profile-shows-row">
            <span>{$t$(showsLabel(key))}</span>
            <button
              type="button"
              role="switch"
              class="app-switch"
              aria-checked={shared(key)}
              aria-label={$t$(showsLabel(key))}
              on:click={() =>
                queueProfileChange(
                  { share: { [key]: !shared(key) } },
                  (e) => (error = $t$(hubErrorKey(e)))
                )}
            >
              <span class="app-switch-thumb" />
              <span class="app-switch-text">{switchLabel(shared(key))}</span>
            </button>
          </div>
        {/each}
        {#if !shared('wordsKnown')}
          <p class="profile-hint">{$t$('social.wordsKnownOff')}</p>
        {/if}
      </div>
    {:else if profile.relation === 'friend'}
      <div class="profile-actions">
        <button
          type="button"
          class="app-button"
          on:click={() =>
            window.confirm($t$('social.removeConfirm', { name: person.name })) &&
            act(
              () => removeFriend(person.id),
              () => dispatch('removed')
            )}>{$t$('social.remove')}</button
        >
        <button
          type="button"
          class="app-button-quiet profile-danger"
          on:click={() =>
            window.confirm($t$('social.blockConfirm', { name: person.name })) &&
            act(
              () => blockFriend(person.id),
              () => dispatch('removed')
            )}>{$t$('social.block')}</button
        >
      </div>
    {:else}
      <div class="profile-actions profile-actions-stack">
        {#if me}
          <button
            type="button"
            class="app-button app-button-primary"
            on:click={() =>
              act(
                () => requestByUsername(person.username),
                () => (note = $t$('social.requestSentTo', { name: person.name }))
              )}>{$t$('social.addFriendButton')}</button
          >
        {:else}
          <a
            class="app-button app-button-primary"
            href="{pagePath}/friends?user={encodeURIComponent(person.username)}"
            >{$t$('social.addFriendButton')}</a
          >
          <p class="profile-hint">{$t$('social.addFriendVisitor', { name: person.name })}</p>
        {/if}
      </div>
    {/if}

    <!-- The hub takes reports only from signed-in readers. -->
    {#if !self && me}
      <button
        type="button"
        class="profile-report"
        aria-expanded={reporting}
        on:click={() => (reporting = !reporting)}>{$t$('social.report')}</button
      >
      {#if reporting}
        <ul class="profile-report-list">
          <li>
            <button type="button" class="profile-report" on:click={() => report('name')}
              >{$t$('social.reportName')}</button
            >
          </li>
          {#if person.picture}
            <li>
              <button type="button" class="profile-report" on:click={() => report('picture')}
                >{$t$('social.reportPicture')}</button
              >
            </li>
          {/if}
          {#each hubCovers as book (book.key)}
            <li>
              <button type="button" class="profile-report" on:click={() => reportBookCover(book)}
                >{$t$('social.reportCover', { title: book.title })}</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if note}<p class="profile-note" role="status">{note}</p>{/if}
    {#if error}<p class="profile-error" role="alert">{error}</p>{/if}
  </aside>

  <div class="profile-main">
    {#if profile.presence?.activity}
      <PresenceCard activity={profile.presence.activity} {self} />
    {/if}
    {#if statCells.length}
      <dl class="profile-stats">
        {#each statCells as cell (cell.label)}
          <div class="profile-stat">
            <dt>{cell.label}</dt>
            <dd>
              {#if cell.tier}<RankBadge tier={cell.tier} />{:else}{cell.value}{/if}
            </dd>
          </div>
        {/each}
      </dl>
    {/if}

    {#if books.length}
      <section aria-labelledby="profile-reading">
        <SectionHead
          id="profile-reading"
          number={numberOf('reading')}
          title={$t$('social.nowReading')}
          count={books.length}
        />
        <div class="profile-shelf">
          {#each books as book, index (book.key + index)}
            <CoverCard
              book={card(book)}
              meta={`${Math.round(book.pct * 100)}% · ${$t$('social.readAgo', {
                when: relativeTime(book.readAt, $uiLanguage$)
              })}`}
            >
              <svelte:fragment slot="cover">
                <FriendCover {book} {covers} avatar={person.avatar} />
              </svelte:fragment>
            </CoverCard>
          {/each}
        </div>
      </section>
    {/if}

    {#if finished.length}
      <section aria-labelledby="profile-finished">
        <SectionHead
          id="profile-finished"
          number={numberOf('finished')}
          title={$t$('social.finished')}
          count={profile.finished.length > 10 ? $t$('social.last10') : finished.length}
        />
        <ul class="profile-finished">
          {#each finished as book (book.key)}
            <li title={book.title}>
              <span class="profile-finished-cover"
                ><FriendCover {book} {covers} avatar={person.avatar} /></span
              >
              <span class="profile-finished-month">{shortMonth(book.month)}</span>
              <span class="sr-only" lang="ja">{book.title}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if stats}
      <section aria-labelledby="profile-weeks">
        <SectionHead id="profile-weeks" number={numberOf('weeks')} title={$t$('social.weeks')} />
        <div class="profile-weeks">
          <div
            class="profile-heat"
            role="img"
            aria-label={$t$('social.daysRead', { count: daysRead })}
          >
            {#each [...stats.heat] as level, index (index)}
              <span
                class="profile-heat-day"
                class:profile-heat-empty={level === '0'}
                style:--level={level}
              />
            {/each}
          </div>
          <p class="profile-weeks-total">
            <strong>{$t$('social.daysOf', { count: daysRead })}</strong>
            <span>{$t$('social.withReading')}</span>
          </p>
        </div>
      </section>
    {/if}

    {#if sections.includes('activity')}
      <ActivityFeed {events} {person} number={numberOf('activity')} />
    {/if}

    {#if !sections.length && !statCells.length}
      <p class="profile-hint">{$t$('social.profileEmpty')}</p>
    {/if}
  </div>
</div>

<style>
  .profile {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2.5rem;
  }

  @media (min-width: 1024px) {
    .profile {
      grid-template-columns: 18rem minmax(0, 1fr);
      gap: 4rem;
    }
  }

  .profile-who {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 1.25rem;
  }

  .profile-name {
    font-size: var(--type-h1);
    font-weight: 400;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .profile-meta,
  .profile-hint,
  .profile-link,
  .profile-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .profile-meta + .profile-meta {
    margin-top: 0.5rem;
  }

  .profile-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .profile-actions-stack {
    flex-direction: column;
    align-items: flex-start;
  }

  .profile-danger {
    color: var(--app-danger-color);
  }

  .profile-public {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.35rem;
    font-size: var(--type-small);
  }

  .profile-link {
    flex-basis: 100%;
    overflow-wrap: anywhere;
  }

  .profile-shows {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border-color);
  }

  .profile-shows-title {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .profile-shows-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .profile-report {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-align: left;
  }

  .profile-report-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-left: 0.75rem;
    border-left: 1px solid var(--border-color);
  }

  .profile-report:hover {
    text-decoration: underline;
  }

  .profile-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .profile-main {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3rem;
  }

  .profile-main > section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .profile-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
  }

  .profile-stat {
    display: flex;
    flex-direction: column-reverse;
    gap: 0.25rem;
    padding: 0.85rem 1rem 0.85rem 0;
  }

  .profile-stat dd {
    font-size: var(--type-number);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  /* The rank badge is wider than a cell: body size, and its English gloss wraps under it. */
  .profile-stat dd :global(.rank-badge) {
    flex-wrap: wrap;
    max-width: 100%;
    font-size: var(--type-body);
    white-space: normal;
  }

  .profile-stat dt {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .profile-shelf {
    display: grid;
    grid-auto-columns: var(--shelf-cover-width, 8.75rem);
    grid-auto-flow: column;
    justify-content: start;
    gap: 2rem;
    overflow-x: auto;
    padding: 4px 4px 0.5rem;
    margin: -4px;
  }

  .profile-finished {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: 1rem;
  }

  .profile-finished li {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.4rem;
  }

  .profile-finished-cover {
    display: block;
    font-size: var(--type-label);
  }

  .profile-finished-month {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .profile-weeks {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1.5rem 2rem;
  }

  .profile-heat {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, 1rem);
    grid-auto-columns: 1rem;
    gap: 4px;
  }

  .profile-heat-day {
    border-radius: 2px;
    background: color-mix(
      in srgb,
      var(--heatmap-high) calc((var(--level) - 1) * 33.3%),
      var(--heatmap-low)
    );
  }

  .profile-heat-empty {
    background: var(--heatmap-empty);
  }

  .profile-weeks-total {
    display: flex;
    flex-direction: column;
  }

  .profile-weeks-total span {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  @media (max-width: 639px) {
    .profile-shelf {
      gap: 1.5rem;
    }

    .profile-heat {
      grid-template-rows: repeat(7, 0.85rem);
      grid-auto-columns: 0.85rem;
      gap: 3px;
    }
  }
</style>
