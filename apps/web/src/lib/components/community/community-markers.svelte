<script lang="ts">
  import { communityMarks$, communityMarkTap$, restoreBookMarks } from '$lib/data/community-book';
  import { PAGE_CHANGE } from '$lib/data/events';
  import { setCssHighlight } from '$lib/functions/book-text/css-highlights';
  import { getTextSegments, rangeForCounts } from '$lib/functions/book-text/text-positions';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  /**
   * Lines with threads in the text (board 2, D3): a dotted green line (the CSS Highlight API's
   * underline in horizontal text; Chromium paints no highlight decoration in vertical text, so
   * there a dotted rule is drawn left of the column) and a chat bubble with the post count after
   * the end of the paragraph holding the line, the tap target (taps on the text stay dictionary
   * lookups). The book's DOM is never touched: everything is an overlay.
   */
  export let title: string;
  export let vertical: boolean;
  /** The rendered text's first character count (bookmarkManager.getRenderedStartCount) */
  export let renderedStart: () => number;

  const dispatch = createEventDispatcher<{ open: void }>();

  let ranges: { hash: string; posts: number; range: Range; block: Range }[] = [];
  let tags: { hash: string; posts: number; x: number; y: number }[] = [];
  let rules: { x: number; y: number; height: number }[] = [];
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observed: Element | null = null;

  // A rebuild only when the text marked went away (paginated mode swaps sections); continuous
  // mode holds the whole book and changes inside it all the time.
  const observer = new MutationObserver(() => {
    if (!ranges.length || ranges.some(({ range }) => !range.startContainer.isConnected)) {
      schedule(true);
    }
  });
  // Reflows without a scroll (the side panel opening or closing, font or margin changes): the text
  // moved under the bubbles, so they are placed again.
  const resized = new ResizeObserver(() => schedule());

  $: restoreBookMarks(title);
  $: marks = $communityMarks$.title === title ? $communityMarks$.marks : [];
  $: if (marks || vertical) schedule(true);

  /**
   * Ranges again at most every 200 ms after the marks or the rendered text changed (a throttle,
   * not a debounce: continuous mode's text changes often enough to starve one); on scrolls only
   * the positions, once a frame.
   */
  function schedule(rebuild = false) {
    cancelAnimationFrame(frame);
    if (rebuild) {
      timer ??= setTimeout(() => {
        timer = undefined;
        build();
      }, 200);
    } else {
      frame = requestAnimationFrame(place);
    }
  }

  function build() {
    const content = document.querySelector('.book-content');

    if (content !== observed) {
      observer.disconnect();
      resized.disconnect();
      if (content) {
        observer.observe(content, { childList: true, subtree: true });
        [content, ...content.children].forEach((element) => resized.observe(element));
      }
      observed = content;
    }
    if (!content || !marks.length) {
      ranges = [];
    } else {
      const base = renderedStart();
      const segments = getTextSegments(content);
      const last = segments[segments.length - 1];
      const end = base + (last ? last.startCount + last.count : 0);

      ranges = marks
        .filter((mark) => mark.end > base && mark.start < end)
        .flatMap((mark) => {
          const range = rangeForCounts(
            document,
            segments,
            Math.max(mark.start, base),
            Math.min(mark.end, end),
            base
          );

          if (!range) return [];

          // The paragraph holding the line's end (its box on this page: paginated text splits it)
          const block = document.createRange();
          const element = range.endContainer.parentElement?.closest(
            'p, div, li, blockquote, h1, h2, h3, h4, h5, h6'
          );

          if (element && content.contains(element)) {
            block.selectNodeContents(element);
            // Aozora-style books end paragraphs with <br> inside one block: the next one ends it.
            const br = [...element.querySelectorAll('br')].find(
              (item) =>
                item.compareDocumentPosition(range.endContainer) & Node.DOCUMENT_POSITION_PRECEDING
            );

            if (br) block.setEndBefore(br);
          } else block.setStart(range.endContainer, range.endOffset);
          return [{ hash: mark.hash, posts: mark.posts, range, block }];
        });
    }
    setCssHighlight('ttu-community', vertical ? [] : ranges.map((item) => item.range));
    place();
  }

  function place() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // The book's visible box: paginated text narrowed beside the panel lays its next page under it.
    const box = observed?.getBoundingClientRect() ?? new DOMRect(0, 0, width, height);
    const onScreen = (rect: DOMRect) =>
      rect.right > Math.max(0, box.left) &&
      rect.left < Math.min(width, box.right) &&
      rect.bottom > Math.max(0, box.top) &&
      rect.top < Math.min(height, box.bottom);
    const nextTags: typeof tags = [];
    const nextRules: typeof rules = [];

    ranges.forEach(({ hash, posts, range, block }) => {
      const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);

      if (!rects.some(onScreen)) return;

      // After the paragraph's last line on screen: its end in the text's direction
      const end = [...block.getClientRects()]
        .filter((rect) => rect.width && rect.height && onScreen(rect))
        .pop();
      const last = end ?? rects[rects.length - 1];
      const tag = vertical
        ? { hash, posts, x: last.left + last.width / 2, y: Math.min(last.bottom + 16, height - 16) }
        : { hash, posts, x: Math.min(last.right + 16, width - 16), y: last.top + last.height / 2 };

      // Lines ending one paragraph: their bubbles line up along the line instead of overlapping,
      // back towards the text when the first sits at the window's edge.
      const step = (vertical ? tag.y >= height - 44 : tag.x >= width - 44) ? -28 : 28;

      while (nextTags.some((other) => Math.hypot(other.x - tag.x, other.y - tag.y) < 24)) {
        if (vertical) tag.y += step;
        else tag.x += step;
      }
      nextTags.push(tag);
      if (vertical) {
        rects
          .filter(onScreen)
          .forEach((rect) =>
            nextRules.push({ x: rect.left - 3, y: rect.top, height: rect.height })
          );
      }
    });
    // Only real changes reach the DOM.
    if (JSON.stringify(nextTags) !== JSON.stringify(tags)) tags = nextTags;
    if (JSON.stringify(nextRules) !== JSON.stringify(rules)) rules = nextRules;
  }

  const onScroll = () => schedule();
  const label = (count: number) =>
    $t$(count === 1 ? 'community.markerTitleOne' : 'community.markerTitle', { count });

  onMount(() => {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener(PAGE_CHANGE, onScroll);
    window.addEventListener('resize', onScroll);
  });

  onDestroy(() => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    observer.disconnect();
    resized.disconnect();
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener(PAGE_CHANGE, onScroll);
    window.removeEventListener('resize', onScroll);
    setCssHighlight('ttu-community', []);
  });
