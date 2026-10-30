<script lang="ts">
  import { avatarKanji, pictureUrl } from '$lib/data/social/social-account';

  /** A preset avatar (its kanji in white on its colour), or the person's picture, as a circle */
  export let avatar: number;
  /** Whose: their uploaded picture shows when they have one (the preset if it fails to load) */
  export let person: { id: string; picture?: number } | undefined = undefined;
  /** A picture to show instead (the crop preview) */
  export let src = '';
  /** Diameter in rem */
  export let size = 2.5;
  /** The person's name, for screen readers; empty when the name is shown beside it */
  export let label = '';

  let failed = '';

  $: index = ((avatar % avatarKanji.length) + avatarKanji.length) % avatarKanji.length;
  $: picture = src || pictureUrl(person);
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
  lang="ja"
  >{#if picture && failed !== picture}<img
      class="social-avatar-picture"
      src={picture}
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      on:error={() => (failed = picture)}
    />{:else}{avatarKanji[index]}{/if}</span
>

<style>
  .social-avatar {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 50%;
    background: var(--social-avatar-bg);
    color: var(--avatar-text);
    font-weight: 700;
    line-height: 1;
  }

  .social-avatar-picture {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
