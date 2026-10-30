<script lang="ts">
  import { faPaperPlane, faSpinner, faXmark } from '@fortawesome/free-solid-svg-icons';
  import AiLanguageToggle from '$lib/components/ai-language-toggle.svelte';
  import { presetsForLanguage } from '$lib/data/ai-prompts';
  import {
    aiLanguage$,
    askAiDefaultPreset$,
    askAiPresets$,
    modelShortName,
    type AskAiPreset
  } from '$lib/data/ai-settings';
  import { aiFeatureState$, isReady } from '$lib/data/ai-connections';
  import {
    askAi,
    buildPassagePrompt,
    type ChatMessage,
    type PassageContext
  } from '$lib/data/ask-ai';
  import { pagePath } from '$lib/data/env';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';
  import { renderBasicMarkdown } from '$lib/functions/basic-markdown';

  export let passage: PassageContext;

  const dispatch = createEventDispatcher<{ close: void }>();

  interface Exchange {
    question: string;
    answer: string;
    error?: string;
  }

  let messages: ChatMessage[] = [];
  let exchanges: Exchange[] = [];
  let question = '';
  let busy = false;
  let abortController = new AbortController();
  let answersElm: HTMLElement;

  $: presets = presetsForLanguage($askAiPresets$, $aiLanguage$);
  $: ready = isReady($aiFeatureState$.ask);
  $: model = $aiFeatureState$.ask.model;

  onMount(() => {
    const preset = presets.find((p) => p.id === $askAiDefaultPreset$);

    if (preset && ready) {
      runPreset(preset);
    }
  });

  onDestroy(() => abortController.abort());

  function runPreset(preset: AskAiPreset) {
    ask(preset.prompt, preset.label);
  }

  /** `label` is shown instead of a long preset prompt. */
  async function ask(text: string, label = text) {
    if (busy) {
      return;
    }

    const content = messages.length ? text : buildPassagePrompt(passage, text);
    const exchangeIndex = exchanges.length;
    const requestMessages: ChatMessage[] = [...messages, { role: 'user', content }];

    exchanges = [...exchanges, { question: label, answer: '' }];
    question = '';
    busy = true;

    try {
      messages = await askAi(
        requestMessages,
        (answer) => {
          updateExchange(exchangeIndex, { answer });
          answersElm?.scrollTo({ top: answersElm.scrollHeight });
        },
        abortController.signal
      );
    } catch (error) {
      if (!abortController.signal.aborted) {
        updateExchange(exchangeIndex, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      busy = false;
    }
  }

  function updateExchange(index: number, update: Partial<Exchange>) {
    exchanges = exchanges.map((exchange, i) =>
      i === index ? { ...exchange, ...update } : exchange
    );
  }

  function close() {
    abortController.abort();
    dispatch('close');
  }
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-label={$t$('reader.askAi')}>
  <header class="ask-head">
    <h2>{$t$('reader.askAi')}</h2>
    <button class="ask-close" title={$t$('reader.close')} on:click={close}
      ><Fa icon={faXmark} /></button
    >
  </header>
  <div class="panel-meta">
    <span class="panel-meta-text" title={model}>{modelShortName(model)}</span>
    <AiLanguageToggle compact />
  </div>

  <div class="panel-body flex-1 overflow-y-auto py-3" bind:this={answersElm}>
    <blockquote class="reader-panel-quote mb-3 border-l pl-3 opacity-80" lang="ja">
      {passage.selection}
    </blockquote>
    {#if !ready}
      <p class="panel-note mb-3">
        {$t$('reader.askAiNeedsKey')}
        <a
          class="app-button app-button-quiet"
          href="{pagePath}/settings?section=ai#ai-connections"
          target="_blank"
          rel="noreferrer">{$t$('reader.setupGuide')} →</a
        >
      </p>
    {/if}
    {#each exchanges as exchange, index (index)}
      {#if exchange.question}
        <p class="mt-4 mb-2 font-semibold">{exchange.question}</p>
      {/if}
      {#if exchange.error}
        <p class="text-panel-danger">{exchange.error}</p>
      {:else if exchange.answer}
        <div class="answer whitespace-pre-wrap leading-relaxed">
          {@html renderBasicMarkdown(exchange.answer)}
        </div>
      {:else}
        <Fa icon={faSpinner} spin />
      {/if}
    {/each}
  </div>

  {#if presets.length}
    <div
      class="panel-body flex flex-wrap gap-1.5 pb-2"
      role="group"
      aria-label={$t$('reader.quickQuestions')}
    >
      {#each presets as preset (preset.id)}
        <button
          type="button"
          class="reader-panel-chip rounded-sm px-3 py-1 text-small font-semibold"
          title={preset.prompt}
          disabled={busy}
          on:click={() => runPreset(preset)}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  {/if}

  <form
    class="panel-body reader-panel-divider flex gap-2 border-t py-3"
    on:submit|preventDefault={() => question.trim() && ask(question.trim())}
  >
    <input
      class="reader-panel-input min-w-0 flex-1 rounded px-3 py-2"
      placeholder={$t$(exchanges.length ? 'reader.askFollowUp' : 'reader.askPassage')}
      bind:value={question}
      disabled={busy}
    />
    <button class="px-2" title={$t$('reader.send')} disabled={busy || !question.trim()}>
      <Fa icon={faPaperPlane} />
    </button>
  </form>
</section>

<style>
  /* Same as the reader panel's tab header: title and close */
  .ask-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 1rem;
    padding: 0.9rem 0 0.6rem;
    border-bottom: 2px solid var(--reader-panel-fg);
  }

  .ask-head h2 {
    flex: 1;
    margin: 0;
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .ask-close {
    display: inline-flex;
    width: 2.75rem;
    height: 2.75rem;
    margin: -0.6rem -0.75rem -0.6rem 0;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }

  .ask-close:hover {
    color: var(--reader-panel-fg);
  }

  @media (min-width: 768px) {
    .ask-head {
      margin: 0 1.5rem;
      padding-top: 1.4rem;
    }
  }

  .answer :global(code) {
    padding: 0 0.2rem;
    border-radius: 0.2rem;
    background: color-mix(in srgb, var(--reader-panel-fg) 10%, transparent);
  }
</style>
