<script lang="ts">
  import { communityMarks$, communityMarkTap$ } from '$lib/data/community-book';
  import { PAGE_CHANGE } from '$lib/data/events';
  import { setCssHighlight } from '$lib/functions/book-text/css-highlights';
  import { getTextSegments, rangeForCounts } from '$lib/functions/book-text/text-positions';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  /**
   * Lines with threads in the text (board 2, D3): a dotted green line (the CSS Highlight API's
   * underline in horizontal text; Chromium paints no highlight decoration in vertical text, so
   * there a dotted rule is drawn left of the column) and a count tag in the margin, the tap target
   * (taps on the text stay dictionary lookups). The book's DOM is never touched. Shown once the
   * Community tab has listed the book's threads.
   */
  export let title: string;
  export let vertical: boolean;
  /** The rendered text's first character count (bookmarkManager.getRenderedStartCount) */
  export let renderedStart: () => number;

  const dispatch = createEventDispatcher<{ open: void }>();

  let ranges: { hash: string; posts: number; range: Range }[] = [];
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
      if (content) observer.observe(content, { childList: true, subtree: true });
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

          return range ? [{ hash: mark.hash, posts: mark.posts, range }] : [];
        });
    }
    setCssHighlight('ttu-community', vertical ? [] : ranges.map((item) => item.range));
    place();
  }

  function place() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const onScreen = (rect: DOMRect) =>
      rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
    const nextTags: typeof tags = [];
    const nextRules: typeof rules = [];

    ranges.forEach(({ hash, posts, range }) => {
      const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
      const first = rects[0];

      if (!first || !rects.some(onScreen)) return;

      // In the margin before the paragraph, so a line starting mid-paragraph covers no text.
      const block = range.startContainer.parentElement
        ?.closest('p, div, li, blockquote, h1, h2, h3, h4, h5, h6')
        ?.getBoundingClientRect();

      const tag = vertical
        ? { hash, posts, x: first.left + first.width / 2, y: (block?.top ?? first.top) - 18 }
        : { hash, posts, x: (block?.left ?? first.left) - 22, y: first.top + first.height / 2 };

      // Lines sharing a column or a row: their tags line up outwards instead of overlapping.
      while (nextTags.some((other) => Math.hypot(other.x - tag.x, other.y - tag.y) < 20)) {
        if (vertical) tag.y -= 24;
        else tag.x -= 24;
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

  onMount(() => {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener(PAGE_CHANGE, onScroll);
    window.addEventListener('resize', onScroll);
  });

  onDestroy(() => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    observer.disconnect();
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
      style:left="{tag.x}px"
      style:top="{tag.y}px"
      title={$t$('community.markerTitle', { count: tag.posts })}
      aria-label={$t$('community.markerTitle', { count: tag.posts })}
      on:click={() => {
        communityMarkTap$.next(tag.hash);
        dispatch('open');
      }}>{tag.posts}</button
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

  /* A 24px square drawn on a 40px tap target */
  .community-tag {
    position: absolute;
    pointer-events: auto;
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    color: var(--app-accent-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .community-tag::before {
    content: '';
    position: absolute;
    z-index: -1;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 2px;
    background: var(--accent-color);
  }
</style>
