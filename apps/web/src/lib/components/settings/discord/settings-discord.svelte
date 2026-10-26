<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { findSettingsSection, getSettingsView } from '$lib/components/settings/settings-sections';
  import DiscordActivityEditor from './discord-activity-editor.svelte';
  import { sampleValues } from './discord-sample';
  import {
    addonOrigins,
    addonReadme,
    checkConnection,
    clear,
    discordConnection$,
    discordValues$,
    sendTest,
    type ConnectionState
  } from '$lib/data/discord';
  import {
    activityTemplate,
    discordActivities$,
    discordKinds,
    discordOptions,
    discordOptions$,
    saveActivityTemplate,
    setDiscordOption
  } from '$lib/data/discord-settings';
  import {
    allowAutoPair,
    autoPairAllowed,
    newPairingCode,
    pairAutomatically,
    pairedAddons,
    unpairAddon,
    type PairedAddon
  } from '$lib/data/discord-relay';
  import { buildActivity, type DiscordKind } from '$lib/data/discord-template';
  import { pagePath } from '$lib/data/env';
  import { relativeTime } from '$lib/data/social';
  import {
    HubError,
    hubErrorKey,
    queueProfileChange,
    socialSession$
  } from '$lib/data/social-account';
  import { enabledPlugins$ } from '$lib/plugins/plugin-settings';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { untrack } from 'svelte';

  /**
   * Settings → Discord (boards 1, 4, 4b): the connection to the Anki add-on, the four
   * activities and Away; Edit opens an activity's editor in place of the three sections.
   * The add-on's status is polled only while this is shown (the plugin is on).
   */

  const view = getSettingsView();
  const order = findSettingsSection('discord-connection')?.order ?? 0;

  const states: Record<ConnectionState, { label: MessageKey; detail: MessageKey }> = {
    checking: { label: 'discord.state.checking', detail: 'discord.state.checkingHint' },
    connected: { label: 'discord.state.connected', detail: 'discord.state.connectedHint' },
    missing: { label: 'discord.state.missing', detail: 'discord.state.missingHint' },
    ankiClosed: { label: 'discord.state.ankiClosed', detail: 'discord.state.ankiClosedHint' },
    discordClosed: {
      label: 'discord.state.discordClosed',
      detail: 'discord.state.discordClosedHint'
    },
    blocked: { label: 'discord.state.blocked', detail: 'discord.state.blockedHint' },
    off: { label: 'discord.state.off', detail: 'discord.state.offHint' }
  };
  const kindLabels: Record<DiscordKind, MessageKey> = {
    book: 'discord.kind.book',
    manga: 'discord.kind.manga',
    vn: 'discord.kind.vn',
    idle: 'discord.kind.idle'
  };

  let editing = $state<DiscordKind | null>(null);
  let now = $state(Date.now());
  let howToAllow = $state(false);
  let copied = $state(false);
  let origin = $state('');

  const connection = $derived($discordConnection$);
  const options = $derived(discordOptions($discordOptions$));
  const templates = $derived(
    discordKinds.map((kind) => activityTemplate(kind, $discordActivities$))
  );
  const tone = $derived(
    connection.state === 'connected'
      ? 'ok'
      : connection.state === 'checking' || connection.state === 'off'
        ? 'quiet'
        : 'warn'
  );
  const knownOrigin = $derived(!origin || addonOrigins.includes(origin));
  const showEditor = $derived(
    !!editing && !!$view && !$view.query.trim() && $view.area === 'discord'
  );

  const ago = (time: number | null) =>
    time ? $t$('discord.ago', { time: Math.max(0, Math.round((now - time) / 1000)) }) : '';

  $effect(() => {
    origin = location.origin;
  });

  // Poll GET /v1/status while shown (every 10 s connected, else 30 s: each miss is a browser
  // console line), and again when Show my status changes.
  $effect(() => {
    void options.show;
    checkConnection();

    let ticks = 0;
    const tick = setInterval(() => {
      now = Date.now();
      ticks += 1;
      if (ticks % (discordConnection$.getValue().state === 'connected' ? 10 : 30) === 0) {
        checkConnection();
      }
    }, 1000);

    return () => clearInterval(tick);
  });

  $effect(() => {
    if ($view && $view.area !== 'discord') editing = null;
  });

  async function test() {
    const live = $discordValues$?.kind === 'book' ? $discordValues$ : null;
    const activity = buildActivity(activityTemplate('book'), live?.values ?? sampleValues.book, {
      times: { now: Date.now(), session: Date.now() },
      cover: live?.cover
    });

    if (activity) await sendTest(activity);
    setTimeout(checkConnection, 1500);
  }

  function edit(kind: DiscordKind) {
    editing = kind;
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  // The hub relay (SPEC PR 3c): only with the social plugin on and a hub account.
  const socialOn = $derived($enabledPlugins$.includes('social'));
  const hubReady = $derived(socialOn && !!$socialSession$);
  const presenceProfile = $derived(!!$socialSession$?.me.presenceProfile);
  let addons = $state<PairedAddon[] | null>(null);
  let code = $state<{ code: string; expiresAt: number } | null>(null);
  let codeCopied = $state(false);
  let hubError = $state('');
  let autoTried = false;

  const codeLeft = $derived(
    code ? Math.max(0, Math.ceil((code.expiresAt * 1000 - now) / 1000)) : 0
  );
  const showError = (error: unknown) => (hubError = $t$(hubErrorKey(error)));

  async function loadAddons() {
    try {
      addons = await pairedAddons();
    } catch (error) {
      showError(error);
    }
  }

  $effect(() => {
    if (hubReady) untrack(loadAddons);
    else addons = null;
  });

  // Automatic pairing: signed in, the relay on and this computer's add-on answering unpaired.
  $effect(() => {
    if (
      hubReady &&
      options.relay &&
      connection.state === 'connected' &&
      connection.paired === false &&
      !autoTried &&
      autoPairAllowed()
    ) {
      autoTried = true;
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const platform = nav.userAgentData?.platform || nav.platform;

      pairAutomatically((platform ? `Anki on ${platform}` : 'Anki').slice(0, 40))
        .then(() => {
          loadAddons();
          checkConnection();
        })
        .catch((error) =>
          error instanceof HubError ? showError(error) : (hubError = $t$('discord.pairFailed'))
        );
    }
  });

  $effect(() => {
    if (code && !codeLeft) code = null;
  });

  // While a code is shown, look for the add-on it pairs (every 15 s, the hub's keys list).
  $effect(() => {
    if (!code) return;

    const count = untrack(() => addons?.length ?? 0);
    const poll = setInterval(async () => {
      const list = await pairedAddons().catch(() => null);

      if (list && list.length > count) {
        addons = list;
        code = null;
      }
    }, 15_000);

    return () => clearInterval(poll);
  });

  async function startCode() {
    hubError = '';
    try {
      code = await newPairingCode();
    } catch (error) {
      showError(error);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code?.code ?? '');
      codeCopied = true;
      setTimeout(() => (codeCopied = false), 2000);
    } catch {
      // Clipboard refused: the code stays selectable.
    }
  }

  async function unpair(addon: PairedAddon) {
    hubError = '';
    try {
      await unpairAddon(addon.id);
      addons = (addons ?? []).filter((other) => other.id !== addon.id);
      checkConnection();
    } catch (error) {
      showError(error);
    }
  }

  const countdown = $derived(
    `${Math.floor(codeLeft / 60)}:${String(codeLeft % 60).padStart(2, '0')}`
  );

  async function copyOrigin() {
    try {
      await navigator.clipboard.writeText(origin);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard refused: the address stays selectable.
    }
  }
