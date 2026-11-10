<script lang="ts">
  /**
   * The game overlay's page (desktop app only; apps/desktop/overlay.js opens it in a transparent
   * window over a game played natively). It shows the line /hook shows last (`postOverlayLine`,
   * a BroadcastChannel) in the text box area, in `.hook-text` for the built-in popup and Yomitan,
   * and tells main which parts take the mouse: the text's line boxes and the built-in popup, or
   * the whole window (`solid`) while the pointer is over a popup, and on X11 also over the text
   * while Yomitan is loaded (its popup sits in a closed shadow root, so it can't be measured and
   * would be clipped by the window's shape). Adjust mode (from /hook) moves and resizes the area.
   * Invisible mode draws the text transparent with no background, over the game's own: placed
   * from a read of the game's settled frame (`readVnScreen`, as /v does for VNBox), or flowing in
   * the area when the game is set to that, the read matches under half the line, or it can't run.
   */
  import LookupPopup from '$lib/components/dictionary/lookup-popup.svelte';
  import {
    desktopOverlay,
    overlayChannel,
    type OverlayArea,
    type OverlayState
  } from '$lib/data/vn/native-games';
  import type { VnOverlayLine } from '$lib/data/vn/vn';
  import { readVnScreen } from '$lib/data/vn/vn-ocr';
  import { onMount, tick } from 'svelte';

  const overlay = desktopOverlay();
  let text = $state('');
  let view = $state<OverlayState>();
  let area = $state<OverlayArea>({ x: 0.04, y: 0.68, w: 0.92, h: 0.28 });
  let textEl = $state<HTMLElement>();
  let root = $state<HTMLElement>();
  let popup = $state<LookupPopup>();
  let solid = false;
  let solidTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = '';
  let frame = 0;
  /** Invisible: the line's rows where the game drew it, in page pixels; none = the area's flow. */
  let rows = $state<VnOverlayLine[]>();
  let reads = 0;
  const invisible = $derived(view?.mode === 'invisible' && !view.editing);
  const screenPlaced = $derived(view?.mode === 'invisible' && view.place === 'screen');

  /**
   * The game's window once it stops changing (a typewriter finished), as /v's settledFrame:
   * quarter-size copies 200 ms apart until under 0.1% changed, at most 3 s.
   */
  async function settledFrame(read: number) {
    const thumb = document.createElement('canvas');
    const context = thumb.getContext('2d', { willReadFrequently: true })!;
    let before: Uint8ClampedArray | undefined;
    let shot: ImageBitmap | undefined;

    for (let waited = 0; waited < 3000; waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const png = read === reads ? await overlay?.frame() : undefined;
      shot?.close();
      shot = undefined;
      if (!png || read !== reads) return undefined;
      shot = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
      thumb.width = Math.max(1, Math.ceil(shot.width / 4));
      thumb.height = Math.max(1, Math.ceil(shot.height / 4));
      context.drawImage(shot, 0, 0, thumb.width, thumb.height);
      const now = context.getImageData(0, 0, thumb.width, thumb.height).data;
      let changed = 0;

      if (before?.length === now.length) {
        for (let i = 0; i < now.length; i += 4) {
          const diff = now[i] + now[i + 1] + now[i + 2] - before[i] - before[i + 1] - before[i + 2];
          if (diff > 72 || diff < -72) changed += 1;
        }
        if (changed <= now.length / 4000) break;
      }
      before = now;
    }
    return shot;
  }

  /** Invisible with screen placing: the line laid over the game's own glyphs. */
  async function place(line: string, wanted: boolean) {
    const read = (reads += 1);
    rows = undefined;
    if (!wanted || !line) return;
    try {
      const shot = await settledFrame(read);
      if (!shot) return;
      // The frame is the game's window, as this page is: one scale.
      const scale = window.innerWidth / shot.width;
      const result = await readVnScreen(shot, line);
      if (read !== reads || !result) return;
      rows = result.lines.map((row) => ({
        text: row.text,
        x: row.x * scale,
        y: row.y * scale,
        size: row.size * scale,
        pitch: row.pitch * scale
      }));
    } catch (error) {
      console.warn(`Overlay screen read: ${(error as Error).message}`);
    }
  }

  /** The page's own top-level element in body; any other is an extension's (Yomitan's popup). */
  const ownTop = () => root?.closest('body > *');
  const foreignTop = (element: Element | null) => {
    const top = element?.closest('body > *');
    return !!top && top !== ownTop() && top.tagName !== 'SCRIPT';
  };
  const hasYomitan = () => [...document.body.children].some((child) => foreignTop(child));

  function report() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const boxes = [...(root?.querySelectorAll('.hook-text span') ?? [])].flatMap((span) => [
        ...span.getClientRects()
      ]);
      const popup = document.querySelector('.ttu-dict')?.getBoundingClientRect();
      if (popup && popup.width > 0 && popup.height > 0) boxes.push(popup);
      const rects = boxes.map(({ x, y, width, height }) => ({ x, y, width, height }));
      const message = JSON.stringify([rects, solid]);
      if (message === lastSent) return;
      lastSent = message;
      overlay?.setRects(rects, solid);
    });
  }

  function setSolid(value: boolean) {
    clearTimeout(solidTimer);
    if (value) {
      if (!solid) {
        solid = true;
        report();
      }
      return;
    }
    // A short grace: the pointer crosses the gap between a word and its popup.
    if (solid)
      solidTimer = setTimeout(() => {
        solid = false;
        report();
      }, 300);
  }

  function onMove(event: MouseEvent) {
    if (view?.editing) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const overPopup = !!hit?.closest('.ttu-dict') || foreignTop(hit);
    const overText = !!hit?.closest('.hook-text');
    setSolid(overPopup || (view?.platform !== 'win32' && overText && hasYomitan()));
  }

  /** Adjust mode: dragging the frame moves the area, its corner handle resizes it. */
  function drag(event: PointerEvent, resize: boolean) {
    if ((event.target as Element).closest('button')) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, area: { ...area } };
    const { innerWidth: width, innerHeight: height } = window;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => {
      const dx = (moved.clientX - start.x) / width;
      const dy = (moved.clientY - start.y) / height;
      const from = start.area;
      area = resize
        ? {
            ...from,
            w: Math.min(1 - from.x, Math.max(0.05, from.w + dx)),
            h: Math.min(1 - from.y, Math.max(0.05, from.h + dy))
          }
        : {
            ...from,
            x: Math.min(1 - from.w, Math.max(0, from.x + dx)),
            y: Math.min(1 - from.h, Math.max(0, from.y + dy))
          };
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      overlay?.setArea($state.snapshot(area));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  $effect(() => {
    // Re-measured whenever the text, its look or the area change.
    void [text, rows, invisible, view?.fontSize, view?.opacity, area.x, area.y, area.w, area.h];
    tick().then(report);
  });

  $effect(() => {
    place(text, screenPlaced);
  });

  onMount(() => {
    const channel = new BroadcastChannel(overlayChannel);
    channel.onmessage = (event) => {
      if (typeof event.data?.text !== 'string' || event.data.text === text) return;
      // The game moved on; clicks on it never reach this page to close the popup.
      popup?.close();
      text = event.data.text;
    };
    // The line /hook shows now; otherwise this page stays empty until the next one.
    channel.postMessage({ ask: true });
    const off = overlay?.onState((state) => {
      view = state;
      area = state.area;
    });
    // The built-in popup opening, closing or moving.
    const observer = new MutationObserver(report);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    const resized = new ResizeObserver(report);
    if (textEl) resized.observe(textEl);
    document.addEventListener('mouseleave', () => setSolid(false));
    return () => {
      channel.close();
      off?.();
      observer.disconnect();
      resized.disconnect();
    };
  });
</script>

<svelte:head>
  <title>Overlay</title>
</svelte:head>

<!--
  The game switched windowed <-> fullscreen: the area's text moved without changing size (the
  shape would stay where it was), and the rows were for the old size.
