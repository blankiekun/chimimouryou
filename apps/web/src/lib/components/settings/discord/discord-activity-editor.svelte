<script lang="ts">
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import SectionHead from '$lib/components/section-head.svelte';
  import DiscordPreview from './discord-preview.svelte';
  import DiscordTemplateField from './discord-template-field.svelte';
  import { sampleValues } from './discord-sample';
  import { discordValues$ } from '$lib/data/discord';
  import {
    activityTemplate,
    defaultTemplate,
    discordOptions,
    discordOptions$,
    discordPresetNames,
    matchingPreset,
    presetFields,
    saveActivityTemplate,
    setDiscordOption,
    type DiscordPreset
  } from '$lib/data/discord-settings';
  import {
    activityProblems,
    buildActivity,
    discordLimits,
    partyVariables,
    type DiscordKind,
    type LargeImage,
    type SmallImage,
    type TimestampMode
  } from '$lib/data/discord-template';
  import { relayLastSent$ } from '$lib/data/discord-relay';
  import { relativeTime } from '$lib/functions/format-time';
  import { socialSession$ } from '$lib/data/social-account';
  import { enabledPlugins$ } from '$lib/plugins/plugin-settings';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';

  /** One activity's editor (boards 2, 3, 5, 6): every field, saved as it is typed. */
  let { kind, onback }: { kind: DiscordKind; onback: () => void } = $props();

  const kindLabels: Record<DiscordKind, MessageKey> = {
    book: 'discord.kind.book',
    manga: 'discord.kind.manga',
    vn: 'discord.kind.vn',
    idle: 'discord.kind.idle'
  };
  const presetLabels: Record<DiscordPreset, MessageKey> = {
    minimal: 'discord.preset.minimal',
    progress: 'discord.preset.progress',
    everything: 'discord.preset.everything'
  };
  const largeOptions: { id: LargeImage; label: MessageKey }[] = [
    { id: 'logo', label: 'discord.image.logo' },
    { id: 'cover', label: 'discord.image.cover' },
    { id: 'custom', label: 'discord.image.custom' }
  ];
  const smallOptions: { id: SmallImage; label: MessageKey }[] = [
    { id: 'none', label: 'discord.image.none' },
    { id: 'logo', label: 'discord.image.logo' },
    { id: 'custom', label: 'discord.image.custom' }
  ];
  const timestampOptions: { id: TimestampMode; label: MessageKey }[] = [
    { id: 'none', label: 'discord.time.none' },
    { id: 'session', label: 'discord.time.session' },
    { id: 'opened', label: 'discord.time.opened' },
    { id: 'chapterLeft', label: 'discord.time.chapterLeft' },
    { id: 'bookLeft', label: 'discord.time.bookLeft' }
  ];

  // svelte-ignore state_referenced_locally
  let template = $state(activityTemplate(kind));
  let now = $state(Date.now());

  const reading = $derived(kind !== 'idle');
  const live = $derived($discordValues$?.kind === kind ? $discordValues$ : null);
  const values = $derived(live?.values ?? sampleValues[kind]);
  const options = $derived(discordOptions($discordOptions$));
  const hideTitles = $derived(options.hideTitles);
  const hubReady = $derived($enabledPlugins$.includes('social') && !!$socialSession$);
  const preset = $derived(matchingPreset(kind, template));
  const problems = $derived(activityProblems(template, values).length);
  const activity = $derived(
    template.show
      ? buildActivity(template, values, {
          times: {
            now,
            session: now - 134_000,
            opened: now - 3_600_000,
            chapterLeft: 720,
            bookLeft: 34_800
          },
          cover: live?.cover,
          private: reading && hideTitles
        })
      : undefined
  );
  const userName = $derived($socialSession$?.me.name || $socialSession$?.me.username || 'You');

  $effect(() => {
    const next = $state.snapshot(template);

    if (JSON.stringify(next) !== JSON.stringify(activityTemplate(kind))) {
      saveActivityTemplate(kind, next);
    }
  });

  $effect(() => {
    const tick = setInterval(() => (now = Date.now()), 30_000);

    return () => clearInterval(tick);
  });

  function applyPreset(name: DiscordPreset) {
    template = { ...template, ...presetFields(kind, name) };
  }

  function reset() {
    template = { ...defaultTemplate(kind), show: template.show };
  }