</script>

{#if showEditor && editing}
  <div class="discord-editor" style:order>
    <DiscordActivityEditor kind={editing} onback={() => (editing = null)} />
  </div>
{:else}
  <SettingsSection id="discord-connection" keywords="discord rich presence rpc anki add-on status">
    <div class="status" data-settings-item>
      <div class="status-text" aria-live="polite">
        <p class="status-label">
          <span class="status-dot status-dot-{tone}" aria-hidden="true"></span>
          {$t$(states[connection.state].label)}
        </p>
        <p class="status-detail">
          {$t$(states[connection.state].detail)}
          {#if connection.state === 'connected' && connection.lastSent}
            · {$t$('discord.lastSent', { ago: ago(connection.lastSent) })}
          {/if}
        </p>
      </div>
      <div class="status-actions">
        {#if connection.state === 'connected' || connection.state === 'missing'}
          <button
            type="button"
            class="app-button"
            disabled={connection.state !== 'connected'}
            onclick={test}
          >
            {$t$('discord.sendTest')}
          </button>
          <button
            type="button"
            class="app-button app-button-quiet"
            disabled={connection.state !== 'connected'}
            onclick={() => clear()}
          >
            {$t$('discord.clearStatus')}
          </button>
        {:else if connection.state === 'blocked'}
          <button
            type="button"
            class="app-button app-button-quiet"
            aria-expanded={howToAllow}
            onclick={() => (howToAllow = !howToAllow)}
          >
            {$t$('discord.howToAllow')}
          </button>
          <button type="button" class="app-button" onclick={checkConnection}>
            {$t$('discord.checkAgain')}
          </button>
        {:else if connection.state === 'ankiClosed' || connection.state === 'discordClosed'}
          <button type="button" class="app-button" onclick={checkConnection}>
            {$t$('discord.checkAgain')}
          </button>
        {/if}
      </div>
      {#if connection.state === 'blocked' && howToAllow}
        <p class="status-help">{$t$('discord.howToAllowText')}</p>
      {/if}
    </div>

    {#if connection.state === 'missing'}
      <div class="setup" data-settings-item>
        <h3>{$t$('discord.setup')}</h3>
        <ol>
          <li>
            <span class="setup-step">1</span>
            <div>
              <p>{$t$('discord.setup1')}</p>
              <p class="setup-note">
                <a href={addonReadme} target="_blank" rel="noopener noreferrer">
                  {$t$('discord.setupReadme')}
                </a>
                ·
                <a
                  href="https://ankiweb.net/shared/info/25885905"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {$t$('discord.ankiWebCode', { code: '25885905' })}
                </a>
              </p>
            </div>
          </li>
          {#if !knownOrigin}
            <li>
              <span class="setup-step">2</span>
              <div>
                <p>{$t$('discord.setupOrigin')}</p>
                <div class="setup-copy">
                  <input
                    class="app-input"
                    readonly
                    value={origin}
                    aria-label={$t$('discord.siteAddress')}
                  />
                  <button type="button" class="app-button" onclick={copyOrigin}>
                    {$t$(copied ? 'discord.copied' : 'discord.copy')}
                  </button>
                </div>
              </div>
            </li>
          {/if}
          <li>
            <span class="setup-step">{knownOrigin ? 2 : 3}</span>
            <p>{$t$('discord.setup2')}</p>
          </li>
          <li>
            <span class="setup-step">{knownOrigin ? 3 : 4}</span>
            <p>{$t$('discord.setup3')}</p>
          </li>
        </ol>
        <div class="setup-check">
          <button type="button" class="app-button app-button-primary" onclick={checkConnection}>
            {$t$('discord.checkAgain')}
          </button>
          {#if connection.checkedAt}
            <span class="setup-note"
              >{$t$('discord.lastChecked', { ago: ago(connection.checkedAt) })}</span
            >
          {/if}
        </div>
      </div>
    {/if}

    <SettingsItemGroup title={$t$('discord.showStatus')} tooltip={$t$('discord.showStatusHint')}>
      <button
        type="button"
        role="switch"
        class="app-switch"
        aria-checked={options.show}
        aria-label={$t$('discord.showStatus')}
        onclick={() => setDiscordOption('show', !options.show)}
      >
        <span class="app-switch-thumb"></span>
        <span class="app-switch-text">{$t$(options.show ? 'settings.on' : 'settings.off')}</span>
      </button>
    </SettingsItemGroup>

    {#if hubReady}
      <SettingsItemGroup
        title={$t$('discord.addon')}
        tooltip={$t$(
          code
            ? 'discord.addonCodeHint'
            : addons?.length
              ? 'discord.addonPairedHint'
              : 'discord.addonUnpairedHint'
        )}
      >
        {#if code}
          <div class="pair-code">
            <div class="pair-code-row">
              <input
                class="app-input pair-code-input"
                readonly
                value={code.code}
                aria-label={$t$('discord.pairWithCode')}
              />
              <button type="button" class="app-button" onclick={copyCode}>
                {$t$(codeCopied ? 'discord.copied' : 'discord.copy')}
              </button>
              <button
                type="button"
                class="app-button app-button-quiet"
                onclick={() => (code = null)}
              >
                {$t$('discord.cancel')}
              </button>
            </div>
            <p class="pair-note">{$t$('discord.expiresIn', { time: countdown })}</p>
          </div>
        {:else}
          <div class="addons">
            {#each addons ?? [] as addon (addon.id)}
              <div class="addon">
                <span class="addon-name">{addon.name}</span>
                <span class="addon-seen">
                  {addon.lastSeen
                    ? $t$('discord.seen', { ago: relativeTime(addon.lastSeen, $uiLanguage$) })
                    : $t$('discord.notSeen')}
                </span>
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  aria-label={$t$('discord.unpairName', { name: addon.name })}
                  onclick={() => unpair(addon)}
                >
                  {$t$('discord.unpair')}
                </button>
              </div>
            {/each}
            <button
              type="button"
              class="app-button"
              class:app-button-quiet={!!addons?.length}
              onclick={startCode}
            >
              {$t$('discord.pairWithCode')}
            </button>
          </div>
        {/if}
      </SettingsItemGroup>
    {/if}

    <SettingsItemGroup title={$t$('discord.relay')} tooltip={$t$('discord.relayHint')}>
      {#if hubReady}
        <button
          type="button"
          role="switch"
          class="app-switch"
          aria-checked={options.relay}
          aria-label={$t$('discord.relay')}
          onclick={() => {
            if (!options.relay) allowAutoPair();
            setDiscordOption('relay', !options.relay);
          }}
        >
          <span class="app-switch-thumb"></span>
          <span class="app-switch-text">{$t$(options.relay ? 'settings.on' : 'settings.off')}</span>
        </button>
      {:else}
        <a
          class="app-button app-button-quiet"
          href={socialOn
            ? `${pagePath}/settings?section=social#social-account`
            : `${pagePath}/settings?section=general#general-plugins`}
        >
          {$t$(socialOn ? 'discord.signInToSocial' : 'discord.turnOnSocial')}
        </a>
      {/if}
    </SettingsItemGroup>

    {#if hubReady}
      <SettingsItemGroup title={$t$('discord.profile')} tooltip={$t$('discord.profileHint')}>
        <button
          type="button"
          role="switch"
          class="app-switch"
          aria-checked={presenceProfile}
          aria-label={$t$('discord.profile')}
          onclick={() => queueProfileChange({ presenceProfile: !presenceProfile }, showError)}
        >
          <span class="app-switch-thumb"></span>
          <span class="app-switch-text"
            >{$t$(presenceProfile ? 'settings.on' : 'settings.off')}</span
          >
        </button>
      </SettingsItemGroup>
    {/if}
    {#if hubError}<p class="hub-error" role="alert">{hubError}</p>{/if}
    <p class="phone-note">{$t$('discord.phoneNote')}</p>
  </SettingsSection>

  <SettingsSection id="discord-activities" keywords="activity template variables" count={4}>
    <table class="activities" data-settings-item>
      <thead>
        <tr>
          <th scope="col">{$t$('discord.activity')}</th>
          <th scope="col" class="activities-name">{$t$('discord.name')}</th>
          <th scope="col">{$t$('discord.show')}</th>
          <th scope="col"><span class="sr-only">{$t$('discord.edit')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each discordKinds as kind, i (kind)}
          {@const template = templates[i]}
          <tr>
            <th scope="row">{$t$(kindLabels[kind])}</th>
            <td class="activities-name">{template.name}</td>
            <td>
              <button
                type="button"
                role="switch"
                class="app-switch"
                aria-checked={template.show}
                aria-label="{$t$('discord.show')}: {$t$(kindLabels[kind])}"
                onclick={() => saveActivityTemplate(kind, { ...template, show: !template.show })}
              >
                <span class="app-switch-thumb"></span>
              </button>
            </td>
            <td class="activities-edit">
              <button type="button" class="app-button app-button-quiet" onclick={() => edit(kind)}>
                {$t$('discord.edit')}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </SettingsSection>

  <SettingsSection id="discord-away" keywords="away idle minutes">
    <SettingsItemGroup title={$t$('discord.awayAfter')} tooltip={$t$('discord.awayAfterHint')}>
      <span class="away-minutes">
        <input
          type="number"
          class="app-input"
          min="1"
          max="240"
          aria-label={$t$('discord.awayAfter')}
          value={options.awayMinutes}
          onchange={(event) =>
            setDiscordOption(
              'awayMinutes',
              Math.min(240, Math.max(1, Math.round(Number(event.currentTarget.value)) || 10))
            )}
        />
        {$t$('discord.minutes')}
      </span>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('discord.whenAway')} tooltip={$t$('discord.whenAwayHint')}>
      <div class="app-segmented" role="radiogroup" aria-label={$t$('discord.whenAway')}>
        {#each [true, false] as idle (idle)}
          <button
            type="button"
            role="radio"
            class="app-segment"
            class:app-segment-selected={options.awayIdle === idle}
            aria-checked={options.awayIdle === idle}
            onclick={() => setDiscordOption('awayIdle', idle)}
          >
            {$t$(idle ? 'discord.awayIdle' : 'discord.awayNothing')}
          </button>
        {/each}
      </div>
    </SettingsItemGroup>
  </SettingsSection>
{/if}

<style>
  .discord-editor {
    min-width: 0;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 2rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .status-text {
    min-width: 0;
  }

  .status-label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: var(--type-body);
  }

  .status-dot {
    width: 0.6rem;
    height: 0.6rem;
    flex: none;
    border-radius: 1px;
  }

  .status-dot-ok {
    background: var(--accent-color);
  }

  .status-dot-warn {
    background: var(--app-warning-color);
  }

  .status-dot-quiet {
    background: var(--app-muted-fg);
  }

  .status-detail,
  .status-help {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .status-help {
    flex-basis: 100%;
  }

  .status-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .setup {
    margin: 0.75rem 0;
    padding: 1.25rem 1.5rem;
    border-radius: 2px;
    background: var(--surface-color);
  }

  .setup h3 {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .setup ol {
    display: grid;
    gap: 0.9rem;
    margin: 1rem 0;
  }

  .setup li {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .setup-step {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .setup li p {
    font-size: var(--type-body);
    line-height: 1.5;
  }

  .setup .setup-note,
  .setup-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .setup-note a {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .setup-copy {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .setup-copy .app-input {
    width: min(100%, 18rem);
  }

  .setup-check {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  .pair-code {
    display: grid;
    gap: 0.4rem;
  }

  .pair-code-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .pair-code-input {
    width: 11rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .pair-note,
  .addon-seen,
  .hub-error {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hub-error {
    padding-top: 0.75rem;
    color: var(--app-danger-color);
  }

  .addons {
    display: grid;
    justify-items: end;
    gap: 0.4rem;
  }

  .addon {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 0.25rem 0.75rem;
  }

  .addon-name {
    font-size: var(--type-body);
  }

  .phone-note {
    display: none;
    padding-top: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .activities {
    width: 100%;
    margin-top: 1rem;
    border-top: 2px solid var(--font-color);
    border-collapse: collapse;
  }

  .activities th,
  .activities td {
    padding: 0.7rem 0.75rem 0.7rem 0;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    vertical-align: middle;
  }

  .activities thead th {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 400;
  }

  .activities tbody th {
    font-size: var(--type-body);
    font-weight: 400;
    white-space: nowrap;
  }

  .activities td.activities-name {
    max-width: 18rem;
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-body);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activities .activities-edit {
    padding-right: 0;
    text-align: right;
  }

  .away-minutes {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--app-muted-fg);
  }

  .away-minutes .app-input {
    width: 5rem;
  }

  @media (max-width: 640px) {
    .phone-note {
      display: block;
    }

    .addons {
      justify-items: start;
    }

    .addon {
      justify-content: flex-start;
    }

    .activities .activities-name {
      display: none;
    }

    .setup {
      padding: 1rem;
    }
  }
</style>
