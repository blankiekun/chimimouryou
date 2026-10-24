<script lang="ts">
  import { goto } from '$app/navigation';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import PointBox from '$lib/components/point-box.svelte';
  import { pagePath } from '$lib/data/env';
  import {
    hardGuess,
    latestPlacement,
    loadHardItems,
    nextItem,
    placementCutoff$,
    placementFromWordTest$,
    placementLength,
    placementLengths,
    placementList,
    placementPseudoWords,
    placementOffered$,
    placementResults$,
    placementWords,
    readingMatches,
    recordPlacement,
    scorePlacement,
    shuffle,
    type HardItem,
    type PlacementAnswer,
    type PlacementItem,
    type PlacementResult
  } from '$lib/data/placement';
  import { t$, type MessageKey } from '$lib/i18n';
  import { convertToKanaIME } from '$lib/vendor/yomitan/language/ja/japanese-wanakana';
  import { onMount, tick } from 'svelte';

  /**
   * The placement check: an intro, the words one at a time (yes/no, keys Y/N or arrows) and
   * the result, saved as `placementCutoff$`. In the app (/placement, from Home's offer and the
   * Words tab) and, `shared`, as the public word test (/word-test) with Share and a way into
   * the app. `hard`: hard mode, each word's reading typed (romaji becomes kana as it is typed;
   * a wrong one moves on) then its meaning from four choices (keys 1-4, 0 or N for don't know),
   * saved as a `typed` record. Sends nothing
   * anywhere. Not part of upstream.
   */

  /** The public word test: share the result, then start reading */
  export let shared = false;
  /** Hard mode: reading and meaning, four choices each */
  export let hard = false;
  const number = (value: number) => value.toLocaleString('en-US');
  const lengths: ToggleOption<number>[] = placementLengths.map((id) => ({ id, text: `${id}` }));

  /** Words in this test: 20, 40 or 60 */
  let length = placementLength;

  let step: 'intro' | 'test' | 'result' = 'intro';
  let items: PlacementItem[] = placementList;
  let loading = false;
  /** Words shown so far; the last one is waiting for an answer */
  let shown: PlacementItem[] = [];
  let answers: PlacementAnswer[] = [];
  let result: PlacementResult | undefined;
  let previous = latestPlacement($placementResults$, hard ? 'typed' : 'yesno')?.cutoff ?? 0;
  /** A result of the first hard mode (readings chosen) was kept but no longer counts */
  $: droppedHard = hard && $placementResults$.some(({ mode }) => mode === 'hard');
  /** Hard mode: which question of the word, the meanings in shown order, the reading typed */
  let stage: 'reading' | 'meaning' = 'reading';
  let meanings: string[] = [];
  let typed = '';
  let readingInput: HTMLInputElement | undefined;

  $: index = answers.length;
  $: item = shown[index];
  $: hardItem = hard ? (item as HardItem | undefined) : undefined;
  $: if (hardItem) prepare(hardItem);
  $: realCount = hard ? length : length - placementPseudoWords(length);
  $: testPath = hard ? '/hard-word-test' : '/word-test';
  /** The other mode's test, on the same kind of page */
  $: otherTest = shared
    ? hard
      ? '/word-test'
      : '/hard-word-test'
    : hard
      ? '/placement'
      : '/placement?mode=hard';
  let title: MessageKey;
  $: title = hard
    ? shared
      ? 'hardTest.publicTitle'
      : 'hardTest.title'
    : shared
      ? 'wordTest.title'
      : 'placement.title';

  const next = () => nextItem(answers, items, undefined, undefined, length);

  function prepare(word: HardItem) {
    meanings = shuffle(word.m);
    stage = 'reading';
    typed = '';
    focusReading();
  }

  const focusReading = () => tick().then(() => readingInput?.focus());

  /** Romaji typed becomes kana as it goes (an IME's own input is left alone). */
  function onReadingInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;

    if ((event as InputEvent).isComposing || !/[a-z]/i.test(input.value)) return;

    const { kanaString, newSelectionStart } = convertToKanaIME(
      input.value.toLowerCase(),
      input.selectionStart ?? input.value.length
    );

    input.value = kanaString;
    input.setSelectionRange(newSelectionStart, newSelectionStart);
    typed = kanaString;
  }

  /** Hard mode: a right reading goes on to the meaning, a wrong one to the next word. */
  function submitReading() {
    if (step !== 'test' || !hardItem || !typed.trim()) return;
    if (!readingMatches(hardItem, typed)) {
      answer(false);
      return;
    }
    readingInput?.blur();
    stage = 'meaning';
  }

  async function start() {
    // The word test leaves Home's offer to say the result carried over.
    if (!shared) $placementOffered$ = true;
    if (hard && items === placementList) {
      loading = true;
      items = await loadHardItems().finally(() => (loading = false));
    }
    answers = [];
    shown = [next()!];
    result = undefined;
    step = 'test';
  }

  function answer(known: boolean) {
    if (step !== 'test' || !item) return;

    answers = [...answers, { item, yes: known }];

    const following = next();

    if (following) {
      shown = [...shown.slice(0, answers.length), following];
      return;
    }

    result = scorePlacement(answers, undefined, hard ? hardGuess : 0);
    if (!result.retake) {
      recordPlacement(hard ? 'typed' : 'yesno', result.cutoff, length, result.words);
      // Home then says where it came from rather than offering the check.
      $placementFromWordTest$ = shared;
      previous = result.cutoff;
    }
    step = 'result';
  }

  /** Hard mode: a meaning (by shown position), or null for don't know. */
  function choose(choice: number | null) {
    if (step !== 'test' || !hardItem) return;
    answer(choice !== null && stage === 'meaning' && meanings[choice] === hardItem.m[0]);
  }

  function back() {
    if (hard && stage === 'meaning') {
      stage = 'reading';
      focusReading();
    } else answers = answers.slice(0, -1);
  }

  function onKeydown(event: KeyboardEvent) {
    if (step !== 'test' || event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key.toLowerCase();

    // Typing the reading: the input has the keys (Enter submits its form).
    if (event.target === readingInput) return;
    if (hard && stage === 'meaning' && /^[1-4]$/.test(key)) choose(Number(key) - 1);
    else if (hard && stage === 'meaning' && (key === '0' || key === 'n')) choose(null);
    else if (!hard && (key === 'y' || key === 'arrowright')) answer(true);
    else if (!hard && (key === 'n' || key === 'arrowleft')) answer(false);
    else if (key === 'backspace' && (index || stage === 'meaning')) back();
    else return;
    event.preventDefault();
  }

  onMount(() => {
    // Seen here: Home doesn't offer it again.
    if (!shared) $placementOffered$ = true;
  });

  let copied = false;

  async function shareResult(words: number) {
    const url = `${window.location.origin}${pagePath}${testPath}`;
    const text = $t$(hard ? 'hardTest.shareText' : 'wordTest.shareText', { count: number(words) });

    if (navigator.share) {
      await navigator.share({ text, url }).catch(() => {});
      return;
    }

    await navigator.clipboard?.writeText(`${text} ${url}`).then(
      () => (copied = true),
      () => {}
    );
  }
</script>

<svelte:window on:keydown={onKeydown} />

<main class="placement">
  {#if step === 'intro'}
    <h1 class="placement-title">{$t$(title)}</h1>
    <p class="placement-lede">
      {#if hard}
        {$t$('hardTest.lede', { minutes: Math.round(length / 6) })}
      {:else}
        {$t$(shared ? 'wordTest.lede' : 'placement.lede', { minutes: length / 20 })}
      {/if}
    </p>
    <dl class="placement-facts">
      <div>
        <dt>{$t$('placement.items')}</dt>
        <dd class="placement-length">
          <ButtonToggleGroup options={lengths} bind:selectedOptionId={length} />
          <small>{$t$('placement.lengthNote')}</small>
        </dd>
      </div>
      <div>
        <dt>{$t$('placement.keys')}</dt>
        <dd>{$t$(hard ? 'hardTest.keysValue' : 'placement.keysValue')}</dd>
      </div>
      <div>
        <dt>{$t$('placement.result')}</dt>
        <dd>{$t$('placement.resultValue')}</dd>
      </div>
    </dl>
    {#if previous && !shared}
      <p class="placement-note">{$t$('placement.current', { count: number(previous) })}</p>
    {/if}
    {#if droppedHard && !shared}
      <p class="placement-note">{$t$('hardTest.dropped')}</p>
    {/if}
    <div class="placement-actions">
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={loading}
        on:click={start}>{$t$(loading ? 'hardTest.loading' : 'placement.start')}</button
      >
      {#if !shared}
        <a class="app-button app-button-quiet" href="{pagePath}/words">{$t$('placement.notNow')}</a>
      {/if}
    </div>
  {:else if step === 'test' && hardItem}
    <div class="placement-progress">
      <span>{$t$('placement.progress', { done: index + 1, total: length })}</span>
      <span class="placement-track" aria-hidden="true">
        <span style:width="{(index / length) * 100}%" />
      </span>
    </div>
    <p class="placement-question" id="placement-question">
      {$t$(stage === 'reading' ? 'hardTest.reading' : 'hardTest.meaning')}
    </p>
    <p
      class="placement-word placement-word-hard"
      lang="ja"
      aria-live="polite"
      aria-describedby="placement-question"
    >
      {hardItem.w}
    </p>
    {#if stage === 'reading'}
      <form class="hard-typed" on:submit|preventDefault={submitReading}>
        <input
          class="app-input hard-input"
          type="text"
          lang="ja"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="next"
          placeholder={$t$('hardTest.typePlaceholder')}
          aria-labelledby="placement-question"
          bind:this={readingInput}
          bind:value={typed}
          on:input={onReadingInput}
        />
        <button type="submit" class="app-button app-button-primary" disabled={!typed.trim()}
          >{$t$('hardTest.next')}</button
        >
        <button
          type="button"
          class="app-button hard-choice hard-unknown"
          on:click={() => choose(null)}>{$t$('hardTest.dontKnow')}</button
        >
      </form>
    {:else}
      <div class="hard-choices" role="group" aria-labelledby="placement-question">
        <p class="hard-picked">
          {$t$('hardTest.picked')} <strong lang="ja">{typed}</strong>
        </p>
        {#each meanings as text, i (text)}
          <button type="button" class="app-button hard-choice" on:click={() => choose(i)}
            ><kbd>{i + 1}</kbd><span lang="ja">{text}</span></button
          >
        {/each}
        <button
          type="button"
          class="app-button hard-choice hard-unknown"
          on:click={() => choose(null)}><kbd>0</kbd><span>{$t$('hardTest.dontKnow')}</span></button
        >
      </div>
    {/if}
    <div class="placement-minor">
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={!index && stage === 'reading'}
        on:click={back}>{$t$('placement.back')}</button
      >
      <button type="button" class="app-button app-button-quiet" on:click={() => (step = 'intro')}
        >{$t$('placement.stop')}</button
      >
    </div>
  {:else if step === 'test' && item}
    <div class="placement-progress">
      <span>{$t$('placement.progress', { done: index + 1, total: length })}</span>
      <span class="placement-track" aria-hidden="true">
        <span style:width="{(index / length) * 100}%" />
      </span>
    </div>
    <p class="placement-question" id="placement-question">{$t$('placement.question')}</p>
    <p class="placement-word" lang="ja" aria-live="polite" aria-describedby="placement-question">
      {item.w}
    </p>
    <div class="placement-answers">
      <button type="button" class="app-button" on:click={() => answer(false)}
        >{$t$('placement.dontKnow')}<kbd>N</kbd></button
      >
      <button type="button" class="app-button app-button-primary" on:click={() => answer(true)}
        >{$t$('placement.know')}<kbd>Y</kbd></button
      >
    </div>
    <div class="placement-minor">
      <button type="button" class="app-button app-button-quiet" disabled={!index} on:click={back}
        >{$t$('placement.back')}</button
      >
      <button type="button" class="app-button app-button-quiet" on:click={() => (step = 'intro')}
        >{$t$('placement.stop')}</button
      >
    </div>
  {:else if result?.retake}
    <h1 class="placement-title">{$t$(title)}</h1>
    <p class="placement-lede">
      {$t$('placement.retakeText', { count: result.falseAlarms, total: result.pseudoWords })}
    </p>
    <div class="placement-actions">
      <button type="button" class="app-button app-button-primary" on:click={start}
        >{$t$('words.placementRetake')}</button
      >
      {#if !shared}
        <a class="app-button app-button-quiet" href="{pagePath}/words">{$t$('placement.notNow')}</a>
      {/if}
    </div>
  {:else if result && shared}
    <p class="placement-big">
      {$t$('wordTest.result', { count: number(placementWords(result)) })}
    </p>
    <p class="placement-lede">
      {$t$(
        result.cutoff
          ? hard
            ? 'hardTest.meaningText'
            : 'wordTest.meaning'
          : 'wordTest.meaningZero',
        { count: number(result.cutoff) }
      )}
    </p>
    <p class="placement-note">
      {#if hard}{$t$('hardTest.stricter')}{/if}
      {#if result.falseAlarms}
        {$t$('placement.falseAlarms', {
          count: result.falseAlarms,
          total: result.pseudoWords
        })}
      {/if}
      {$t$('placement.rough', { count: realCount })}
    </p>
    <div class="placement-actions">
      <a class="app-button app-button-primary" href="{pagePath}/manage">{$t$('wordTest.start')}</a>
      <button type="button" class="app-button" on:click={() => shareResult(placementWords(result))}
        >{$t$(copied ? 'wordTest.copied' : 'wordTest.share')}</button
      >
      <button type="button" class="app-button app-button-quiet" on:click={start}
        >{$t$('words.placementRetake')}</button
      >
    </div>
    <a class="app-button app-button-quiet placement-other" href="{pagePath}{otherTest}"
      >{$t$(hard ? 'hardTest.yesNo' : 'hardTest.try')}</a
    >
  {:else if result}
    <h1 class="placement-title">{$t$(title)}</h1>
    <div class="placement-result">
      <PointBox
        label={$t$('placement.result')}
        figure={$t$('placement.about', { count: number(placementWords(result)) })}
        unit={$t$('placement.words')}
      >
        <p class="placement-result-text">
          {result.cutoff
            ? $t$('placement.resultText', { count: number(result.cutoff) })
            : $t$('placement.zeroText')}
        </p>
      </PointBox>
    </div>
    <p class="placement-note">
      {#if hard}{$t$('hardTest.stricter')} {$t$('hardTest.both')}{/if}
      {#if droppedHard}{$t$('hardTest.dropped')}{/if}
      {#if result.falseAlarms}
        {$t$('placement.falseAlarms', {
          count: result.falseAlarms,
          total: result.pseudoWords
        })}
      {/if}
      {$t$('placement.rough', { count: realCount })}
    </p>
    <div class="placement-actions">
      <button
        type="button"
        class="app-button app-button-primary"
        on:click={() => goto(`${pagePath}/words`)}>{$t$('placement.done')}</button
      >
      <button type="button" class="app-button" on:click={start}
        >{$t$('words.placementRetake')}</button
      >
    </div>
    <a class="app-button app-button-quiet placement-other" href="{pagePath}{otherTest}"
      >{$t$(hard ? 'hardTest.yesNo' : 'hardTest.try')}</a
    >
  {/if}
  {#if hard && step === 'result'}
    <p class="placement-credits">{$t$('hardTest.credits')}</p>
  {/if}
</main>

<style>
  .placement {
    display: flex;
    max-width: 40rem;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 6rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .placement {
      padding: 7.5rem 2.5rem 4rem;
    }
  }

  .placement-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .placement-lede {
    max-width: 34rem;
    line-height: 1.7;
  }

  .placement-facts {
    border-top: 2px solid var(--font-color);
  }

  .placement-facts div {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr);
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .placement-facts dt,
  .placement-note,
  .placement-question,
  .placement-progress {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .placement-note {
    line-height: 1.7;
  }

  .placement-length {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .placement-length small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .placement-actions,
  .placement-minor {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .placement-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-variant-numeric: tabular-nums;
  }

  .placement-track {
    display: block;
    height: 3px;
    background: var(--border-color);
  }

  .placement-track span {
    display: block;
    height: 100%;
    background: var(--accent-color);
    transition: width 150ms ease-out;
  }

  .placement-question {
    margin-top: 2rem;
    text-align: center;
  }

  .placement-word {
    padding: 2.5rem 0;
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
    font-size: 3.5rem;
    line-height: 1.2;
    text-align: center;
  }

  .placement-answers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .placement-answers .app-button {
    min-height: 3.5rem;
    justify-content: center;
    gap: 0.6rem;
  }

  .placement-answers kbd {
    font-family: inherit;
    font-size: var(--type-label);
    opacity: 0.7;
  }

  @media (pointer: coarse) {
    .placement-answers kbd {
      display: none;
    }
  }

  .placement-minor {
    justify-content: space-between;
  }

  .placement-big {
    font-size: var(--type-display);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  .placement-other {
    align-self: flex-start;
  }

  .placement-credits {
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color);
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    line-height: 1.6;
  }

  .hard-choices {
    display: grid;
    gap: 0.5rem;
  }

  .hard-typed {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
  }

  .hard-input {
    min-width: 0;
    font-size: 1.25rem;
    /* Scrolled to, the Next and Don't know buttons stay above the on-screen keyboard */
    scroll-margin-bottom: 5rem;
  }

  @media (pointer: coarse) {
    /* Room for the word, the input and the keyboard on a phone */
    .placement-word-hard {
      padding: 1.25rem 0;
    }
  }

  .hard-choice {
    min-height: 3.25rem;
    justify-content: flex-start;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    font-size: 1.25rem;
    font-weight: 400;
    text-align: left;
  }

  .hard-choices .hard-choice {
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .hard-choice kbd {
    flex: none;
    color: var(--app-muted-fg);
    font-family: inherit;
    font-size: var(--type-label);
    font-weight: 700;
  }

  .hard-unknown {
    grid-column: 1 / -1;
    border-color: var(--border-color);
    color: var(--app-muted-fg);
    font-size: var(--type-button);
    font-weight: 700;
  }

  .hard-picked {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hard-picked strong {
    margin-left: 0.4rem;
    color: var(--font-color);
    font-size: var(--type-body);
  }

  @media (pointer: coarse) {
    .hard-choice kbd {
      display: none;
    }
  }

  .placement-result-text {
    margin-top: 0.75rem;
    max-width: 30rem;
    line-height: 1.7;
  }
</style>
