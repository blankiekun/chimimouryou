<script lang="ts">
  import { t$ } from '$lib/i18n';

  /** "Dev" beside the name of a hub moderator (role 'dev'); nothing for everyone else */
  export let role: string | undefined;
</script>

{#if role === 'dev'}
  <span class="role-badge" title={$t$('social.devBadgeHint')}>{$t$('social.devBadge')}</span>
{/if}

<style>
  .role-badge {
    display: inline-block;
    margin-inline-start: 0.4em;
    padding: 0 0.35em;
    border: 1px solid var(--accent-strong-color);
    border-radius: 2px;
    color: var(--accent-strong-color);
    font-size: var(--type-label);
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.4;
    vertical-align: 0.15em;
    white-space: nowrap;
  }
</style>
