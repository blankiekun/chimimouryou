<script lang="ts">
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import CommunityReports from '$lib/components/community/community-reports.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import LibraryCovers from '$lib/components/social/library-covers.svelte';
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { pagePath } from '$lib/data/env';
  import { relativeTime } from '$lib/functions/format-time';
  import { monthName } from '$lib/data/social';
  import { hubErrorKey, hubImageUrl, refreshMe, socialSession$ } from '$lib/data/social-account';
  import {
    deleteUserRow,
    dismissReports,
    loadReports,
    lookUpUser,
    removeCover,
    removeUserPicture,
    resetName,
    type LookedUp,
    type OpenReport,
    type UserRows
  } from '$lib/data/social-moderation';
  import { libraryCoversAvailable } from '$lib/data/library-covers';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { onMount } from 'svelte';

  /**
   * Hub moderation for role 'dev' (Settings → Social links here only for them; the hub checks
   * the role on every request): open reports, and one reader's rows by username.
   */

  let reports: OpenReport[] | undefined;
  let error = '';
  let busy = false;
  let username = '';
  let found: LookedUp | undefined;
  let lookupError = '';

  $: dev = $socialSession$?.me.role === 'dev';
  $: if (dev && !reports) reload();

  onMount(() => {
    if ($socialSession$) refreshMe().catch(() => {});
  });

  const when = (at: number) => relativeTime(at, $uiLanguage$);
  /** A thumbnail missing from R2 */
  const hideImage = (event: Event) => ((event.currentTarget as HTMLElement).hidden = true);
  const range = (first: number, last: number) =>
    when(first) === when(last) ? when(first) : `${when(first)} – ${when(last)}`;
  const kindLabel = (what: OpenReport['what']) => `moderation.what.${what}` as MessageKey;
  const eventLabel = (type: string) => `moderation.event.${type}` as MessageKey;

  async function reload() {
    try {
      reports = await loadReports();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  /** Runs one change after a confirm, then refreshes the reports and the reader shown */
  async function act(confirm: string, task: () => Promise<void>) {
    if (busy || !window.confirm(confirm)) return;
    busy = true;
    error = '';
    try {
      await task();
      await reload();
      if (found) found = await lookUpUser(found.user.username);
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
    busy = false;
  }

  function resolve(report: OpenReport) {
    const who = report.user?.username ?? '';

    if (report.what === 'name') {
      act($t$('moderation.resetNameConfirm', { username: who }), () => resetName(report.target));
    } else if (report.what === 'picture') {
      act($t$('moderation.removePictureConfirm', { username: who }), () =>
        removeUserPicture(report.target)
      );
    } else {
      act($t$('moderation.removeCoverConfirm'), () => removeCover(report.target));
    }
  }

  async function lookUp() {
    lookupError = '';
    found = undefined;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username.trim())) {
      lookupError = $t$('social.error.username');
      return;
    }
    busy = true;
    try {
      found = await lookUpUser(username.trim());
    } catch (e) {
      lookupError = $t$(
        (e as { status?: number }).status === 404 ? 'moderation.noUser' : hubErrorKey(e)
      );
    }
    busy = false;
  }

  function show(name: string) {
    username = name;
    lookUp();
    document.getElementById('moderation-lookup')?.scrollIntoView();
  }

  function deleteRow(rows: UserRows, id: string | number, title: string) {
    const user = found!.user;

    act($t$('moderation.deleteRowConfirm', { title, username: user.username }), () =>
      deleteUserRow(user.id, rows, id)
    );
  }
</script>

<svelte:head>
  <title>{formatPageTitle($t$('moderation.title'))}</title>
</svelte:head>

<AppHeader active="settings" />

<div class="app-page-shell">
  <main class="moderation-page">
    <a class="app-button-quiet moderation-back" href="{pagePath}/settings?section=social"
      >← {$t$('nav.settings')}</a
    >
    <h1 class="moderation-title">{$t$('moderation.title')}</h1>

    {#if !dev}
      <p class="moderation-note">{$t$('moderation.devOnly')}</p>
    {:else}
      {#if error}<p class="moderation-error" role="alert">{error}</p>{/if}

      <section class="moderation-section" aria-labelledby="moderation-reports">
        <SectionHead
          id="moderation-reports"
          number={1}
          title={$t$('moderation.reports')}
          count={reports?.length}
        />
        {#if !reports}
          <p class="moderation-note">{$t$('moderation.loading')}</p>
        {:else if !reports.length}
          <p class="moderation-note">{$t$('moderation.noReports')}</p>
        {:else}
          <table class="app-table">
            <thead>
              <tr>
                <th>{$t$('moderation.reported')}</th>
                <th class="moderation-wide">{$t$('moderation.reportCount')}</th>
                <th class="moderation-wide">{$t$('moderation.dates')}</th>
                <th><span class="sr-only">{$t$('moderation.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {#each reports as report (`${report.what}:${report.target}`)}
                <tr>
                  <td>
                    <div class="moderation-target">
                      {#if report.what === 'cover'}
                        {#if report.cover && !report.removed}
                          <img
                            class="moderation-cover"
                            src={hubImageUrl(`cover/${report.cover}`)}
                            alt=""
                            loading="lazy"
                            on:error={hideImage}
                          />
                        {/if}
                      {:else if report.user}
                        <SocialAvatar
                          avatar={report.user.avatar}
                          person={report.what === 'picture' ? report.user : undefined}
                          size={report.what === 'picture' ? 3.5 : 2}
                        />
                      {/if}
                      <span class="moderation-target-text">
                        <span class="app-tag">{$t$(kindLabel(report.what))}</span>
                        {#if report.what === 'cover'}
                          <strong lang="ja">{report.title || report.target}</strong>
                          <small>
                            {report.removed
                              ? $t$('moderation.coverRemoved')
                              : report.uploader
                                ? $t$('moderation.uploadedBy', { username: report.uploader })
                                : ''}
                          </small>
                        {:else if report.user}
                          <strong>{report.user.name}</strong>
                          <button
                            type="button"
                            class="app-button-quiet moderation-user"
                            on:click={() => report.user && show(report.user.username)}
                            >@{report.user.username}</button
                          >
                        {:else}
                          <small>{$t$('moderation.gone')}</small>
                        {/if}
                        <small class="moderation-narrow">
                          {$t$('moderation.reportsSince', {
                            count: report.count,
                            when: when(report.first)
                          })}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td class="moderation-wide moderation-number">{report.count}</td>
                  <td class="moderation-wide moderation-muted">
                    {range(report.first, report.last)}
                  </td>
                  <td>
                    <span class="moderation-actions">
                      {#if (report.what !== 'cover' && report.user) || (report.what === 'cover' && !report.removed)}
                        <button
                          type="button"
                          class="app-button app-button-danger"
                          disabled={busy}
                          on:click={() => resolve(report)}
                        >
                          {$t$(
                            report.what === 'name'
                              ? 'moderation.resetName'
                              : report.what === 'picture'
                                ? 'social.removePicture'
                                : 'moderation.removeCover'
                          )}
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="app-button"
                        disabled={busy}
                        on:click={() =>
                          act($t$('moderation.dismissConfirm'), () => dismissReports(report))}
                      >
                        {$t$('moderation.dismiss')}
                      </button>
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <div class="moderation-section"><CommunityReports number={2} /></div>

      <section class="moderation-section" aria-labelledby="moderation-lookup">
        <SectionHead id="moderation-lookup" number={3} title={$t$('moderation.lookUp')} />
        <form class="moderation-form" on:submit|preventDefault={lookUp}>
          <input
            class="app-input"
            aria-label={$t$('social.username')}
            placeholder={$t$('social.username')}
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            maxlength="20"
            bind:value={username}
          />
          <button type="submit" class="app-button app-button-primary" disabled={busy}>
            {$t$('moderation.lookUpButton')}
          </button>
        </form>
        {#if lookupError}<p class="moderation-error" role="alert">{lookupError}</p>{/if}

        {#if found}
          {@const user = found.user}
          <div class="moderation-person">
            <SocialAvatar avatar={user.avatar} person={user} size={3.5} />
            <div class="moderation-person-text">
              <strong class="moderation-person-name"
                >{user.name}<RoleBadge role={user.role} /></strong
              >
              <small>
                <a href="{pagePath}/u?name={encodeURIComponent(user.username)}">@{user.username}</a>
                · {$t$('moderation.joined', { when: when(user.created) })}
                · {$t$('moderation.lastSeen', { when: when(user.lastSeen) })}
                · {$t$(user.public ? 'moderation.public' : 'moderation.private')}
              </small>
            </div>
            <span class="moderation-actions">
              {#if user.name !== user.username}
                <button
                  type="button"
                  class="app-button app-button-danger"
                  disabled={busy}
                  on:click={() =>
                    act($t$('moderation.resetNameConfirm', { username: user.username }), () =>
                      resetName(user.id)
                    )}>{$t$('moderation.resetName')}</button
                >
              {/if}
              {#if user.picture}
                <button
                  type="button"
                  class="app-button app-button-danger"
                  disabled={busy}
                  on:click={() =>
                    act($t$('moderation.removePictureConfirm', { username: user.username }), () =>
                      removeUserPicture(user.id)
                    )}>{$t$('social.removePicture')}</button
                >
              {/if}
            </span>
          </div>

          <h3 class="moderation-subhead">{$t$('moderation.readingNow')}</h3>
          {#if found.books.length}
            <table class="app-table">
              <tbody>
                {#each found.books as book (book.slot)}
                  <tr>
                    <td lang="ja">{book.title || $t$('moderation.hiddenBook')}</td>
                    <td class="moderation-number moderation-fit">{Math.round(book.pct * 100)}%</td>
                    <td class="moderation-wide moderation-muted moderation-fit"
                      >{when(book.readAt)}</td
                    >
                    <td class="moderation-row-action">
                      <button
                        type="button"
                        class="app-button app-button-quiet"
                        disabled={busy}
                        on:click={() => deleteRow('status', book.slot, book.title)}
                        >{$t$('moderation.delete')}</button
                      >
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="moderation-note">{$t$('moderation.none')}</p>
          {/if}

          <h3 class="moderation-subhead">{$t$('moderation.finished')}</h3>
          {#if found.finished.length}
            <table class="app-table">
              <tbody>
                {#each found.finished as book (book.key)}
                  <tr>
                    <td lang="ja">{book.title}</td>
                    <td class="moderation-muted moderation-fit"
                      >{monthName(book.month, $uiLanguage$)}</td
                    >
                    <td class="moderation-row-action">
                      <button
                        type="button"
                        class="app-button app-button-quiet"
                        disabled={busy}
                        on:click={() => deleteRow('finished', book.key, book.title)}
                        >{$t$('moderation.delete')}</button
                      >
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="moderation-note">{$t$('moderation.none')}</p>
          {/if}

          <h3 class="moderation-subhead">{$t$('moderation.events')}</h3>
          {#if found.events.length}
            <table class="app-table">
              <tbody>
                {#each found.events as event (event.id)}
                  <tr>
                    <td>
                      {$t$(eventLabel(event.type))}
                      {#if event.type === 'streak'}
                        {$t$('moderation.days', { days: event.value })}
                      {:else}
                        <span lang="ja">{event.title}</span>
                      {/if}
                    </td>
                    <td class="moderation-muted moderation-fit">{when(event.at)}</td>
                    <td class="moderation-row-action">
                      <button
                        type="button"
                        class="app-button app-button-quiet"
                        disabled={busy}
                        on:click={() =>
                          deleteRow('events', event.id, event.title || $t$(eventLabel(event.type)))}
                        >{$t$('moderation.delete')}</button
                      >
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="moderation-note">{$t$('moderation.none')}</p>
          {/if}
        {/if}
      </section>

      {#if libraryCoversAvailable}
        <div class="moderation-section"><LibraryCovers number={4} /></div>
      {/if}
    {/if}
  </main>
</div>

<style>
  .moderation-page {
    display: flex;
    max-width: 60rem;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .moderation-page {
      padding: 6rem 2.5rem 4rem;
    }
  }

  .moderation-back {
    align-self: flex-start;
  }

  .moderation-title {
    font-size: var(--type-h1);
    font-weight: 400;
  }

  .moderation-section {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1rem;
  }

  .moderation-note,
  .moderation-muted,
  small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .moderation-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .moderation-target {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .moderation-target-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    overflow-wrap: anywhere;
  }

  .moderation-cover {
    width: 2.5rem;
    flex: none;
    border: 1px solid var(--border-color);
    border-radius: 2px;
  }

  .moderation-user {
    min-height: 0;
    padding: 0;
    font-size: var(--type-small);
  }

  .moderation-number {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .moderation-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .moderation-actions .app-button,
  .moderation-form .app-button {
    white-space: nowrap;
  }

  .moderation-fit,
  .moderation-row-action {
    width: 1%;
    text-align: right;
    white-space: nowrap;
  }

  .moderation-form {
    display: flex;
    max-width: 28rem;
    gap: 0.5rem;
  }

  .moderation-form input {
    min-width: 0;
    flex: 1 1 auto;
  }

  .moderation-person {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 1rem 0;
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
  }

  .moderation-person-text {
    display: flex;
    min-width: 0;
    flex: 1 1 14rem;
    flex-direction: column;
    gap: 0.2rem;
    overflow-wrap: anywhere;
  }

  .moderation-person-name {
    font-size: var(--type-h2);
    font-weight: 400;
  }

  .moderation-subhead {
    margin-top: 0.5rem;
    font-weight: 700;
  }

  .moderation-narrow {
    display: none;
  }

  @media (max-width: 640px) {
    .moderation-wide {
      display: none;
    }

    .moderation-narrow {
      display: inline;
    }
  }
</style>
