<script lang="ts">
  import AppHeaderLogo from '$lib/components/app-header/app-header-logo.svelte';
  import type { DiscordActivity } from '$lib/data/discord-template';
  import { t$ } from '$lib/i18n';

  /**
   * Close to how Discord shows the activity: the member list row (no "Playing") and the
   * profile card, a fixed dark Discord-style card in every theme (the approved exception to
   * theme colours; no Discord logo or font). On phones it starts collapsed to the card.
   */
  let {
    activity,
    source = '',
    userName,
    problems = 0
  }: {
    activity: DiscordActivity | undefined;
    /** Title the values come from; '' for sample values */
    source?: string;
    userName: string;
    problems?: number;
  } = $props();

  let now = $state(Date.now());
  let expanded = $state(false);
  let coverFailed = $state(false);

  const large = $derived(activity?.assets?.large_image);
  const small = $derived(activity?.assets?.small_image);
  const party = $derived(activity?.party ? ` (${activity.party.size.join(' of ')})` : '');
  const clock = $derived.by(() => {
    const { start, end } = activity?.timestamps ?? {};
    const seconds = Math.max(0, Math.round((start ? now - start : end ? end - now : 0) / 1000));
    const pad = (n: number) => String(n).padStart(2, '0');
    const text =
      seconds >= 3600
        ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
        : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

    if (start) return $t$('discord.elapsed', { time: text });
    if (end) return $t$('discord.left', { time: text });
    return '';
  });

  $effect(() => {
    const tick = setInterval(() => (now = Date.now()), 1000);

    return () => clearInterval(tick);
  });

  $effect(() => {
    // A new image gets its own try.
    if (large) coverFailed = false;
  });

  const isUrl = (value?: string) => !!value?.startsWith('https://');
</script>

