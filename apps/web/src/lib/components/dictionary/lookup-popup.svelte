<script lang="ts">
  /**
   * The built-in dictionary's lookup popup (lib/data/dictionary/dictionary.ts) for a reader page, Yomitan's
   * behaviour with the app's look:
   * - Scanning: Yomitan's scanning inputs (`ScanInput`, functions/dictionary/scan.ts) read the
   *   window's pointer, touch, pen, mouse button and key events: hover with a modifier or mouse
   *   button, touch press/move/release, pen press/move/hover/release. Taps are the host's: it
   *   calls `tapAt` for each tap it would otherwise use (true = a scan took it, so no page turn),
   *   and checks `lookupClaimsGesture()` (yomitan.ts) before a swipe or pan. Only text inside
   *   `scope` (and the popup itself, for nested lookups) is scanned; the match is shown with the
   *   CSS Custom Highlight API and, with selectText, selected (the reader ignores that selection:
   *   `isLookupSelection`). `attachFrame` adds a same-origin iframe (the VN player's text
   *   overlay, /v): its events are fed in too, and points over it scanned in its document.
   * - Popup: near the word on larger screens (Yomitan's placement, app/popup-position.js); a
   *   sheet at the bottom on phones, or at the top when the word is down there. Scaled as
   *   Frontend._updateContentScale does (page zoom, pinch zoom).
   * - Nested lookups replace the content with Back/Forward, up to the nesting depth.
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
    noDictionaryNoteSeen$,
    profileOptions,
    refreshDictionaries,
    yomitanOptions$,
    type LookupResult
  } from '$lib/data/dictionary/dictionary';
  import { playTermAudio, stopTermAudio } from '$lib/data/dictionary/dictionary-audio';
  import {
    builtInPopupOpen$,
    setGestureClaimed,
    setLookupSelection
  } from '$lib/data/dictionary/yomitan';
  import { setWordMarks } from '$lib/data/words/word-marks';
  import { setCssHighlight } from '$lib/functions/book-text/css-highlights';
  import {
    ScanInput,
    scanAt,
    scannedRange,
    scannedSentence,
    scanSelection,
    type PointerKind,
    type ScanInputInfo,
    type ScannedText
  } from '$lib/functions/dictionary/scan';
  import { hotkeyAction } from '$lib/functions/dictionary/hotkeys';
  import { t$ } from '$lib/i18n';
  import { getPosition } from '$lib/vendor/yomitan/app/popup-position';
  import { getElementWritingMode } from '$lib/vendor/yomitan/dom/document-util';
  import { addScopeToCssLegacy } from '$lib/vendor/yomitan/core/utilities';
  import TermEntry from './term-entry.svelte';
  import KanjiEntry from './kanji-entry.svelte';
  import InstallDictionary from './install-dictionary.svelte';
  import Toast from '$lib/components/toast.svelte';
  import { pagePath } from '$lib/data/env';
  import type { ScreenshotSource } from '$lib/data/dictionary/anki-dictionary';

  /** Selector of the elements whose text is scanned (e.g. `.book-content`) */
  export let scope: string;
  /** What Add to Anki's {screenshot} takes (the game frame, the manga page); none: empty */
  export let screenshot: ScreenshotSource | undefined = undefined;

  interface View {
    query: string;
    result: LookupResult;
    /** The text scanned and the sentence around the match, for Add to Anki */
    fullQuery: string;
    sentence: { text: string; offset: number };
  }

  const highlightName = 'ttu-lookup';
  const nestedHighlightName = 'ttu-lookup-nested';
  // shortcut: a browser can't read its page zoom, so it is taken as devicePixelRatio against its
  // value when the page loaded (wrong if the page loaded zoomed or moves to a screen of another
  // density); the desktop app reads the exact factor (preload.cjs zoomFactor).
  const loadPixelRatio = globalThis.devicePixelRatio || 1;

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
  let viewportWidth = 0;
  let viewportHeight = 0;
  let contentScale = 1;
  let frame: HTMLIFrameElement | undefined;
  let detachFrame = () => {};
  /** The window the root match is highlighted in */
  let highlightView: typeof globalThis = globalThis;
  /** The installed dictionaries are known (refreshDictionaries) */
  let listed = false;
  /** The one-time note after a lookup with no dictionary to look in */
  let emptyNote = false;
  /** The last addNote / viewNotes shortcut, for the selected entry's Anki buttons */
  let ankiCommand: { action: string; argument: string; id: number } | undefined;
  /** The element of the root match (the manga page's text block, for {screenshot}) */
  let matchElement: Element | null = null;
  const takeScreenshot = () => screenshot?.(matchElement) ?? null;
  $: entryScreenshot = screenshot ? takeScreenshot : undefined;
  /** autoHideResults (hideDelay) and hidePopupOnCursorExit (its delay) */
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerOverPopup = false;
  /** selectText: the match selected, and the selection it replaced (scanSelectedText restores it) */
  let selection: { doc: Document; range: Range; restore: Range[] } | undefined;
  /** The reader selected nothing themselves (TextScanner._userHasNotSelectedAnythingManually) */
  let userSelectionEmpty = true;
  let changingSelection = false;
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;

  $: profile = $yomitanOptions$ ? profileOptions($yomitanOptions$) : undefined;
  $: view = views[index] as View | undefined;
  $: many = (view?.result.dictionaryEntries.length ?? 0) > 1;
  // A shortcut acts once, on the entry selected when it was pressed.
  $: (selected, view, (ankiCommand = undefined));
  $: ankiContext = view && {
    url: location.href,
    documentTitle: document.title,
    query: view.query,
    fullQuery: view.fullQuery,
    sentence: view.sentence
  };
  // Nothing to look in: taps pass through (page turns, manga and VN taps) instead of finding nothing.
  $: noDictionary = listed && !!profile && !profile.dictionaries.some(({ enabled }) => enabled);
  /** Bindable: the popup is showing (the reader hides its toast meanwhile) */
  export let open = false;
  $: open = !!view && !!profile;
  $: builtInPopupOpen$.next(open);
  $: sheet =
    profile?.general.popupDisplayMode === 'full-width' ||
    (viewportWidth > 0 && viewportWidth < 640 && matchMedia('(pointer: coarse)').matches);
  $: actionBarAlways = profile?.general.popupActionBarVisibility === 'always';
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

  const scanner = new ScanInput({
    options: () => ($builtInLookups$ ? profile?.scanning : undefined),
    search: (x, y, info) => searchAt(x, y, info),
    current: () => (open ? lastScanKey : null),
    clear: () => close(),
    inPopup: (target) => inPopup(target)
  });

  function onScanEvent(event: Event) {
    if (event.type === 'pointerdown') pointerDown(event as PointerEvent);
    scanner.handle(event);
  }

  onMount(() => {
    loadYomitanOptions()
      .then(() => refreshDictionaries())
      .then(() => (listed = true))
      .catch(() => undefined);
    setGestureClaimed(() => scanner.claimed);
    for (const type of ScanInput.eventTypes) {
      addEventListener(type, onScanEvent, { capture: true, passive: false });
    }
    document.addEventListener('selectionchange', onSelectionChange);
    globalThis.visualViewport?.addEventListener('resize', place);
    return () => {
      for (const type of ScanInput.eventTypes) {
        removeEventListener(type, onScanEvent, { capture: true });
      }
      document.removeEventListener('selectionchange', onSelectionChange);
      globalThis.visualViewport?.removeEventListener('resize', place);
    };
  });

  onDestroy(() => {
    clearTimeout(hideTimer);
    builtInPopupOpen$.next(false);
    setGestureClaimed(() => false);
    detachFrame();
    deselect();
    setCssHighlight(highlightName, [], highlightView);
    setCssHighlight(highlightName, []);
    setCssHighlight(nestedHighlightName, []);
    stopTermAudio();
  });

  /**
   * A tap the host would otherwise use (page turn, menu, the game's tap). True when a scan
   * takes it: this touch or pen gesture already found a word (press, move, release), or a touch
   * input scans on tap and there is text here.
   */
  export function tapAt(x: number, y: number) {
    if (!profile || !$builtInLookups$) return false;
    if (scanner.claimed) return true;
    if (lastPointer?.type !== 'touch') return false;
    const input = scanner.tapInput(x, y);
    if (!input) return false;
    const at = pointAt(x, y);
    if (!inScope(at.doc.elementFromPoint(at.x, at.y))) return false;
    return scanTap(x, y, input, false);
  }

  /** A tap's lookup: true when there is text to look up (the lookup itself runs on). */
  function scanTap(x: number, y: number, input: ScanInputInfo['input'], nested: boolean) {
    return !!scanPoint(x, y, nested, { input, pointerType: 'touch', passive: false });
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
    const listener = (event: Event) => {
      const { left, top } = element.getBoundingClientRect();
      if (event.type === 'pointerdown') {
        const e = event as PointerEvent;
        pointerDown(e, e.clientX + left, e.clientY + top);
      }
      if (event.type === 'keydown') onKeydown(event as KeyboardEvent);
      scanner.handle(event, left, top);
    };
    for (const type of ScanInput.eventTypes) {
      view.addEventListener(type, listener, { capture: true, passive: false });
    }
    view.document.addEventListener('selectionchange', onSelectionChange);
    detachFrame = () => {
      for (const type of ScanInput.eventTypes) {
        view.removeEventListener(type, listener, { capture: true });
      }
      view.document.removeEventListener('selectionchange', onSelectionChange);
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
    clearTimeout(hideTimer);
    views = [];
    index = -1;
    lastScanKey = '';
    pointerOverPopup = false;
    deselect();
    setCssHighlight(highlightName, [], highlightView);
    setCssHighlight(nestedHighlightName, []);
    stopTermAudio();
  }

  const nodeIds = new WeakMap<Node, number>();
  let nextNodeId = 0;

  /** Where a scan starts and its text (TextSource.hasSameStart): the same words elsewhere differ. */
  function scanKey(nested: boolean, { node, offset, text }: ScannedText) {
    if (!nodeIds.has(node)) nodeIds.set(node, (nextNodeId += 1));
    return `${nested}:${nodeIds.get(node)}:${offset}:${text}`;
  }

  /** The scanning input's search: the text at the point, root or nested by where it is. */
  function searchAt(x: number, y: number, info: ScanInputInfo) {
    if (!profile || !$builtInLookups$) return undefined;
    const at = pointAt(x, y);
    const target = at.doc.elementFromPoint(at.x, at.y);
    const nested = inPopup(target);
    if (nested ? !canNest() : !inScope(target)) {
      if (!nested) emptied();
      return undefined;
    }
    return scanPoint(x, y, nested, info);
  }

  /**
   * Scans at the point and looks the text up: undefined when there is no text there (or no
   * dictionary), else the lookup's promise.
   */
  function scanPoint(x: number, y: number, nested: boolean, info: ScanInputInfo) {
    if (!profile) return undefined;
    const at = pointAt(x, y);
    const scan = scanAt(
      at.x,
      at.y,
      profile.scanning,
      at.doc,
      nested ? popupExclude(info.pointerType) : ''
    );
    if (!scan) {
      if (!nested) emptied();
      return undefined;
    }
    if (noDictionary && !nested) {
      if (!$noDictionaryNoteSeen$) {
        emptyNote = true;
        noDictionaryNoteSeen$.next(true);
      }
      return undefined;
    }
    const key = scanKey(nested, scan);
    if (key === lastScanKey && open) return Promise.resolve();
    lastScanKey = key;
    return run(scan, nested, at, info.input.options);
  }

  /**
   * What isn't scanned in the popup (Frontend's exclude selectors for popup pages): the
   * headwords unless enableOnPopupExpressions, controls, and links and tags for touch.
   */
  function popupExclude(type: PointerKind) {
    return [
      '.scan-disable, .scan-disable *, a, a *, button, button *, summary, summary *',
      profile?.scanning.enableOnPopupExpressions
        ? ''
        : '.source-text, .source-text *, .headword-term, .headword-term *',
      type === 'touch' ? '.gloss-link, .gloss-link *, .tag, .tag *, .inflection' : ''
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Nothing found at the scan (Frontend._onSearchEmpty): autoHideResults after hideDelay. */
  function emptied() {
    if (!profile?.scanning.autoHideResults || !open) return;
    hideAfter(profile.scanning.hideDelay);
  }

  /** Popup.hideDelayed: closes after the delay unless the pointer is over the popup by then. */
  function hideAfter(delay: number) {
    clearTimeout(hideTimer);
    if (pointerOverPopup) return;
    if (delay <= 0) return close();
    hideTimer = setTimeout(() => !pointerOverPopup && close(), delay);
  }

  async function run(
    scan: ScannedText,
    nested: boolean,
    at: { left: number; top: number },
    input: { searchTerms: boolean; searchKanji: boolean }
  ) {
    if (!profile) return;
    const current = ++token;
    let result: LookupResult;
    try {
      result = await lookup(scan.text, {
        // Scans in the popup look for both, as Yomitan's popup does.
        searchTerms: nested || input.searchTerms,
        searchKanji: nested || input.searchKanji,
        matchType: profile.scanning.matchTypePrefix ? 'prefix' : 'exact'
      });
    } catch {
      return;
    }
    if (current !== token) return;
    if (!result.dictionaryEntries.length) {
      if (!nested) emptied();
      return;
    }
    clearTimeout(hideTimer);
    const range = scannedRange(scan, result.originalTextLength, profile.scanning.layoutAwareScan);
    const query = range.toString();
    const sentence = scannedSentence(
      scan,
      scan.fixed ? [...scan.text].length : result.originalTextLength,
      profile.scanning.layoutAwareScan,
      profile.sentenceParsing
    );
    const nextView = { query, result, fullQuery: scan.text, sentence };
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
      matchElement = element;
      writingMode = getElementWritingMode(element);
      views = [nextView];
      select(range, !!scan.fixed);
    }
    index = views.length - 1;
    selected = 0;
    await tick();
    bodyEl?.scrollTo({ top: 0 });
    place();
    if (profile.audio.enabled && profile.audio.autoPlay) playFirst();
  }

  /** selectText (TextScanner.setCurrentTextSource): the match becomes the selection. */
  function select(range: Range, restoreSelection: boolean) {
    const previous = selection;
    deselect(false);
    if (!profile?.scanning.selectText) return;
    const doc = range.startContainer.ownerDocument ?? document;
    const current = doc.getSelection();
    if (!current) return;
    // The selection a scanSelectedText lookup replaces comes back when it closes.
    const restore =
      previous?.restore ??
      (restoreSelection
        ? Array.from({ length: current.rangeCount }, (_, i) => current.getRangeAt(i).cloneRange())
        : []);
    if (!restoreSelection && !userSelectionEmpty) return;
    changingSelection = true;
    clearTimeout(selectionTimer);
    // As TextScanner: 50 ms for the selectionchange events this causes.
    selectionTimer = setTimeout(() => (changingSelection = false), 50);
    setLookupSelection(range);
    current.removeAllRanges();
    current.addRange(range);
    selection = { doc, range, restore };
  }

  function deselect(restore = true) {
    if (!selection) return;
    const { doc, restore: ranges } = selection;
    selection = undefined;
    setLookupSelection(undefined);
    const current = doc.getSelection();
    if (!current) return;
    current.removeAllRanges();
    if (restore) for (const range of ranges) current.addRange(range);
  }

  function onSelectionChange() {
    if (changingSelection) return;
    const doc = selection?.doc ?? document;
    userSelectionEmpty = doc.getSelection()?.isCollapsed ?? true;
  }

  /** A `?query=` link (terms, as Yomitan's search) or a headword's kanji link (kanji). */
  async function lookupQuery(query: string, kanji = false) {
    if (!profile || !canNest()) return;
    const current = ++token;
    const result = await lookup(query, { searchTerms: !kanji, searchKanji: kanji }).catch(
      () => undefined
    );
    if (current !== token || !result?.dictionaryEntries.length) return;
    views = [
      ...views.slice(0, index + 1),
      { query, result, fullQuery: query, sentence: { text: query, offset: 0 } }
    ];
    index = views.length - 1;
    selected = 0;
    await tick();
    bodyEl?.scrollTo({ top: 0 });
  }

  const canNest = () => !!profile && index < profile.scanning.popupNestingMaxDepth;

  /** The page's zoom (desktop app: exact; browser: estimated, see loadPixelRatio). */
  function pageZoom() {
    const desktop = (globalThis as { chimiDesktop?: { zoomFactor?: () => number } }).chimiDesktop;
    const exact = desktop?.zoomFactor?.();
    return typeof exact === 'number' && exact > 0
      ? exact
      : (globalThis.devicePixelRatio || 1) / loadPixelRatio;
  }

  function place() {
    if (!profile || !open) return;
    const { general } = profile;
    const viewport = window.visualViewport;
    // Frontend._updateContentScale
    contentScale =
      (general.popupScalingFactor || 1) /
      (general.popupScaleRelativeToPageZoom ? pageZoom() : 1) /
      (general.popupScaleRelativeToVisualViewport ? (viewport?.scale ?? 1) : 1);
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
    const scale = contentScale;
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
    const headword = entry?.type === 'term' ? entry.headwords[0] : undefined;
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

  function pointerDown(event: PointerEvent, x = event.clientX, y = event.clientY) {
    lastPointer = { x, y, type: event.pointerType };
    if (open && !inPopup(event.target)) close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!profile || !$builtInLookups$) return;
    const action =
      (open && hotkeyAction(profile.inputs.hotkeys, event, 'popup')) ||
      hotkeyAction(profile.inputs.hotkeys, event, 'web');
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      runAction(action.action, action.argument, event);
    }
  }

  function runAction(action: string, argument: string, event: KeyboardEvent) {
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
      case 'addNote':
      case 'viewNotes':
        ankiCommand = { action, argument, id: (ankiCommand?.id ?? 0) + 1 };
        return;
      case 'scanSelectedText':
        return scanSelectedText((event.target as Node | null)?.ownerDocument ?? document);
    }
  }

  /** Frontend._scanSelectedText: the selection looked up as it is, in the reader or the popup. */
  function scanSelectedText(doc: Document) {
    if (!profile) return;
    const scan = scanSelection(doc.getSelection());
    if (!scan) return;
    const nested = inPopup(scan.node.parentElement);
    if (nested ? !canNest() : !inScope(scan.node.parentElement)) return;
    const left = doc === frame?.contentDocument ? frame.getBoundingClientRect().left : 0;
    const top = doc === frame?.contentDocument ? frame.getBoundingClientRect().top : 0;
    lastScanKey = scanKey(nested, scan);
    void run(scan, nested, { left, top }, { searchTerms: true, searchKanji: true });
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

  /**
   * reducedMotionScrolling (Display._onWheel, _onTouchStart, _onTouchMove): the wheel and a
   * swipe past the threshold scroll by a share of the popup's height, without animation.
   */
  function reducedMotion(node: HTMLElement) {
    const options = () => profile?.scanning;
    const scrollBy = (direction: 1 | -1) => {
      const scale = options()?.reducedMotionScrollingScale ?? 1;
      const bottom = node.scrollHeight - node.clientHeight;
      node.scrollTop = Math.max(
        0,
        Math.min(node.scrollTop + node.clientHeight * scale * direction, bottom)
      );
    };
    let start: number | undefined;
    const wheel = (event: WheelEvent) => {
      if (!options()?.reducedMotionScrolling || event.altKey || event.shiftKey) return;
      scrollBy(event.deltaY > 0 ? 1 : -1);
      event.preventDefault();
    };
    const touchStart = (event: TouchEvent) => {
      start =
        options()?.reducedMotionScrolling && event.touches.length === 1
          ? event.touches[0].clientY
          : undefined;
    };
    const touchMove = (event: TouchEvent) => {
      if (options()?.reducedMotionScrolling && event.cancelable) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      if (start === undefined) return;
      const delta = start - event.changedTouches[0].clientY;
      const threshold = options()?.reducedMotionScrollingSwipeThreshold ?? 40;
      start = undefined;
      if (delta > threshold) scrollBy(1);
      else if (delta < -threshold) scrollBy(-1);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('touchstart', touchStart, { passive: true });
    node.addEventListener('touchmove', touchMove, { passive: false });
    node.addEventListener('touchend', touchEnd, { passive: true });
    return {
      destroy() {
        node.removeEventListener('wheel', wheel);
        node.removeEventListener('touchstart', touchStart);
        node.removeEventListener('touchmove', touchMove);
        node.removeEventListener('touchend', touchEnd);
      }
    };
  }

  /** Taps inside the popup look the word under them up (nested), as on the page. */
  function onPopupClick(event: MouseEvent) {
    if (lastPointer?.type !== 'touch' || !canNest() || scanner.claimed) return;
    const input = scanner.tapInput(event.clientX, event.clientY);
    if (input) scanTap(event.clientX, event.clientY, input, true);
  }

  /** The mouse's back and forward buttons go through the popup's history (Display), unless prevented. */
  function onPopupMouseUp(event: MouseEvent) {
    if (event.button !== 3 && event.button !== 4) return;
    if (profile?.scanning.preventBackForward.onPopupPages) return;
    const by = event.button === 3 ? -1 : 1;
    if (index + by < 0 || index + by >= views.length) return;
    event.preventDefault();
    go(by);
  }

  function onPopupPointerEnter() {
    pointerOverPopup = true;
    clearTimeout(hideTimer);
  }

  /** hidePopupOnCursorExit (Frontend._onPopupFramePointerOut) */
  function onPopupPointerLeave(event: PointerEvent) {
    pointerOverPopup = false;
    if (event.pointerType !== 'mouse' || !profile?.scanning.hidePopupOnCursorExit) return;
    hideAfter(profile.scanning.hidePopupOnCursorExitDelay);
  }
</script>

<svelte:window
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
    style:--dict-font-size="{profile.general.fontSize * contentScale}px"
    style:--dict-line-height={profile.general.lineHeight}
    style:--dict-font-family={profile.general.fontFamily || null}
    data-indicator={profile.general.popupCurrentIndicatorMode}
    data-action-bar={profile.general.popupActionBarLocation}
    role="dialog"
    aria-label={$t$('lookup.title', { query: view.query })}
    on:click={onPopupClick}
    on:mouseup={onPopupMouseUp}
    on:pointerenter={onPopupPointerEnter}
    on:pointerleave={onPopupPointerLeave}
    use:styleSheet={dictionaryCss}
  >
    <div class="dict-bar">
      {#if views.length > 1 || actionBarAlways}
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
    <div class="dict-body" bind:this={bodyEl} use:reducedMotion>
      {#each view.result.dictionaryEntries as entry, entryIndex}
        {#if entry.type === 'kanji'}
          <KanjiEntry
            {entry}
            options={profile}
            summaries={$dictionaries$}
            current={entryIndex === selected && many}
            {ankiContext}
            screenshot={entryScreenshot}
            ankiCommand={entryIndex === selected ? ankiCommand : undefined}
            oncopy={copy}
          />
        {:else}
          <TermEntry
            {entry}
            options={profile}
            summaries={$dictionaries$}
            current={entryIndex === selected && many}
            audio={profile.audio.enabled}
            {ankiContext}
            screenshot={entryScreenshot}
            ankiCommand={entryIndex === selected ? ankiCommand : undefined}
            on:lookup={({ detail }) => lookupQuery(detail)}
            on:lookupKanji={({ detail }) => lookupQuery(detail, true)}
            on:audio={({ detail }) =>
              profile && playTermAudio(detail.term, detail.reading, profile.audio)}
            on:copy={({ detail }) => copy(detail)}
            on:markKnown={({ detail }) => setWordMarks([[detail, null]], 'known')}
          />
        {/if}
      {/each}
    </div>
  </section>
{/if}

{#if emptyNote}
  <Toast label={$t$('lookup.noDictionary')} onclose={() => (emptyNote = false)}>
    <p class="dict-empty-title">{$t$('lookup.noDictionary')}</p>
    <p class="dict-empty-text">
      <a href="{pagePath}/settings?section=dictionary">{$t$('lookup.dictionarySettings')}</a>
    </p>
    <InstallDictionary ondone={() => (emptyNote = false)} />
  </Toast>
{/if}

<style lang="scss">
  .dict-empty-title {
    font-weight: 700;
  }

  .dict-empty-text {
    margin: 0.25rem 0 0.75rem;
    font-size: var(--type-small);
    line-height: 1.5;

    a {
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }

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
    font-family: var(--dict-font-family, var(--app-font-ui));
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

  /* popupActionBarLocation: the bar at the bottom, or down the left or right edge */
  .ttu-dict[data-action-bar='bottom'] .dict-bar {
    order: 1;
    border-top: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    border-bottom: 0;
  }

  .ttu-dict[data-action-bar='left'],
  .ttu-dict[data-action-bar='right'] {
    flex-direction: row;
  }

  .ttu-dict[data-action-bar='left'] .dict-bar,
  .ttu-dict[data-action-bar='right'] .dict-bar {
    flex-direction: column;
    padding: 0.25rem;
    border-bottom: 0;
    border-right: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .ttu-dict[data-action-bar='right'] .dict-bar {
    order: 1;
    border-right: 0;
    border-left: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .ttu-dict[data-action-bar='left'] .dict-query,
  .ttu-dict[data-action-bar='right'] .dict-query {
    writing-mode: vertical-rl;
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

  /* popupCurrentIndicatorMode (Yomitan's display.css entry indicators) */
  .ttu-dict[data-indicator='bar-left'] :global(.entry.current)::before,
  .ttu-dict[data-indicator='bar-right'] :global(.entry.current)::before {
    content: '';
    position: absolute;
    top: 0.75rem;
    bottom: 0.75rem;
    left: -0.75rem;
    width: 3px;
    background: var(--accent-color);
  }

  .ttu-dict[data-indicator='bar-right'] :global(.entry.current)::before {
    left: auto;
    right: -0.75rem;
  }

  .ttu-dict[data-indicator='dot-left'] :global(.entry.current)::before,
  .ttu-dict[data-indicator='dot-right'] :global(.entry.current)::before {
    content: '';
    position: absolute;
    top: 0.75rem;
    left: -0.6rem;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--accent-color);
  }

  .ttu-dict[data-indicator='dot-right'] :global(.entry.current)::before {
    left: auto;
    right: -0.6rem;
  }

  .ttu-dict[data-indicator='triangle'] :global(.entry.current .headword:first-child)::before {
    content: '';
    position: absolute;
    left: -0.75rem;
    width: 0.4rem;
    height: 0.8rem;
    margin-top: 0.6em;
    background: var(--accent-color);
    clip-path: polygon(0 0, 100% 50%, 0 100%);
  }

  .ttu-dict[data-indicator='asterisk'] :global(.entry.current .entry-head)::after {
    content: '*';
    order: 2;
    color: var(--accent-strong-color);
    font-size: 1.5em;
    font-weight: 700;
    line-height: 1;
  }

  .ttu-dict :global(.entry-head) {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
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
    white-space: nowrap;
  }

  .ttu-dict :global(.headword-term rt) {
    font-size: 0.5em;
    color: var(--app-muted-fg);
  }

  .ttu-dict :global(.headword + .headword .headword-term) {
    font-size: 1.25em;
  }

  .ttu-dict :global(.headword-kanji-link) {
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .ttu-dict :global(.headword-kanji-link:hover) {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .ttu-dict :global(.headword-reading) {
    color: var(--app-muted-fg);
    font-size: 1.1em;
  }

  .ttu-dict :global(.entry-actions) {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
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
    font-size: 0.875em;
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
    font-size: 0.875em;
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
