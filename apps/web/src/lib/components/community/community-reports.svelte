<script lang="ts">
  import CommunityWork from '$lib/components/community/community-work.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { relativeTime } from '$lib/data/social';
  import { hubErrorKey } from '$lib/data/social-account';
  import {
    clearMatch,
    dismissReports,
    loadCommunityReports,
    removePost,
    resetWorkInfo,
    type CommunityReports
  } from '$lib/data/social-moderation';
  import { t$, uiLanguage$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  /**
   * /moderation's Community reports (board D8): posts (Delete post), book matches (Clear match:
   * drops the confirmations) and works' titles and covers (Reset); Dismiss keeps the thing. The
   * hub has no moderator spoiler mark, so there is no Mark spoiler.
   */
  export let number: number;

  let reports: CommunityReports | undefined;
  let error = '';
  let busy = false;

  $: count = reports ? reports.posts.length + reports.works.length + reports.infos.length : 0;

  async function reload() {
    try {
      reports = await loadCommunityReports();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  onMount(reload);

  async function act(confirm: string, task: () => Promise<void>) {
    if (busy || !window.confirm(confirm)) return;
    busy = true;
    error = '';
    try {
      await task();
      await reload();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
    busy = false;
  }

  const dismiss = (what: string, target: string) =>
    act($t$('moderation.dismissConfirm'), () => dismissReports({ what, target }));
  const when = (at: number) => relativeTime(at, $uiLanguage$);
</script>

<section class="reports" aria-labelledby="moderation-community">
  <SectionHead
    id="moderation-community"
    {number}
    title={$t$('moderation.community')}
    count={reports ? count : undefined}
  />
  {#if error}<p class="reports-error" role="alert">{error}</p>{/if}
  {#if !reports}
    <p class="reports-note">{$t$('moderation.loading')}</p>
  {:else if !count}
    <p class="reports-note">{$t$('moderation.noReports')}</p>
  {:else}
    <table class="app-table">
      <thead>
        <tr>
          <th>{$t$('moderation.reported')}</th>
          <th>{$t$('moderation.reportCount')}</th>
          <th><span class="sr-only">{$t$('moderation.actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each reports.posts as post (post.id)}
          <tr>
            <td>
              <span class="app-tag">{$t$('moderation.what.post')}</span>
              <p class="reports-body">{post.body || $t$('community.deleted')}</p>
              <small lang="ja"
                >「{post.quote}」 · @{post.author?.username ?? '–'} · {when(post.last)}</small
              >
            </td>
            <td class="reports-number">{post.count}</td>
            <td>
              <span class="reports-actions">
                <button
                  type="button"
                  class="app-button app-button-danger"
                  disabled={busy}
                  on:click={() =>
                    act($t$('moderation.deletePostConfirm'), () => removePost(post.id))}
                  >{$t$('moderation.deletePost')}</button
                >
                <button
                  type="button"
                  class="app-button"
                  disabled={busy}
                  on:click={() => dismiss('post', post.id)}>{$t$('moderation.dismiss')}</button
                >
              </span>
            </td>
          </tr>
        {/each}
        {#each reports.works as match (`${match.target}:${match.work}`)}
          <tr>
            <td>
              <span class="app-tag">{$t$('moderation.what.work')}</span>
              <p class="reports-body" lang="ja">
                {match.target.split('|').slice(1).join('|')}
                {#if match.target.split('|')[0]}{$t$('community.vol', {
                    vol: match.target.split('|')[0]
                  })}{/if} → {match.work ?? '–'}
              </p>
              <small
                >{$t$('moderation.confirmedBy', { count: match.votes })} · {when(match.last)}</small
              >
            </td>
            <td class="reports-number">{match.count}</td>
            <td>
              <span class="reports-actions">
                {#if match.work}
                  <button
                    type="button"
                    class="app-button app-button-danger"
                    disabled={busy}
                    on:click={() =>
                      match.work &&
                      act($t$('moderation.clearMatchConfirm'), () =>
                        clearMatch(match.target, match.work ?? '')
                      )}>{$t$('moderation.clearMatch')}</button
                  >
                {/if}
                <button
                  type="button"
                  class="app-button"
                  disabled={busy}
                  on:click={() => dismiss('work', match.target)}>{$t$('moderation.dismiss')}</button
                >
              </span>
            </td>
          </tr>
        {/each}
        {#each reports.infos as info (info.work)}
          <tr>
            <td>
              <span class="app-tag">{$t$('moderation.what.workinfo')}</span>
              <CommunityWork
                title={info.title || info.work}
                vol={info.vol}
                cover={info.cover}
                meta={info.uploader
                  ? $t$('moderation.uploadedBy', { username: info.uploader })
                  : ''}
              />
            </td>
            <td class="reports-number">{info.count}</td>
            <td>
              <span class="reports-actions">
                <button
                  type="button"
                  class="app-button app-button-danger"
                  disabled={busy}
                  on:click={() =>
                    act($t$('moderation.resetWorkConfirm'), () => resetWorkInfo(info.work))}
                  >{$t$('moderation.resetWork')}</button
                >
                <button
                  type="button"
                  class="app-button"
                  disabled={busy}
                  on:click={() => dismiss('workinfo', info.work)}
                  >{$t$('moderation.dismiss')}</button
                >
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .reports {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .reports-note,
  small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .reports-error {
    color: var(--app-danger-color);
  }

  .reports-body {
    margin: 0.25rem 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .reports-number {
    font-variant-numeric: tabular-nums;
  }

  .reports-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