</script>

<!-- One clipped layer: nothing drawn here can add to the page's scroll size. -->
<div class="community-layer">
  {#each rules as rule, i (i)}
    <span
      class="community-rule"
      style:left="{rule.x}px"
      style:top="{rule.y}px"
      style:height="{rule.height}px"
      aria-hidden="true"
    />
  {/each}
  {#each tags as tag (tag.hash)}
    <button
      type="button"
      class="community-tag writing-horizontal-tb"
      data-hash={tag.hash}
      style:left="{tag.x}px"
      style:top="{tag.y}px"
      title={label(tag.posts)}
      aria-label={label(tag.posts)}
      on:click={() => {
        communityMarkTap$.next(tag.hash);
        dispatch('open');
      }}><span class="community-bubble">{tag.posts > 99 ? '99+' : tag.posts}</span></button
    >
  {/each}
</div>

<style>
  .community-layer {
    position: fixed;
    z-index: 11;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    contain: strict;
  }

  .community-rule {
    position: absolute;
    border-left: 2px dotted var(--accent-color);
    pointer-events: none;
  }

  /* A 28px tap target holding a square-cornered speech bubble in the spot colour */
  .community-tag {
    position: absolute;
    pointer-events: auto;
    display: inline-flex;
    width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    color: var(--app-accent-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-label);
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .community-bubble {
    position: relative;
    display: inline-flex;
    min-width: 1.25rem;
    height: 1rem;
    align-items: center;
    justify-content: center;
    margin-top: -0.25rem;
    padding: 0 0.2rem;
    border-radius: 2px;
    background: var(--accent-color);
  }

  /* The tail, lower left */
  .community-bubble::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0.2rem;
    width: 0.375rem;
    height: 0.3rem;
    background: var(--accent-color);
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  .community-tag:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 0;
  }
</style>