-->
<svelte:window
  onmousemove={onMove}
  onresize={() => {
    // Main dropped its boxes with the old size: sent again even when they are the same.
    lastSent = '';
    report();
    if (rows) place(text, screenPlaced);
  }}
/>

<div class="ov-root" class:ov-invisible={invisible} bind:this={root}>
  {#if invisible && rows}
    <div class="hook-text ov-rows" lang="ja">
      {#each rows as row, index (index)}
        <span
          style:left="{row.x}px"
          style:top="{row.y}px"
          style:font-size="{row.size}px"
          style:letter-spacing="{row.pitch - row.size}px">{row.text}</span
        >
      {/each}
    </div>
  {/if}
  <div
    class="ov-area"
    class:ov-editing={view?.editing}
    hidden={invisible && !!rows}
    style:left="{area.x * 100}%"
    style:top="{area.y * 100}%"
    style:width="{area.w * 100}%"
    style:height="{area.h * 100}%"
    role="presentation"
    onpointerdown={(event) => view?.editing && drag(event, false)}
  >
    <p class="hook-text" lang="ja">
      <span
        bind:this={textEl}
        style:font-size="{view?.fontSize ?? 28}px"
        style:--ov-opacity="{Math.round((view?.opacity ?? 0.75) * 100)}%"
        >{text || (view?.editing ? 'テキストの場所' : '')}</span
      >
    </p>
    {#if view?.editing}
      <button
        type="button"
        class="app-button ov-done"
        onclick={() => overlay?.edit(false)}
        onpointerdown={(event) => event.stopPropagation()}>Done</button
      >
      <div
        class="ov-handle"
        role="presentation"
        aria-label="Resize"
        onpointerdown={(event) => {
          event.stopPropagation();
          drag(event, true);
        }}
      ></div>
    {/if}
  </div>
</div>

<LookupPopup bind:this={popup} scope=".hook-text" />

<style>
  :global(html),
  :global(body) {
    background: transparent !important;
    overflow: hidden;
  }

  .ov-root {
    position: fixed;
    inset: 0;
  }

  .ov-area {
    position: absolute;
    overflow: hidden;
  }

  .ov-editing {
    border: 2px dashed var(--app-progress-fill);
    background: color-mix(in srgb, var(--background-color) 30%, transparent);
    cursor: move;
  }

  .hook-text {
    margin: 0;
    padding: 0.5rem;
    line-height: 1.8;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .hook-text span {
    color: var(--font-color);
    background: color-mix(in srgb, var(--background-color) var(--ov-opacity), transparent);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    padding: 0 0.25em;
  }

  /* Invisible: only the game's own glyphs show; a lookup's popup still does. */
  .ov-invisible .hook-text span {
    color: transparent;
    background: none;
  }

  /* A lookup marks its word on the game's own glyphs; ours stay unseen. */
  .ov-invisible .hook-text span::selection {
    color: transparent;
    background: color-mix(in srgb, var(--app-progress-fill) 35%, transparent);
  }

  .ov-rows {
    padding: 0;
  }

  .ov-rows span {
    position: absolute;
    padding: 0;
    /* A cell per character: the UI font's kana are narrower than its kanji. */
    font-family: monospace;
    line-height: 1;
    white-space: pre;
  }

  .ov-done {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
  }

  .ov-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 1.25rem;
    height: 1.25rem;
    background: var(--app-progress-fill);
    cursor: nwse-resize;
  }
</style>