</script>

<div class="editor">
  <button type="button" class="app-button app-button-quiet editor-back" onclick={onback}>
    <Fa icon={faArrowLeft} />
    {$t$('settings.area.discord')}
  </button>
  <header class="editor-head">
    <div>
      <h2>{$t$(kindLabels[kind])}</h2>
      <!-- Only Idle needs saying: book variables stay empty there. -->
      {#if kind === 'idle'}<p>{$t$('discord.kindHint.idle')}</p>{/if}
      <p class="editor-phone">{$t$('discord.phoneNote')}</p>
    </div>
    <button
      type="button"
      role="switch"
      class="app-switch"
      aria-checked={template.show}
      onclick={() => (template.show = !template.show)}
    >
      <span>{$t$('discord.show')}</span>
      <span class="app-switch-thumb"></span>
    </button>
  </header>

  {#if hubReady}
    <!-- Board 5: on phones the hub relay is what reaches Discord. -->
    <div class="editor-relay">
      <div>
        <p class="editor-relay-title">{$t$('discord.relayPhone')}</p>
        <p class="editor-relay-note">
          {#if options.relay && $relayLastSent$}
            {$t$('discord.lastSent', {
              ago: relativeTime($relayLastSent$ / 1000, $uiLanguage$)
            })}
          {:else}
            {$t$('discord.relayPhoneHint')}
          {/if}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        class="app-switch"
        aria-checked={options.relay}
        aria-label={$t$('discord.relayPhone')}
        onclick={() => setDiscordOption('relay', !options.relay)}
      >
        <span class="app-switch-thumb"></span>
      </button>
    </div>
  {/if}

  <div class="editor-layout">
    <div class="editor-preview">
      <DiscordPreview {activity} source={live ? (values.title ?? '') : ''} {userName} {problems} />
    </div>

    <div class="editor-form">
      <div class="editor-presets">
        <span>{$t$('discord.startFrom')}</span>
        <div class="app-segmented" role="radiogroup" aria-label={$t$('discord.startFrom')}>
          {#each discordPresetNames as name (name)}
            <button
              type="button"
              role="radio"
              class="app-segment"
              class:app-segment-selected={preset === name}
              aria-checked={preset === name}
              onclick={() => applyPreset(name)}
            >
              {$t$(presetLabels[name])}
            </button>
          {/each}
        </div>
      </div>

      <section class="editor-section">
        <SectionHead number={1} title={$t$('discord.text')} level="h3" />
        <DiscordTemplateField
          id="discord-name"
          label={$t$('discord.name')}
          {values}
          bind:value={template.name}
        />
        <div class="editor-rule"></div>
        <DiscordTemplateField
          id="discord-details"
          label={$t$('discord.details')}
          {values}
          bind:value={template.details}
        />
        <DiscordTemplateField
          id="discord-details-url"
          label={$t$('discord.link')}
          placeholder={$t$('discord.linkPlaceholder')}
          link
          small
          {values}
          bind:value={template.detailsUrl}
        />
        <div class="editor-rule"></div>
        <DiscordTemplateField
          id="discord-state"
          label={$t$('discord.state')}
          {values}
          bind:value={template.state}
        />
        <DiscordTemplateField
          id="discord-state-url"
          label={$t$('discord.link')}
          placeholder={$t$('discord.linkPlaceholder')}
          link
          small
          {values}
          bind:value={template.stateUrl}
        />
      </section>

      <section class="editor-section">
        <SectionHead number={2} title={$t$('discord.images')} level="h3" />
        <div class="editor-field">
          <span class="editor-label">{$t$('discord.largeImage')}</span>
          <div class="app-segmented" role="radiogroup" aria-label={$t$('discord.largeImage')}>
            {#each largeOptions.filter((option) => reading || option.id !== 'cover') as option (option.id)}
              <button
                type="button"
                role="radio"
                class="app-segment"
                class:app-segment-selected={template.largeImage === option.id}
                aria-checked={template.largeImage === option.id}
                onclick={() => (template.largeImage = option.id)}
              >
                {$t$(option.label)}
              </button>
            {/each}
          </div>
          {#if template.largeImage === 'cover'}
            <p class="editor-hint">{$t$('discord.coverHint')}</p>
          {:else if template.largeImage === 'custom'}
            <input
              class="app-input editor-input"
              placeholder={$t$('discord.customImage')}
              aria-label={$t$('discord.customImage')}
              bind:value={template.largeCustom}
            />
          {/if}
        </div>
        <DiscordTemplateField
          id="discord-large-text"
          label={$t$('discord.hoverText')}
          small
          {values}
          bind:value={template.largeText}
        />
        <div class="editor-rule"></div>
        <div class="editor-field">
          <span class="editor-label">{$t$('discord.smallImage')}</span>
          <div class="app-segmented" role="radiogroup" aria-label={$t$('discord.smallImage')}>
            {#each smallOptions as option (option.id)}
              <button
                type="button"
                role="radio"
                class="app-segment"
                class:app-segment-selected={template.smallImage === option.id}
                aria-checked={template.smallImage === option.id}
                onclick={() => (template.smallImage = option.id)}
              >
                {$t$(option.label)}
              </button>
            {/each}
          </div>
          {#if template.smallImage === 'custom'}
            <input
              class="app-input editor-input"
              placeholder={$t$('discord.customImage')}
              aria-label={$t$('discord.customImage')}
              bind:value={template.smallCustom}
            />
          {/if}
        </div>
        {#if template.smallImage !== 'none'}
          <DiscordTemplateField
            id="discord-small-text"
            label={$t$('discord.hoverText')}
            small
            {values}
            bind:value={template.smallText}
          />
        {/if}
      </section>

      <section class="editor-section">
        <SectionHead
          number={3}
          title={$t$(reading ? 'discord.timeAndParty' : 'discord.time')}
          level="h3"
        />
        <div class="editor-field">
          <label for="discord-timestamp">{$t$('discord.timestamp')}</label>
          <select
            id="discord-timestamp"
            class="app-input editor-select"
            bind:value={template.timestamp}
          >
            {#each timestampOptions.filter((option) => reading || option.id === 'none' || option.id === 'session') as option (option.id)}
              <option value={option.id}>{$t$(option.label)}</option>
            {/each}
          </select>
        </div>
        {#if reading}
          <div class="editor-rule"></div>
          <div class="editor-field">
            <div class="editor-row">
              <div>
                <span id="discord-party-label">{$t$('discord.party')}</span>
              </div>
              <button
                type="button"
                role="switch"
                class="app-switch"
                aria-checked={template.party}
                aria-labelledby="discord-party-label"
                onclick={() => (template.party = !template.party)}
              >
                <span class="app-switch-thumb"></span>
              </button>
            </div>
            {#if template.party}
              <div class="editor-party">
                <select
                  class="app-input editor-select"
                  aria-label={$t$('discord.partyCurrent')}
                  bind:value={template.partyCurrent}
                >
                  {#each partyVariables as name (name)}<option value={name}>{`{${name}}`}</option
                    >{/each}
                </select>
                <span>{$t$('discord.of')}</span>
                <select
                  class="app-input editor-select"
                  aria-label={$t$('discord.partyMax')}
                  bind:value={template.partyMax}
                >
                  {#each partyVariables as name (name)}<option value={name}>{`{${name}}`}</option
                    >{/each}
                </select>
              </div>
            {/if}
          </div>
        {/if}
      </section>

      <section class="editor-section">
        <SectionHead
          number={4}
          title={$t$('discord.buttons')}
          count={$t$('discord.buttonCount', { count: template.buttons.length })}
          level="h3"
        />
        {#each template.buttons as button, i (i)}
          <div class="editor-button">
            <div class="editor-row">
              <span class="editor-button-title">{$t$('discord.button', { number: i + 1 })}</span>
              <button
                type="button"
                class="app-button app-button-quiet editor-remove"
                onclick={() => (template.buttons = template.buttons.filter((_, j) => j !== i))}
              >
                {$t$('discord.remove')}
              </button>
            </div>
            <div class="editor-button-fields">
              <label class="editor-button-label">
                <span>{$t$('discord.label')}</span>
                <input
                  class="app-input"
                  maxlength={discordLimits.label}
                  bind:value={button.label}
                />
                <span class="editor-hint">{[...button.label].length} / {discordLimits.label}</span>
              </label>
              <DiscordTemplateField
                id="discord-button-{i}"
                label={$t$('discord.link')}
                hint={$t$('discord.buttonLinkHint')}
                placeholder="https://"
                link
                small
                {values}
                bind:value={button.url}
              />
            </div>
          </div>
        {/each}
        <div class="editor-add">
          <button
            type="button"
            class="app-button"
            disabled={template.buttons.length >= discordLimits.buttons}
            onclick={() => (template.buttons = [...template.buttons, { label: '', url: '' }])}
          >
            {$t$('discord.addButton')}
          </button>
          <span class="editor-hint">{$t$('discord.buttonsMax')}</span>
        </div>
      </section>

      {#if reading}
        <section class="editor-section">
          <SectionHead number={5} title={$t$('discord.privacy')} level="h3" />
          <div class="editor-field">
            <label for="discord-privacy">{$t$('discord.privacyText')}</label>
            <input
              id="discord-privacy"
              class="app-input editor-input"
              maxlength={discordLimits.text}
              bind:value={template.privacyText}
            />
          </div>
          <div class="editor-rule"></div>
          <div class="editor-field editor-row">
            <div>
              <span id="discord-hide-titles">{$t$('discord.hideTitles')}</span>
            </div>
            <button
              type="button"
              role="switch"
              class="app-switch"
              aria-checked={hideTitles}
              aria-labelledby="discord-hide-titles"
              onclick={() => setDiscordOption('hideTitles', !hideTitles)}
            >
              <span class="app-switch-thumb"></span>
            </button>
          </div>
        </section>
      {/if}

      <div class="editor-reset">
        <button type="button" class="app-button app-button-danger" onclick={reset}>
          {$t$('discord.reset')}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }

  .editor-back {
    justify-self: start;
  }

  .editor-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .editor-head h2 {
    font-size: var(--type-h1);
    font-weight: 400;
    line-height: 1.25;
  }

  .editor-head p {
    margin-top: 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .editor-phone,
  .editor-relay {
    display: none;
  }

  .editor-relay {
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
  }

  .editor-relay-title {
    font-size: var(--type-body);
  }

  .editor-relay-note {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .editor-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
    align-items: start;
    gap: 2.5rem;
  }

  .editor-preview {
    position: sticky;
    top: 5.5rem;
    grid-column: 2;
    grid-row: 1;
  }

  .editor-form {
    display: grid;
    grid-column: 1;
    grid-row: 1;
    gap: 2rem;
    min-width: 0;
  }

  .editor-presets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .editor-section {
    display: grid;
    min-width: 0;
  }

  .editor-rule {
    margin-top: 0.75rem;
    border-top: 1px solid var(--border-color);
  }

  .editor-field {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    margin: 0;
    padding: 1rem 0 0.5rem;
    border: 0;
  }

  .editor-field .editor-label,
  .editor-field > label {
    margin-bottom: 0.5rem;
    padding: 0;
    font-size: var(--type-body);
  }

  .editor-input {
    width: 100%;
  }

  .editor-select {
    width: min(100%, 16rem);
  }

  .editor-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .editor-hint {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    line-height: 1.5;
  }

  .editor-party {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--app-muted-fg);
  }

  .editor-party .editor-select {
    width: 13rem;
    min-width: 0;
  }

  .editor-button {
    padding: 1rem 0 0.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .editor-button-title {
    font-size: var(--type-body);
  }

  .editor-remove {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .editor-button-fields {
    display: grid;
    grid-template-columns: minmax(0, 12rem) minmax(0, 1fr);
    align-items: start;
    gap: 0 0.75rem;
  }

  .editor-button-label {
    display: grid;
    gap: 0.4rem;
    padding-top: 0.25rem;
  }

  .editor-button-label > span:first-child {
    min-height: 1.75rem;
    display: flex;
    align-items: center;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .editor-add,
  .editor-reset {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding-top: 1rem;
  }

  .editor-reset {
    padding-top: 1.25rem;
    border-top: 1px solid var(--border-color);
  }

  @media (max-width: 1100px) {
    .editor-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }

    .editor-preview {
      position: static;
      grid-column: 1;
      grid-row: auto;
      order: -1;
    }

    .editor-form {
      grid-row: auto;
    }
  }

  @media (max-width: 640px) {
    .editor-phone {
      display: block;
    }

    .editor-relay {
      display: flex;
    }

    .editor-button-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
