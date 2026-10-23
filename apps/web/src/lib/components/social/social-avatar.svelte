<script lang="ts">
  import { avatarKanji } from '$lib/data/social-account';

  /** A preset avatar: its kanji in white on its colour, as a circle */
  export let avatar: number;
  /** Diameter in rem */
  export let size = 2.5;
  /** The person's name, for screen readers; empty when the name is shown beside it */
  export let label = '';

  $: index = ((avatar % avatarKanji.length) + avatarKanji.length) % avatarKanji.length;
</script>

<span
  class="social-avatar"
  style:--social-avatar-bg="var(--avatar-{(index % 8) + 1})"
  style:width="{size}rem"
  style:height="{size}rem"
  style:font-size="{size * 0.45}rem"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
  lang="ja">{avatarKanji[index]}</span
>

<style>
  .social-avatar {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--social-avatar-bg);
    color: var(--avatar-text);
    font-weight: 700;
    line-height: 1;
  }
</style>
