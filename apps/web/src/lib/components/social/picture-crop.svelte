<script lang="ts">
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { hubErrorKey, uploadPicture } from '$lib/data/social-account';
  import { encodePicture, squareCrop } from '$lib/data/social-images';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onDestroy } from 'svelte';

  /**
   * The picture picker's crop (board 21, Q2): drag to move, zoom to fit, with the previews at
   * the sizes profiles (120 px), friend rows (40 px) and the header (24 px) show it. Save
   * re-encodes the square as a 256 px WebP in the browser and sends it to the hub.
   */
  export let file: File;
  export let avatar = 0;

  const dispatch = createEventDispatcher<{ done: void }>();
  const stage = 240;
  const previews = [120, 40, 24];

  let url = URL.createObjectURL(file);
  let image: HTMLImageElement | undefined;
  let width = 0;
  let height = 0;
  let zoom = 1;
  let cx = 0.5;
  let cy = 0.5;
  let drag: { x: number; y: number; cx: number; cy: number } | undefined;
  let saving = false;
  let error = '';

  onDestroy(() => URL.revokeObjectURL(url));

  $: crop = width ? squareCrop(width, height, zoom, cx, cy) : undefined;
  // The crop's square laid over a box of `size` px
  $: place = (size: number) => {
    if (!crop) return '';

    const scale = size / crop.size;

    return `width:${width * scale}px;height:${height * scale}px;transform:translate(${-crop.x * scale}px,${-crop.y * scale}px)`;
  };

  function loaded() {
    if (!image) return;
    width = image.naturalWidth;
    height = image.naturalHeight;
  }

  /** Keeps the centre where the crop can reach, so a drag back moves at once */
  function settle(x = cx, y = cy) {
    const next = squareCrop(width, height, zoom, x, y);

    cx = (next.x + next.size / 2) / width;
    cy = (next.y + next.size / 2) / height;
  }

  function move(dx: number, dy: number) {
    if (!crop) return;

    const scale = stage / crop.size;

    settle(cx - dx / scale / width, cy - dy / scale / height);
  }

  function pointerDown(event: PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, cx, cy };
  }

  function pointerMove(event: PointerEvent) {
    if (!drag || !crop) return;

    const scale = stage / crop.size;

    settle(
      drag.cx - (event.clientX - drag.x) / scale / width,
      drag.cy - (event.clientY - drag.y) / scale / height
    );
  }

  function keyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step]
    };

    if (moves[event.key]) {
      event.preventDefault();
      move(...moves[event.key]);
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      zoom = Math.min(4, Math.max(1, zoom + (event.key === '-' ? -0.25 : 0.25)));
      settle();
    }
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    zoom = Math.min(4, Math.max(1, zoom - event.deltaY / 500));
    settle();
  }

  async function save() {
    if (!image || !crop) return;
    saving = true;
    error = '';
    try {
      const picture = await encodePicture(image, crop);

      if (!picture) {
        error = $t$('social.pictureUnsupported');
        return;
      }
      await uploadPicture(picture);
      dispatch('done');
    } catch (e) {
      error = $t$(hubErrorKey(e));
    } finally {
      saving = false;
    }
  }
</script>

<div class="picture-crop">
  <div class="picture-crop-edit">
    <!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-no-noninteractive-element-interactions -->
    <div
      class="picture-crop-stage"
      style:width="{stage}px"
      style:height="{stage}px"
      role="img"
      tabindex="0"
      aria-label={$t$('social.cropHint')}
      on:pointerdown={pointerDown}
      on:pointermove={pointerMove}
      on:pointerup={() => (drag = undefined)}
      on:pointercancel={() => (drag = undefined)}
      on:keydown={keyDown}
      on:wheel={wheel}
    >
      <img
        class="picture-crop-image"
        src={url}
        alt=""
        draggable="false"
        style={place(stage)}
        bind:this={image}
        on:load={loaded}
      />
      <span class="picture-crop-ring" aria-hidden="true" />
    </div>
    <label class="picture-crop-zoom">
      <span>{$t$('social.zoom')}</span>
      <input type="range" min="1" max="4" step="0.01" bind:value={zoom} on:input={() => settle()} />
    </label>
  </div>

  <div class="picture-crop-preview">
    <p class="picture-crop-label">{$t$('social.picturePreview')}</p>
    <div class="picture-crop-sizes">
      {#each previews as size}
        <span class="picture-crop-circle" style:width="{size}px" style:height="{size}px">
          <img src={url} alt="" draggable="false" style={place(size)} />
        </span>
      {/each}
      <!-- What friends see if it doesn't load: the preset -->
      <SocialAvatar {avatar} size={1.5} />
    </div>
    <div class="picture-crop-actions">
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={!crop || saving}
        on:click={save}>{$t$(saving ? 'social.pictureSaving' : 'social.savePicture')}</button
      >
      <button type="button" class="app-button app-button-quiet" on:click={() => dispatch('done')}
        >{$t$('social.cancel')}</button
      >
    </div>
    <p class="picture-crop-hint">{$t$('social.pictureReportNote')}</p>
    {#if error}<p class="picture-crop-error" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  .picture-crop {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
    margin-top: 1rem;
  }

  .picture-crop-edit,
  .picture-crop-preview {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .picture-crop-preview {
    max-width: 22rem;
  }

  .picture-crop-stage {
    position: relative;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-color);
    cursor: grab;
    touch-action: none;
  }

  .picture-crop-stage:active {
    cursor: grabbing;
  }

  .picture-crop-stage:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .picture-crop-stage img,
  .picture-crop-circle img {
    position: absolute;
    top: 0;
    left: 0;
    max-width: none;
    transform-origin: 0 0;
    user-select: none;
    pointer-events: none;
  }

  /* The circle the picture is shown in; outside it is dimmed */
  .picture-crop-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 999px var(--app-overlay-color);
    outline: 2px solid var(--background-color);
    outline-offset: -2px;
    pointer-events: none;
  }

  .picture-crop-zoom {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: var(--type-small);
    color: var(--app-muted-fg);
  }

  .picture-crop-zoom input {
    flex: 1;
    accent-color: var(--accent-color);
  }

  .picture-crop-label {
    font-size: var(--type-label);
    font-weight: 700;
  }

  .picture-crop-sizes {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
  }

  .picture-crop-circle {
    position: relative;
    flex: none;
    overflow: hidden;
    border-radius: 50%;
    background: var(--surface-color);
  }

  .picture-crop-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .picture-crop-hint {
    max-width: 30ch;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .picture-crop-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
