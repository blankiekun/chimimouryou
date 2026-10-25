<script lang="ts">
  import { pagePath } from '$lib/data/env';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /**
   * Signed out: the read-only line over the feed ("Reading only. Sign up to post."), or the box a
   * write opens (Post, Reply, Helpful, Report). Sign-up and log-in are on /friends.
   */
  export let box = false;

  const dispatch = createEventDispatcher<{ close: void }>();
</script>

{#if box}
  <section class="signup-box" aria-labelledby="community-signup-title">
    <h3 id="community-signup-title">{$t$('community.signUpTitle')}</h3>
    <p>{$t$('community.signUpText')}</p>
    <div class="signup-actions">
      <a class="app-button app-button-primary" href="{pagePath}/friends">{$t$('social.signUp')}</a>
      <a class="app-button" href="{pagePath}/friends?mode=login">{$t$('social.logIn')}</a>
      <button type="button" class="app-button-quiet" on:click={() => dispatch('close')}
        >{$t$('community.notNow')}</button
      >
    </div>
  </section>
{:else}
  <p class="signup-line">
    <span>{$t$('community.readOnly')}</span>
    <span class="signup-links">
      <a class="app-button-quiet" href="{pagePath}/friends">{$t$('social.signUp')}</a>
      <a class="app-button-quiet" href="{pagePath}/friends?mode=login">{$t$('social.logIn')}</a>
    </span>
  </p>
{/if}

<style>
  .signup-box {
    padding: 1rem;
    border: 1px solid var(--c-ink, var(--font-color));
    border-radius: 2px;
  }

  .signup-box h3 {
    font-size: var(--type-h2);
  }

  .signup-box p {
    margin-top: 0.5rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .signup-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .signup-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1rem;
    padding: 0.6rem 0.75rem;
    background: var(--c-field, var(--surface-color));
    font-size: var(--type-small);
  }

  .signup-line > span:first-child {
    margin-right: auto;
  }

  .signup-links {
    display: flex;
    gap: 1rem;
    white-space: nowrap;
  }
</style>