<section class="preview" class:preview-expanded={expanded} aria-labelledby="discord-preview-head">
  <div class="preview-head">
    <h3 id="discord-preview-head">{$t$('discord.preview')}</h3>
    <span class="preview-source">
      {source ? $t$('discord.liveFrom', { title: source }) : $t$('discord.sampleValues')}
    </span>
    <span class="preview-rule" aria-hidden="true"></span>
    <button
      type="button"
      class="app-button app-button-quiet preview-expand"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? $t$('discord.collapse') : $t$('discord.expand')}
    </button>
  </div>

  {#if activity}
    <div class="preview-extra">
      <p class="preview-label">{$t$('discord.memberList')}</p>
      <div class="member">
        <span class="member-avatar" aria-hidden="true">{userName.slice(0, 1).toUpperCase()}</span>
        <div class="member-text">
          <span class="member-name">{userName}</span>
          {#if activity.name}<span class="member-activity">{activity.name}</span>{/if}
        </div>
      </div>
      <p class="preview-label">{$t$('discord.profileAndActivity')}</p>
    </div>

    <div class="card-frame">
      <div class="card">
        <div class="card-body">
          {#if large}
            <div class="card-images">
              {#if isUrl(large) && !coverFailed}
                <img class="card-large" src={large} alt="" onerror={() => (coverFailed = true)} />
              {:else}
                <span class="card-large card-logo"><AppHeaderLogo /></span>
              {/if}
              {#if small}
                <span class="card-small card-logo"><AppHeaderLogo /></span>
              {/if}
            </div>
          {/if}
          <div class="card-text">
            {#if activity.name}<p class="card-title">{activity.name}</p>{/if}
            {#if activity.details}
              <p class="card-line" class:card-link={!!activity.details_url}>{activity.details}</p>
            {/if}
            {#if activity.state || party}
              <p class="card-line" class:card-link={!!activity.state_url}>
                {activity.state ?? ''}{party}
              </p>
            {/if}
            {#if clock}<p class="card-line card-clock">{clock}</p>{/if}
          </div>
        </div>
        {#each activity.buttons ?? [] as button (button.label + button.url)}
          <span class="card-button">{button.label}</span>
        {/each}
      </div>
    </div>

    <dl class="preview-extra hovers">
      {#if activity.assets?.large_text}
        <div>
          <dt>{$t$('discord.largeHover')}</dt>
          <dd>{activity.assets.large_text}</dd>
        </div>
      {/if}
      {#if activity.assets?.small_text}
        <div>
          <dt>{$t$('discord.smallHover')}</dt>
          <dd>{activity.assets.small_text}</dd>
        </div>
      {/if}
    </dl>
  {:else}
    <p class="preview-note">{$t$('discord.nothingShown')}</p>
  {/if}

  {#if problems}
    <p class="preview-problems" role="status">{$t$('discord.problems', { count: problems })}</p>
  {:else}
    <p class="preview-note preview-extra">{$t$('discord.previewNote')}</p>
  {/if}
</section>

<style>
  .preview {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
  }

  .preview-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    min-width: 0;
  }

  .preview-head h3 {
    font-size: var(--type-h2);
    font-weight: 400;
  }

  .preview-source {
    min-width: 0;
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-rule {
    flex: 1 1 0;
    min-width: 1rem;
    align-self: center;
    border-top: 1px solid var(--border-color);
  }

  .preview-expand {
    display: none;
    flex: none;
  }

  .preview-label {
    margin: 0.4rem 0 0.35rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .member-avatar {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--font-color);
    color: var(--background-color);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .member-text {
    display: grid;
    min-width: 0;
  }

  .member-name {
    font-size: var(--type-body);
  }

  .member-activity {
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The Discord-style card: fixed colours, the same in light and dark themes. */
  .card-frame {
    padding: 0.6rem;
    border-radius: 2px;
    background: #111214;
  }

  .card {
    display: grid;
    gap: 0.5rem;
    padding: 0.85rem;
    border-radius: 4px;
    background: #232428;
    color: #dbdee1;
  }

  .card-body {
    display: flex;
    gap: 0.75rem;
    min-width: 0;
  }

  .card-images {
    position: relative;
    width: 4.5rem;
    height: 4.5rem;
    flex: none;
  }

  .card-large {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 4px;
    object-fit: cover;
  }

  .card-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111214;
    color: #f2f3f5;
  }

  .card-logo :global(svg) {
    width: 70%;
    height: 70%;
  }

  .card-small {
    position: absolute;
    right: -0.35rem;
    bottom: -0.35rem;
    width: 1.5rem;
    height: 1.5rem;
    border: 3px solid #232428;
    border-radius: 50%;
  }

  .card-small :global(svg) {
    width: 100%;
    height: 100%;
  }

  .card-text {
    display: grid;
    align-content: start;
    gap: 0.15rem;
    min-width: 0;
  }

  .card-title {
    color: #f2f3f5;
    font-size: var(--type-body);
    font-weight: 700;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .card-line {
    font-size: var(--type-small);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .card-link {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .card-clock {
    color: #b5bac1;
    font-variant-numeric: tabular-nums;
  }

  .card-button {
    display: block;
    overflow: hidden;
    padding: 0.4rem 0.75rem;
    border-radius: 3px;
    background: #4e5058;
    color: #f2f3f5;
    font-size: var(--type-small);
    font-weight: 700;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hovers {
    display: grid;
    border-top: 2px solid var(--font-color);
  }

  .hovers div {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .hovers dt {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .hovers dd {
    font-size: var(--type-small);
    overflow-wrap: anywhere;
  }

  .preview-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .preview-problems {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  /* Phones: the card alone, one line each, until expanded. */
  @media (max-width: 640px) {
    .preview-expand {
      display: inline-flex;
    }

    .preview:not(.preview-expanded) .preview-extra {
      display: none;
    }

    .preview:not(.preview-expanded) .card-images {
      width: 3rem;
      height: 3rem;
    }

    .preview:not(.preview-expanded) .card-title,
    .preview:not(.preview-expanded) .card-line {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .preview:not(.preview-expanded) .card-button {
      display: none;
    }
  }
</style>
