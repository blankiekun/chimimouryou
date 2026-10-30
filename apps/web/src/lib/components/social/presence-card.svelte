<script lang="ts">
  import { activityClock, type DiscordActivity } from '$lib/data/discord/discord-template';
  import { t$ } from '$lib/i18n';

  /**
   * A profile's current Discord status (board 8): the hub's `presence`, shown to friends and
   * oneself when Show on my profile is on. Study Book colours, not the Discord-style card.
   */
  let { activity, self = false }: { activity: DiscordActivity; self?: boolean } = $props();

  let now = $state(Date.now());
  let imageFailed = $state(false);

  // Only https images: asset keys like `applogo` live on Discord. The CSP limits hosts further.
  const image = $derived(
    activity.assets?.large_image?.startsWith('https://') ? activity.assets.large_image : ''
  );
  const party = $derived(activity.party ? ` (${activity.party.size.join(' of ')})` : '');
  const clock = $derived.by(() => {
    const time = activityClock(activity.timestamps, now);

    if (!time) return '';
    return time.mode === 'elapsed'
      ? $t$('discord.elapsed', { time: time.text })
      : $t$('discord.left', { time: time.text });
  });

  $effect(() => {
    if (!activity.timestamps) return;

    const tick = setInterval(() => (now = Date.now()), 1000);

    return () => clearInterval(tick);
  });
</script>

<div class="presence">
  <div class="presence-card">
    {#if image && !imageFailed}
      <img
        class="presence-image"
        src={image}
        alt=""
        referrerpolicy="no-referrer"
        onerror={() => (imageFailed = true)}
      />
    {/if}
    <div class="presence-text">
      <p class="presence-now">{$t$('discord.now')}</p>
      {#if activity.name}<p class="presence-name">{activity.name}</p>{/if}
      {#if activity.details}<p class="presence-line">{activity.details}</p>{/if}
      {#if activity.state || party}
        <p class="presence-line">{activity.state ?? ''}{party}</p>
      {/if}
      {#if clock}<p class="presence-clock">{clock}</p>{/if}
    </div>
  </div>
  {#if self}<p class="presence-note">{$t$('discord.profileNote')}</p>{/if}
</div>

<style>
  .presence-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    border-radius: 2px;
    background: var(--surface-color);
  }

  .presence-image {
    width: 4rem;
    height: 5.5rem;
    flex: none;
    border-radius: 2px;
    object-fit: cover;
  }

  .presence-text {
    display: grid;
    min-width: 0;
    gap: 0.15rem;
  }

  .presence-now {
    color: var(--accent-strong-color);
    font-size: var(--type-label);
  }

  .presence-name {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .presence-name,
  .presence-line {
    overflow-wrap: anywhere;
  }

  .presence-line,
  .presence-clock {
    font-size: var(--type-small);
  }

  .presence-clock,
  .presence-note {
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .presence-note {
    margin-top: 0.5rem;
    font-size: var(--type-small);
  }
</style>
