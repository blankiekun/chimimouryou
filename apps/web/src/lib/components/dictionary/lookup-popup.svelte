<script lang="ts">
  /**
   * The built-in dictionary's lookup popup (lib/data/dictionary.ts) for a reader page, Yomitan's
   * behaviour with the app's look:
   * - Scanning: the host calls `tapAt` for taps (touch and pen inputs with "scan on tap"), and
   *   the mouse scans on its own with Yomitan's scanning inputs (default Shift + hover, or the
   *   modifier pressed while hovering). Only text inside `scope` (and the popup itself, for
   *   nested lookups) is scanned; the match is shown with the CSS Custom Highlight API, so the
   *   book's DOM is never changed. `attachFrame` adds a same-origin iframe (the VN player's
   *   text overlay, /v): its pointer and key events are listened to, and points over it are
   *   scanned in its document.
   * - Popup: near the word on larger screens (Yomitan's placement, app/popup-position.js); a
   *   sheet at the bottom on phones, or at the top when the word is down there.
   * - Nested lookups replace the content with a back button, up to the nesting depth.
   * Off while `builtInLookups$` is off. Not part of upstream.
   */
  import { faArrowLeft, faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    builtInLookups$,
    dictionaries$,
    loadYomitanOptions,
    lookup,
    profileOptions,
    refreshDictionaries,
    yomitanOptions$,
    type LookupResult
  } from '$lib/data/dictionary';
  import { playTermAudio, stopTermAudio } from '$lib/data/dictionary-audio';
  import { builtInPopupOpen$ } from '$lib/data/yomitan';
  import { setWordMarks } from '$lib/data/word-marks';
  import { setCssHighlight } from '$lib/functions/book-text/css-highlights';
  import {
    matchingInput,
    scanAt,
    scannedRange,
    type ScannedText
  } from '$lib/functions/dictionary/scan';
  import { hotkeyAction } from '$lib/functions/dictionary/hotkeys';
  import { t$ } from '$lib/i18n';
  import { getPosition } from '$lib/vendor/yomitan/app/popup-position';
  import {
    getActiveModifiers,
    getActiveModifiersAndButtons,
    getElementWritingMode
  } from '$lib/vendor/yomitan/dom/document-util';
  import { addScopeToCssLegacy } from '$lib/vendor/yomitan/core/utilities';
  import TermEntry from './term-entry.svelte';

  /** Selector of the elements whose text is scanned (e.g. `.book-content`) */
  export let scope: string;

  interface View {
    query: string;
    result: LookupResult;
  }

  const highlightName = 'ttu-lookup';
  const nestedHighlightName = 'ttu-lookup-nested';

  let popupEl: HTMLElement | undefined;
  let bodyEl: HTMLElement | undefined;
  let views: View[] = [];
  let index = -1;
  let selected = 0;
  /** Where the root match is, for placing the popup */
  let sourceRects: DOMRect[] = [];
  let writingMode: ReturnType<typeof getElementWritingMode> = 'horizontal-tb';
  let style = '';
  let sheetTop = false;
  let copied = '';
  let token = 0;
  let lastPointer: { x: number; y: number; type: string } | undefined;
  let lastScanKey = '';
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let frame: HTMLIFrameElement | undefined;
  let detachFrame = () => {};
  /** The window the root match is highlighted in */
  let highlightView: typeof globalThis = globalThis;

  $: profile = $yomitanOptions$ ? profileOptions($yomitanOptions$) : undefined;
  $: view = views[index] as View | undefined;
  /** Bindable: the popup is showing (the reader hides its toast meanwhile) */
  export let open = false;
  $: open = !!view && !!profile;
  $: builtInPopupOpen$.next(open);
  $: sheet =
    profile?.general.popupDisplayMode === 'full-width' ||
    (viewportWidth > 0 && viewportWidth < 640 && matchMedia('(pointer: coarse)').matches);
  $: dictionaryCss = profile
    ? [
        addScopeToCssLegacy(profile.general.customPopupCss, '.ttu-dict'),
        ...profile.dictionaries
          .filter(({ enabled, styles }) => enabled && styles)
          .map(({ name, styles }) =>
            addScopeToCssLegacy(
              styles ?? '',
              `.ttu-dict [data-dictionary="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
            )
          )
      ]
        .filter((css) => css.trim() && css.trim() !== '.ttu-dict {}')
        .join('\n')
    : '';

  $: if (!$builtInLookups$) close();

  onMount(() => {
    loadYomitanOptions()
      .then(() => refreshDictionaries())
      .catch(() => undefined);
  });

  onDestroy(() => {
    clearTimeout(hoverTimer);
    builtInPopupOpen$.next(false);
    detachFrame();
    setCssHighlight(highlightName, [], highlightView);
    setCssHighlight(highlightName, []);
    setCssHighlight(nestedHighlightName, []);
    stopTermAudio();
  });

  /**
   * A tap at the point: looks up the text there when a touch or pen input scans on tap.
   * True when there was text to scan, so the host leaves the tap alone (no page turn).
   */
  export function tapAt(x: number, y: number) {
    if (!profile || !$builtInLookups$) return false;
    const type = lastPointer?.type === 'pen' ? 'pen' : 'touch';
    if (lastPointer?.type === 'mouse') return false;
    const input = matchingInput(profile.scanning.inputs, type, []);
    if (!input?.options.scanOnTouchTap && !(type === 'pen' && input?.options.scanOnPenRelease)) {
      return false;
    }
    const at = pointAt(x, y);
    if (!inScope(at.doc.elementFromPoint(at.x, at.y))) return false;
    return searchAt(x, y, false);
  }

  /**
   * Scans a same-origin iframe too (loaded: call again after it navigates). Its text counts as
   * in scope; the host decides which taps there reach `tapAt`.
   */
  export function attachFrame(element: HTMLIFrameElement) {
    detachFrame();
    const view = element.contentWindow;
    if (!view) return;
    frame = element;
    const offset = () => element.getBoundingClientRect();
    const down = (event: PointerEvent) => {
      const { left, top } = offset();
      pointerDown(event.clientX + left, event.clientY + top, event.pointerType, event.target);
    };
    const move = (event: PointerEvent) => {
      const { left, top } = offset();
      pointerMove(
        event.clientX + left,
        event.clientY + top,
        event.pointerType,
        event.target,
        getActiveModifiersAndButtons(event)
      );
    };
    view.addEventListener('pointerdown', down, true);
    view.addEventListener('pointermove', move);
    view.addEventListener('keydown', onKeydown, true);
    detachFrame = () => {
      view.removeEventListener('pointerdown', down, true);
      view.removeEventListener('pointermove', move);
      view.removeEventListener('keydown', onKeydown, true);
      frame = undefined;
      detachFrame = () => {};
    };
  }

  /** The document under a viewport point, and the point in it (an attached iframe's, if over it). */
  function pointAt(x: number, y: number) {
    const doc = frame?.contentDocument;
    if (frame && doc) {
      const { left, top, right, bottom } = frame.getBoundingClientRect();
      if (x >= left && x < right && y >= top && y < bottom) {
        return { doc, x: x - left, y: y - top, left, top };
      }
    }
    return { doc: document, x, y, left: 0, top: 0 };
  }

  // Elements from an iframe aren't `instanceof Element` here.
  const isElement = (target: unknown): target is Element =>
    !!target && (target as Node).nodeType === Node.ELEMENT_NODE;

  function inScope(target: unknown) {
    if (!isElement(target)) return false;
    return !!target.closest(scope) || (!!frame && target.ownerDocument === frame.contentDocument);
  }

  export function close() {
    token++;
    views = [];
    index = -1;
    lastScanKey = '';
    setCssHighlight(highlightName, [], highlightView);
    setCssHighlight(nestedHighlightName, []);
    stopTermAudio();
  }

  function searchAt(x: number, y: number, nested: boolean) {
    if (!profile) return false;
    const at = pointAt(x, y);
    const scan = scanAt(at.x, at.y, profile.scanning, at.doc);
    if (!scan) return false;
    const key = `${nested}:${scan.text}`;
    if (key === lastScanKey && open) return true;
    lastScanKey = key;
    run(scan, nested, at);
    return true;
  }

  async function run(scan: ScannedText, nested: boolean, at: { left: number; top: number }) {
    if (!profile) return;
    const current = ++token;
    let result: LookupResult;
    try {
      result = await lookup(scan.text);
    } catch {
      return;
    }
    if (current !== token) return;
    if (!result.dictionaryEntries.length) {
      if (!nested && profile.scanning.autoHideResults) close();
      return;
    }
    const range = scannedRange(scan, result.originalTextLength, profile.scanning.layoutAwareScan);
    const nextView = { query: range.toString(), result };
    if (nested) {
      setCssHighlight(nestedHighlightName, [range]);
      views = [...views.slice(0, index + 1), nextView];
    } else {
      setCssHighlight(highlightName, [], highlightView);
      highlightView = range.startContainer.ownerDocument?.defaultView ?? globalThis;
      setCssHighlight(highlightName, [range], highlightView);
      setCssHighlight(nestedHighlightName, []);
      sourceRects = [...range.getClientRects()].map(
        ({ x, y, width, height }) => new DOMRect(x + at.left, y + at.top, width, height)
      );
      const element = range.startContainer.parentElement;
      writingMode = getElementWritingMode(element);
      views = [nextView];
    }
    index = views.length - 1;
    selected = 0;
    await tick();
    bodyEl?.scrollTo({ top: 0 });
    place();
    if (profile.audio.enabled && profile.audio.autoPlay) playFirst();
  }

  async function lookupQuery(query: string) {
    if (!profile || !canNest()) return;
    const current = ++token;
    const result = await lookup(query).catch(() => undefined);
    if (current !== token || !result?.dictionaryEntries.length) return;
    views = [...views.slice(0, index + 1), { query, result }];
    index = views.length - 1;
    selected = 0;
    await tick();
    bodyEl?.scrollTo({ top: 0 });
  }

  const canNest = () => !!profile && index < profile.scanning.popupNestingMaxDepth;

  function place() {
    if (!profile || !open) return;
    const { general } = profile;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    if (sheet) {
      // Full-width (Yomitan's popupDisplayMode), at its side unless the word is there.
      const sheetHeight = Math.round(height * 0.45);
      const word = sourceRects[0];
      const wordTop = word ? word.top - top : 0;
      const wordBottom = word ? word.bottom - top : 0;
      const preferTop = general.popupFullWidthPosition === 'top';
      const coversTop = wordTop < sheetHeight;
      const coversBottom = wordBottom > height - sheetHeight;
      sheetTop = preferTop ? !coversTop || coversBottom : coversBottom && !coversTop;
      style = `left:${left}px;width:${width}px;height:${sheetHeight}px;${
        sheetTop ? `top:${top}px` : `top:${top + height - sheetHeight}px`
      }`;
      return;
    }
    const scale = general.popupScalingFactor || 1;
    const rect = getPosition(
      sourceRects.map(({ left: l, top: t, right, bottom }) => ({ left: l, top: t, right, bottom })),
      writingMode,
      { left, top, right: left + width, bottom: top + height },
      {
        width: general.popupWidth * scale,
        height: general.popupHeight * scale,
        horizontalOffset: general.popupHorizontalOffset * scale,
        verticalOffset: general.popupVerticalOffset * scale,
        horizontalOffset2: general.popupHorizontalOffset2 * scale,
        verticalOffset2: general.popupVerticalOffset2 * scale,
        horizontalTextPositionBelow: general.popupHorizontalTextPosition === 'below',
        verticalTextPosition: general.popupVerticalTextPosition
      }
    );
    style = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  }

  function playFirst() {
    const entry = view?.result.dictionaryEntries[selected];
    const headword = entry?.headwords[0];
    if (profile && headword) playTermAudio(headword.term, headword.reading, profile.audio);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = text;
      setTimeout(() => copied === text && (copied = ''), 1500);
    } catch {
      // no clipboard (http): nothing to do
    }
  }

  function selectEntry(next: number) {
    const count = view?.result.dictionaryEntries.length ?? 0;
    if (!count) return;
    selected = Math.max(0, Math.min(count - 1, next));
    bodyEl
      ?.querySelectorAll('.entry')
      [selected]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function go(by: -1 | 1) {
    const next = index + by;
    if (next < 0 || next >= views.length) return;
    index = next;
    selected = 0;
    if (index === 0) setCssHighlight(nestedHighlightName, []);
  }

  // Input

  function inPopup(target: EventTarget | null) {
    return target instanceof Node && !!popupEl?.contains(target);
  }

  const onPointerDown = (event: PointerEvent) =>
    pointerDown(event.clientX, event.clientY, event.pointerType, event.target);

  const onPointerMove = (event: PointerEvent) =>
    pointerMove(
      event.clientX,
      event.clientY,
      event.pointerType,
      event.target,
      getActiveModifiersAndButtons(event)
    );

  function pointerDown(x: number, y: number, type: string, target: EventTarget | null) {
    lastPointer = { x, y, type };
    if (open && !inPopup(target)) close();
  }

  function pointerMove(
    x: number,
    y: number,
    type: string,
    target: EventTarget | null,
    modifiers: string[]
  ) {
    lastPointer = { x, y, type };
    if (type === 'touch') return;
    scanHover(x, y, target, modifiers);
  }

  function scanHover(x: number, y: number, target: EventTarget | null, modifiers: string[]) {
    if (!profile || !$builtInLookups$ || !isElement(target)) return;
    const nested = inPopup(target);
    if (!nested && !inScope(target)) return;
    if (nested && (!canNest() || target.closest('a, button, summary'))) return;
    const type = lastPointer?.type === 'pen' ? 'pen' : 'mouse';
    const input = matchingInput(profile.scanning.inputs, type, modifiers);
    if (
      !input ||
      (type === 'pen' && !input.options.scanOnPenMove && !input.options.scanOnPenHover)
    ) {
      return;
    }
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => searchAt(x, y, nested), profile.scanning.delay);
  }

  function onKeydown(event: KeyboardEvent) {
    if (!profile || !$builtInLookups$) return;
    if (open) {
      const action = hotkeyAction(profile.inputs.hotkeys, event);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        runAction(action.action, action.argument);
        return;
      }
    }
    // The modifier pressed while the pointer rests on text (scanWithoutMousemove).
    if (profile.scanning.scanWithoutMousemove && lastPointer && lastPointer.type !== 'touch') {
      const at = pointAt(lastPointer.x, lastPointer.y);
      const target = at.doc.elementFromPoint(at.x, at.y);
      scanHover(lastPointer.x, lastPointer.y, target, getActiveModifiers(event));
    }
  }

  function runAction(action: string, argument: string) {
    const count = Number.parseInt(argument, 10) || 1;
    switch (action) {
      case 'close':
        return close();
      case 'previousEntry':
        return selectEntry(selected - count);
      case 'nextEntry':
        return selectEntry(selected + count);
      case 'firstEntry':
        return selectEntry(0);
      case 'lastEntry':
        return selectEntry(Number.MAX_SAFE_INTEGER);
      case 'historyBackward':
        return go(-1);
      case 'historyForward':
        return go(1);
      case 'playAudio':
        return playFirst();
    }
  }

  /** The dictionaries' own styles and the custom popup CSS, as text in a style element (no markup). */
  function styleSheet(node: HTMLElement, css: string) {
    const element = document.createElement('style');
    element.textContent = css;
    node.prepend(element);
    return {
      update: (next: string) => (element.textContent = next),
      destroy: () => element.remove()
    };
  }

  /** Taps inside the popup look the word under them up (nested), outside links and buttons. */
  function onPopupClick(event: MouseEvent) {
    if (lastPointer?.type === 'mouse' || !canNest()) return;
    if (!(event.target instanceof Element) || event.target.closest('a, button, summary')) return;
    if (!event.target.closest('.definition-list')) return;
    searchAt(event.clientX, event.clientY, true);
  }
</script>

<svelte:window
  on:pointerdown|capture={onPointerDown}
  on:pointermove={onPointerMove}
  on:keydown|capture={onKeydown}
  on:resize={place}
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
/>

{#if open && view && profile}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <section
    bind:this={popupEl}
    class="ttu-dict writing-horizontal-tb"
    class:sheet
    class:sheet-top={sheet && sheetTop}
    {style}
    style:--dict-font-size="{profile.general.fontSize}px"
    style:--dict-line-height={profile.general.lineHeight}
    role="dialog"
    aria-label={$t$('lookup.title', { query: view.query })}
    on:click={onPopupClick}
    use:styleSheet={dictionaryCss}
  >
    <div class="dict-bar">
      {#if views.length > 1}
        <button
          type="button"
          class="dict-icon"
          aria-label={$t$('lookup.back')}
          title={$t$('lookup.back')}
          disabled={index === 0}
          on:click={() => go(-1)}
        >
          <Fa icon={faArrowLeft} />
        </button>
        <button
          type="button"
          class="dict-icon"
          aria-label={$t$('lookup.forward')}
          title={$t$('lookup.forward')}
          disabled={index === views.length - 1}
          on:click={() => go(1)}
        >
          <Fa icon={faArrowRight} />
        </button>
      {/if}
      <span class="dict-query" lang="ja">{view.query}</span>
      {#if copied}<span class="dict-copied" role="status">{$t$('lookup.copied')}</span>{/if}
      <button
        type="button"
        class="dict-icon"
        aria-label={$t$('lookup.close')}
        title={$t$('lookup.close')}
        on:click={close}
      >
        <Fa icon={faXmark} />
      </button>
    </div>
    <div class="dict-body" bind:this={bodyEl}>
      {#each view.result.dictionaryEntries as entry, entryIndex}
        <TermEntry
          {entry}
          options={profile}
          summaries={$dictionaries$}
          current={entryIndex === selected && view.result.dictionaryEntries.length > 1}
          audio={profile.audio.enabled}
          on:lookup={({ detail }) => lookupQuery(detail)}
          on:audio={({ detail }) =>
            profile && playTermAudio(detail.term, detail.reading, profile.audio)}
          on:copy={({ detail }) => copy(detail)}
          on:markKnown={({ detail }) => setWordMarks([[detail, null]], 'known')}
        />
      {/each}
    </div>
  </section>
{/if}

<style lang="scss">
  .ttu-dict {
    position: fixed;
    z-index: 70;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 24%, transparent);
    border-top: 2px solid var(--reader-panel-fg);
    border-radius: 2px;
    background: var(--reader-panel-bg);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--dict-font-size, 14px);
    line-height: var(--dict-line-height, 1.5);
  }

  .ttu-dict.sheet {
    border-right: 0;
    border-left: 0;
    border-bottom: 0;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .ttu-dict.sheet-top {
    border-top: 0;
    border-bottom: 2px solid var(--reader-panel-fg);
    padding-top: env(safe-area-inset-top);
    padding-bottom: 0;
  }

  .dict-bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.25rem 0.25rem 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .dict-query {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dict-copied {
    color: var(--accent-strong-color);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .dict-icon {
    display: inline-flex;
    width: 2.25rem;
    height: 2.25rem;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    color: var(--app-muted-fg);
  }

  .dict-icon:hover:not(:disabled) {
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
    color: var(--reader-panel-fg);
  }

  .dict-icon:disabled {
    opacity: 0.4;
  }

  .dict-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 0.75rem;
  }

  /* The entries (term-entry.svelte), in Yomitan's class names so its custom CSS still applies */
  .ttu-dict :global(.entry) {
    position: relative;
    padding: 0.75rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .ttu-dict :global(.entry:last-child) {
    border-bottom: 0;
  }

  .ttu-dict :global(.entry.current)::before {
    content: '';
    position: absolute;
    top: 0.75rem;
    bottom: 0.75rem;
    left: -0.75rem;
    width: 3px;
    background: var(--accent-color);
  }

  .ttu-dict :global(.entry-head) {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ttu-dict :global(.headword-list) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    min-width: 0;
  }

  .ttu-dict :global(.headword) {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .ttu-dict :global(.headword-term) {
    font-size: 1.75em;
    line-height: 1.3;
  }

  .ttu-dict :global(.headword-term rt) {
    font-size: 0.45em;
    color: var(--app-muted-fg);
  }

  .ttu-dict :global(.headword + .headword .headword-term) {
    font-size: 1.25em;
  }

  .ttu-dict :global(.headword-reading) {
    color: var(--app-muted-fg);
    font-size: 1.1em;
  }

  .ttu-dict :global(.entry-actions) {
    display: flex;
    flex: 0 0 auto;
    gap: 0.125rem;
  }

  .ttu-dict :global(.entry-action) {
    display: inline-flex;
    min-width: 2.25rem;
    height: 2.25rem;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0 0.5rem;
    border-radius: 2px;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .ttu-dict :global(.entry-action:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
    color: var(--reader-panel-fg);
  }

  .ttu-dict :global(.entry-known) {
    color: var(--accent-strong-color);
  }

  .ttu-dict :global(.entry-known:disabled) {
    color: var(--app-muted-fg);
  }

  @media (max-width: 639px) {
    .ttu-dict :global(.entry-known span) {
      display: none;
    }
  }

  .ttu-dict :global(.inflection-rule-chain) {
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .ttu-dict :global(.inflection-rule-chain)::before {
    content: '« ';
  }

  .ttu-dict :global(.inflection + .inflection)::before {
    content: ' « ';
  }

  .ttu-dict :global(.tag-list),
  .ttu-dict :global(.definition-tags) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.4rem;
  }

  .ttu-dict :global(.tag) {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 30%, transparent);
    border-radius: 2px;
    padding: 0 0.35rem;
    color: var(--reader-panel-fg);
    font-size: var(--type-label);
    font-weight: 700;
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
    cursor: default;
  }

  .ttu-dict :global(.tag[data-category='dictionary']) {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .ttu-dict :global(.tag[data-category='frequent']),
  .ttu-dict :global(.tag[data-category='popular']) {
    border-color: var(--accent-color);
    color: var(--accent-strong-color);
  }

  .ttu-dict :global(.tag-frequency) {
    padding: 0;
  }

  .ttu-dict :global(.tag-frequency .tag-label) {
    padding: 0 0.35rem;
    background: color-mix(in srgb, var(--reader-panel-fg) 10%, transparent);
  }

  .ttu-dict :global(.tag-frequency .tag-body) {
    padding: 0 0.35rem;
  }

  .ttu-dict :global(.frequency-disambiguation) {
    margin-right: 0.25rem;
    font-weight: 400;
  }

  .ttu-dict :global(.frequency-list),
  .ttu-dict :global(.pronunciation-group-list) {
    margin-top: 0.4rem;
    font-size: var(--type-small);
  }

  .ttu-dict :global(.frequency-dictionary) {
    margin-right: 0.5rem;
    color: var(--app-muted-fg);
    font-weight: 700;
  }

  .ttu-dict :global(.pronunciation-group) {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }

  .ttu-dict :global(.pronunciation-list) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
  }

  .ttu-dict :global(.pronunciation) {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 1.15em;
  }

  .ttu-dict :global(.pronunciation-disambiguation) {
    color: var(--app-muted-fg);
    font-size: 0.85em;
  }

  /* Yomitan's display-pronunciation.css */
  .ttu-dict :global(.pronunciation-mora) {
    display: inline-block;
    position: relative;
  }

  .ttu-dict :global(.pronunciation-mora[data-pitch='high'] > .pronunciation-mora-line) {
    display: block;
    position: absolute;
    top: 0.1em;
    left: 0;
    right: 0;
    height: 0;
    border-top: 0.1em solid currentColor;
    pointer-events: none;
    user-select: none;
  }

  .ttu-dict
    :global(
      .pronunciation-mora[data-pitch='high'][data-pitch-next='low'] > .pronunciation-mora-line
    ) {
    right: -0.1em;
    height: 0.4em;
    border-right: 0.1em solid currentColor;
  }

  .ttu-dict :global(.pronunciation-mora[data-pitch='high'][data-pitch-next='low']) {
    padding-right: 0.1em;
    margin-right: 0.1em;
  }

  .ttu-dict :global(.pronunciation-character-group) {
    display: inline-block;
    position: relative;
  }

  .ttu-dict :global(.pronunciation-devoice-indicator) {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 1.125em;
    height: 1.125em;
    border: 1px dotted var(--app-danger-color);
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  .ttu-dict :global(.pronunciation-nasal-indicator) {
    position: absolute;
    top: 0.125em;
    right: -0.125em;
    width: 0.375em;
    height: 0.375em;
    border: 1px solid var(--app-danger-color);
    border-radius: 50%;
  }

  .ttu-dict :global(.pronunciation-nasal-diacritic) {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
  }

  .ttu-dict :global(.pronunciation-downstep-notation) {
    color: var(--app-muted-fg);
    font-size: 0.85em;
  }

  .ttu-dict :global(.pronunciation-graph) {
    display: inline-block;
    height: 1.5em;
    vertical-align: middle;
  }

  .ttu-dict :global(.pronunciation-graph-line),
  .ttu-dict :global(.pronunciation-graph-line-tail),
  .ttu-dict :global(.pronunciation-graph-dot-downstep1),
  .ttu-dict :global(.pronunciation-graph-triangle) {
    fill: none;
    stroke: currentColor;
    stroke-width: 5;
  }

  .ttu-dict :global(.pronunciation-graph-line-tail) {
    stroke-dasharray: 5 5;
  }

  .ttu-dict :global(.pronunciation-graph-dot) {
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 5;
  }

  .ttu-dict :global(.pronunciation-graph-dot-downstep2) {
    fill: currentColor;
  }

  .ttu-dict :global(.definition-list) {
    margin-top: 0.5rem;
    padding-left: 1.5em;
    list-style: decimal;
  }

  .ttu-dict :global(.definition-list.single) {
    padding-left: 0;
    list-style: none;
  }

  .ttu-dict :global(.definition-item + .definition-item) {
    margin-top: 0.6rem;
  }

  .ttu-dict :global(.definition-item::marker) {
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .ttu-dict :global(.definition-only) {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .ttu-dict :global(.definition-only::before) {
    content: '(';
  }

  .ttu-dict :global(.definition-only::after) {
    content: ' only)';
  }

  .ttu-dict :global(.gloss-list) {
    margin-top: 0.25rem;
    padding-left: 1.1em;
    list-style: disc;
  }

  .ttu-dict :global(.gloss-list.compact) {
    padding-left: 0;
    list-style: none;
  }

  .ttu-dict :global(.gloss-list.compact .gloss-item) {
    display: inline;
  }

  .ttu-dict :global(.gloss-list.compact .gloss-item + .gloss-item)::before {
    content: ' | ';
    color: var(--app-muted-fg);
  }

  .ttu-dict :global(.gloss-item:only-child) {
    list-style: none;
  }

  .ttu-dict :global(details > summary) {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    cursor: pointer;
  }

  /* Yomitan's structured-content.css */
  .ttu-dict :global(.gloss-link) {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .ttu-dict :global(.gloss-image-link) {
    display: inline-block;
    position: relative;
    max-width: 100%;
    line-height: 1;
    vertical-align: top;
  }

  .ttu-dict :global(.gloss-image-container) {
    display: inline-block;
    position: relative;
    max-width: 100%;
    overflow: hidden;
    line-height: 0;
    vertical-align: top;
    white-space: nowrap;
  }

  .ttu-dict :global(.gloss-image-sizer) {
    display: inline-block;
    width: 0;
    font-size: 0;
    vertical-align: top;
  }

  .ttu-dict :global(.gloss-image) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .ttu-dict :global(.gloss-image-background),
  .ttu-dict :global(.gloss-image-link-text) {
    display: none;
  }

  .ttu-dict :global(.gloss-image-link[data-appearance='monochrome'] .gloss-image) {
    filter: grayscale(1);
  }

  .ttu-dict :global(.gloss-image-link[data-collapsed='true'] .gloss-image-container) {
    display: none;
  }

  .ttu-dict :global(.gloss-image-link[data-collapsed='true'] .gloss-image-link-text) {
    display: inline;
    color: var(--accent-strong-color);
  }

  .ttu-dict :global(.gloss-image-description) {
    display: block;
    white-space: pre-line;
  }

  .ttu-dict :global(.gloss-sc-table) {
    border-collapse: collapse;
    table-layout: auto;
  }

  .ttu-dict :global(.gloss-sc-th),
  .ttu-dict :global(.gloss-sc-td) {
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 24%, transparent);
    padding: 0.25em;
    vertical-align: top;
  }

  .ttu-dict :global(.gloss-sc-th),
  .ttu-dict :global(.gloss-sc-thead),
  .ttu-dict :global(.gloss-sc-tfoot) {
    background: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);
    font-weight: 700;
  }

  .ttu-dict :global(.gloss-sc-ol),
  .ttu-dict :global(.gloss-sc-ul) {
    padding-left: 1.4em;
  }

  .ttu-dict :global(.gloss-sc-ol) {
    list-style: decimal;
  }

  .ttu-dict :global(.gloss-sc-ul) {
    list-style: disc;
  }

  .ttu-dict :global(.gloss-sc-details) {
    padding-left: 1em;
  }
</style>
