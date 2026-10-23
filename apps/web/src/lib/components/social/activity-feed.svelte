<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { relativeTime, type Person, type SocialEvent } from '$lib/data/social';
  import { t$, uiLanguage$ } from '$lib/i18n';

  /**
   * Activity, newest first: "Aki finished 本好きの下剋上 第一部", "Mio reached a 30-day streak".
   * The feed's events carry their friend; a profile's events are all `person`'s.
   */
  export let events: SocialEvent[];
  export let number: number;
  export let person: Person | undefined = undefined;
  export let limit = 20;

  const sentences = {
    started: 'social.event.started',
    finished: 'social.event.finished',
    streak: 'social.event.streak'
  } as const;
</script>

<section class="activity" aria-labelledby="activity-heading-{number}">
  <SectionHead id="activity-heading-{number}" {number} title={$t$('social.activity')} />
  {#if events.length}
    <ul class="activity-rows">
      {#each events.slice(0, limit) as event (event.id)}
        {@const who = event.user ?? person}
        <li class="activity-row">
          {#if who && !person}<SocialAvatar avatar={who.avatar} size={2} />{/if}
          <span class="activity-text">
            {#if event.type === 'streak'}
              {$t$(sentences.streak, { name: who?.name ?? '', days: event.value })}
            {:else}
              {$t$(sentences[event.type], { name: who?.name ?? '' })}
              <span lang="ja">{event.title}</span>
            {/if}
          </span>
          <time class="activity-when" datetime={new Date(event.at * 1000).toISOString()}>
            {relativeTime(event.at, $uiLanguage$)}
          </time>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="activity-empty">{$t$('social.activityEmpty')}</p>
  {/if}
</section>

<style>
  .activity {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }

  .activity-rows {
    border-top: 2px solid var(--font-color);
  }

  .activity-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 3rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .activity-text {
    min-width: 0;
    flex: 1 1 auto;
    overflow-wrap: anywhere;
  }

  .activity-when,
  .activity-empty {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .activity-when {
    flex: none;
    white-space: nowrap;
  }
</style>
