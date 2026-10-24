<script lang="ts">
  import { goto } from '$app/navigation';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import PointBox from '$lib/components/point-box.svelte';
  import { pagePath } from '$lib/data/env';
  import {
    nextItem,
    placementCutoff,
    placementCutoff$,
    recordPlacement,
    placementFromWordTest$,
    placementLength,
    placementLengths,
    placementPseudoWords,
    placementOffered$,
    scorePlacement,
    type PlacementAnswer,
    type PlacementItem,
    type PlacementResult
  } from '$lib/data/placement';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  /**
   * The placement check: an intro, the words one at a time (yes/no, keys Y/N or arrows) and
   * the result, saved as `placementCutoff$`. In the app (/placement, from Home's offer and the
   * Words tab) and, `shared`, as the public word test (/word-test) with Share and a way into
   * the app. Sends nothing anywhere. Not part of upstream.
   */

  /** The public word test: share the result, then start reading */
  export let shared = false;
  const number = (value: number) => value.toLocaleString('en-US');
  const lengths: ToggleOption<number>[] = placementLengths.map((id) => ({ id, text: `${id}` }));

  /** Words in this test: 20, 40 or 60 */
  let length = placementLength;

  let step: 'intro' | 'test' | 'result' = 'intro';
  /** Words shown so far; the last one is waiting for an answer */
  let shown: PlacementItem[] = [];
  let answers: PlacementAnswer[] = [];
  let result: PlacementResult | undefined;
  let previous = placementCutoff();

  $: index = answers.length;
  $: item = shown[index];
  $: realCount = length - placementPseudoWords(length);

  const next = () => nextItem(answers, undefined, undefined, undefined, length);

  function start() {
    // The word test leaves Home's offer to say the result carried over.
    if (!shared) $placementOffered$ = true;
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

    result = scorePlacement(answers);
    if (!result.retake) {
      recordPlacement('yesno', result.cutoff, length);
      // Home then says where it came from rather than offering the check.
      $placementFromWordTest$ = shared;
      previous = result.cutoff;
    }
    step = 'result';
  }

  function back() {
    answers = answers.slice(0, -1);
  }

  function onKeydown(event: KeyboardEvent) {
    if (step !== 'test' || event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key.toLowerCase();

    if (key === 'y' || key === 'arrowright') answer(true);
    else if (key === 'n' || key === 'arrowleft') answer(false);
    else if (key === 'backspace' && index) back();
    else return;
    event.preventDefault();
  }

  onMount(() => {
    // Seen here: Home doesn't offer it again.
    if (!shared) $placementOffered$ = true;
  });

  let copied = false;

  async function shareResult(cutoff: number) {
    const url = `${window.location.origin}${pagePath}/word-test`;
    const text = $t$('wordTest.shareText', { count: number(cutoff) });

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
    <h1 class="placement-title">{$t$(shared ? 'wordTest.title' : 'placement.title')}</h1>
    <p class="placement-lede">
      {$t$(shared ? 'wordTest.lede' : 'placement.lede', { minutes: length / 20 })}
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
        <dd>{$t$('placement.keysValue')}</dd>
      </div>
      <div>
        <dt>{$t$('placement.result')}</dt>
        <dd>{$t$('placement.resultValue')}</dd>
      </div>
    </dl>
    {#if previous && !shared}
      <p class="placement-note">{$t$('placement.current', { count: number(previous) })}</p>
    {/if}
    <div class="placement-actions">
      <button type="button" class="app-button app-button-primary" on:click={start}
        >{$t$('placement.start')}</button
      >
      {#if !shared}
        <a class="app-button app-button-quiet" href="{pagePath}/words">{$t$('placement.notNow')}</a>
      {/if}
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
    <h1 class="placement-title">{$t$(shared ? 'wordTest.title' : 'placement.title')}</h1>
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
      {$t$('wordTest.result', { count: number(result.cutoff) })}
    </p>
    <p class="placement-lede">
      {$t$(result.cutoff ? 'wordTest.meaning' : 'wordTest.meaningZero', {
        count: number(result.cutoff)
      })}
    </p>
    <p class="placement-note">
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
      <button type="button" class="app-button" on:click={() => shareResult(result?.cutoff ?? 0)}
        >{$t$(copied ? 'wordTest.copied' : 'wordTest.share')}</button
      >
      <button type="button" class="app-button app-button-quiet" on:click={start}
        >{$t$('words.placementRetake')}</button
      >
    </div>
  {:else if result}
    <h1 class="placement-title">{$t$('placement.title')}</h1>
    <div class="placement-result">
      <PointBox
        label={$t$('placement.result')}
        figure={$t$('placement.about', { count: number(result.cutoff) })}
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

  .placement-result-text {
    margin-top: 0.75rem;
    max-width: 30rem;
    line-height: 1.7;
  }
</style>
