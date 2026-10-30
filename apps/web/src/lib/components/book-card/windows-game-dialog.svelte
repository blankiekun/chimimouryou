<script lang="ts">
  /**
   * Import → Windows game: a game folder is copied into this browser (windows-game.ts) and
   * added to the library as a visual novel that VNBox plays. Pick the folder (or a ZIP of it:
   * phones can't pick folders, zipGameFiles), the program to
   * run and, optionally, a dc00 text hook script; then the copy runs with its progress here.
   * "This game is already in my library" copies the folder for a game whose record synced from
   * another device but whose files aren't here: its record (program, hook, cover) is kept.
   * A disc image, or a folder (or ZIP) holding an installer or disc images, is installed instead
   * (windows-install.ts): the installer runs in a player frame here, then the program it
   * installed is picked.
   */
  import { database } from '$lib/data/store';
  import { isMobile$ } from '$lib/functions/utils';
  import type { VnInfo } from '$lib/data/vn';
  import SectionHead from '$lib/components/section-head.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { formatBytes } from '$lib/data/vn-upload';
  import { deleteSaves, listSaves, vnSaveAreas } from '$lib/data/vn-save-store';
  import {
    copyWindowsGame,
    deleteWindowsGame,
    folderInputFiles,
    hasWindowsGame,
    hookScripts,
    hookSuggestion,
    missingWindowsGames,
    readHandle,
    readHead,
    roomFor,
    searchHookScripts,
    windowsGameBlocker,
    windowsGameBlockerText,
    windowsGameBook,
    windowsGameFolder,
    windowsPrograms,
    vnboxZipsSize,
    zipGameFiles
  } from '$lib/data/windows-game';
  import type { HookScript } from '$lib/data/windows-game';
  import {
    besideMsi,
    copyDiscs,
    copyProtection,
    discDrive,
    discFilePattern,
    discPath,
    discSetup,
    discsOf,
    folderDiscs,
    folderSetup,
    installDir,
    installedPrograms,
    prefixSnapshot,
    installerKind,
    installerNames,
    installUrl,
    listDisc,
    moveInstalledGame,
    msiArgs,
    setupFolder,
    silentArgs,
    unpackDiscs,
    unpackFolder,
    type Disc,
    type InstalledProgram,
    type InstallerKind
  } from '$lib/data/windows-install';
  import type { LoadData } from '$lib/functions/file-loaders/types';

  interface Props {
    /** Adds the game's book record to the library (the manage page's storage source) */
    save?: (book: LoadData) => Promise<void>;
    /** Title of a game in the library to add the files for (/v, files missing) */
    existing?: string;
    /** Called once an existing game's files are copied */
    added?: () => void;
  }

  let { save, existing, added }: Props = $props();

  const blocker = windowsGameBlocker();
  /** Programs listed before "More": most folders have one game and a few tools */
  const shownPrograms = 6;

  let files = $state<Record<string, File>>({});
  let folderName = $state('');
  let title = $state('');
  let exe = $state('');
  let hook = $state<{ name: string; text: string }>();
  let scripts = $state<HookScript[]>([]);
  let query = $state('');
  /** The reader's pick once they touch the list ('' none, CHOSEN their file, else a bundled file) */
  let picked = $state<string>();
  let copied = $state<{ done: number; total: number }>();
  let error = $state('');
  let showAll = $state(false);
  let abort: AbortController | undefined;
  let folderInput: HTMLInputElement | undefined = $state();
  /** Games in this browser's library whose files aren't here */
  let missing = $state<{ title: string; info: VnInfo }[]>([]);
  /** The picked one ('' = a new game) */
  let target = $state('');
  const record = $derived(missing.find((game) => game.title === target));
  /** The folder lacks the program the record runs */
  const wrongFolder = $derived(!!record && !!folderName && !files[record.info.exe!]);

  /** Install mode: disc images, or the folder's installer */
  let discs = $state<Disc[]>([]);
  /** The discs' programs (disc 1), autorun's first, and copy protection found on them */
  let discPrograms = $state<{ path: string; size: number }[]>([]);
  /** autorun.inf's program (a disc's, or the folder's installer that folderSetup found) */
  let autorun = $state<{ program: string; args: string }>();
  /** The discs came out of a ZIP: they're in OPFS vnbox/_unpack (unpackDiscs) */
  let staged = false;
  /** Counts folder picks, so a slow read of an earlier one is dropped */
  let picks = 0;

  /** Frees a ZIP's unpacked discs once another pick replaces them. */
  function dropStaged() {
    if (staged) deleteWindowsGame(unpackFolder).catch(() => undefined);
    staged = false;
  }
  let protection = $state<string[]>([]);
  /** The folder holds an installer to run, not the game */
  let install = $state(false);
  let installer = $state('');
  let kind = $state<InstallerKind>();
  let silent = $state(true);
  let phase = $state<'pick' | 'installing' | 'finding' | 'installed'>('pick');
  let frameUrl = $state<string>();
  let frame: HTMLIFrameElement | undefined = $state();
  let installBefore = new Map<string, number>();
  // A new game's install, freed on Cancel: its OPFS folder (discs, installer copy) and, when it
  // held nothing before, the files the installer wrote into VNBox's game-folder layer.
  let discard: { folder: string; layer: boolean } | undefined;
  /** Finish was clicked once during a silent install: the next click finishes anyway */
  let finishEarly = $state(false);
  let found = $state<InstalledProgram[]>([]);
  let foundPick = $state(0);
  let moving = $state(false);
  let discInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();
  const installing = $derived(!!discs.length || install);
  const installers = $derived(
    discs.length
      ? discPrograms
      : windowsPrograms(files)
          .sort(
            (a, b) =>
              Number(b === autorun?.program) - Number(a === autorun?.program) ||
              Number(/setup|install/i.test(b)) - Number(/setup|install/i.test(a))
          )
          .map((path) => ({ path, size: files[path].size }))
  );
  const folderSize = $derived(
    discs.length
      ? discs.reduce((sum, disc) => sum + disc.files.reduce((n, file) => n + file.size, 0), 0)
      : Object.values(files).reduce((sum, file) => sum + file.size, 0)
  );

  const programs = $derived(windowsPrograms(files));
  const size = $derived(Object.values(files).reduce((sum, file) => sum + file.size, 0));
  const count = $derived(Object.keys(files).length);
  const busy = $derived(!!copied);
  const suggested = $derived(
    hookSuggestion(scripts, {
      exe: phase === 'installed' ? (found[foundPick]?.path ?? '') : exe,
      names: [title, folderName],
      files: phase === 'installed' ? found.map((program) => program.path) : Object.keys(files)
    })
  );
  const choice = $derived(picked ?? suggested ?? '');
  /** The suggestion, the current pick and the search results, each once */
  const hits = $derived(
    new Set(query.trim() ? searchHookScripts(scripts, query).map((script) => script.file) : [])
  );
  const listed = $derived(
    scripts.filter(
      (script) => script.file === suggested || script.file === choice || hits.has(script.file)
    )
  );
  const CHOSEN = '#chosen';

  hookScripts().then((found) => (scripts = found));

  async function findMissing() {
    missing = await missingWindowsGames(await (await database.db).getAll('data'));
    target = existing ?? '';
  }

  if (!blocker) findMissing();

  /** A folder's (or ZIP's) files: a game, an installer (folderSetup) or disc images. */
  async function useFolder(name: string, picked: Record<string, File>, zipped = false) {
    const images = folderDiscs(picked);
    const pick = ++picks;

    error = '';
    if (images.length) {
      abort = new AbortController();
      try {
        // Only the ZIP's start can be read: its images go into OPFS first (copyDiscs moves them).
        const size = images.reduce((sum, path) => sum + picked[path].size, 0);

        if (zipped) await roomFor(size + vnboxZipsSize);
        const found = zipped
          ? await unpackDiscs(
              picked,
              images,
              (done, total) => (copied = { done, total }),
              abort.signal
            )
          : images.map((path) => picked[path]);

        copied = undefined;
        await useDiscs(found, zipped);
      } catch (unpackError: any) {
        copied = undefined;
        if (unpackError?.name !== 'AbortError') error = unpackError.message;
      }
      return;
    }

    files = picked;
    folderName = name;
    title = name;
    discs = [];
    dropStaged();
    autorun = undefined;
    exe = windowsPrograms(picked)[0] ?? '';
    install = false;
    if (!exe) {
      error = 'This folder has no Windows program (.exe). Choose the folder the game runs from.';
      return;
    }

    const setup = await folderSetup(picked);

    if (pick !== picks || !setup) return;
    autorun = { program: setup.installer, args: setup.args };
    install = true;
    await chooseInstaller(setup.installer);
  }

  async function discsPicked(list: FileList | null) {
    await useDiscs(Array.from(list ?? []).filter((file) => discFilePattern.test(file.name)));
  }

  async function useDiscs(picked: File[], unpacked = false) {
    if (!picked.length) return;
    error = '';
    if (!unpacked) dropStaged();
    staged = unpacked;
    discs = await discsOf(picked);
    files = {};
    install = false;
    protection = [];
    discPrograms = [];
    autorun = undefined;
    folderName = discs.map((disc) => disc.main.name).join(', ');
    title = discs[0].main.name.replace(/\.[^.]*$/, '');

    try {
      const listing = await listDisc(discs[0]);

      if (!listing) {
        error =
          'This image has no ISO 9660 file system VNBox can read (UDF-only DVDs and audio CDs are not supported).';
        return;
      }
      if (listing.label) title = listing.label;

      protection = copyProtection(listing.files.map((file) => file.path));
      ({ autorun, programs: discPrograms } = await discSetup(listing));
      if (!discPrograms.length) error = 'This disc has no Windows program (.exe) to install from.';
      else await chooseInstaller(discPrograms[0].path, listing);
    } catch (readError: any) {
      error = `Could not read the image: ${readError.message}`;
    }
  }

  let listing: Awaited<ReturnType<typeof listDisc>>;

  /** The installer's folder's files (the disc's or the picked folder's) */
  const installerPaths = () =>
    discs.length ? (listing?.files.map((file) => file.path) ?? []) : Object.keys(files);

  /**
   * Picks the installer and reads which kind it is (its first 4 MB); one that only starts
   * msiexec on the package beside it runs msiexec itself ('msi').
   */
  async function chooseInstaller(path: string, discListing = listing) {
    listing = discListing;
    installer = path;
    kind = undefined;

    const head = 4 << 20;
    const disc = discs.length && listing?.files.find((file) => file.path === path);
    const bytes = disc
      ? await listing!.read(disc, head)
      : files[path] && (await readHead(files[path], head));
    const found = bytes && installerKind(bytes);
    const msi = (!found || found === 'installshield') && besideMsi(path, installerPaths());

    if (bytes && installer === path) kind = msi ? 'msi' : found;
  }

  async function chooseFolder() {
    const picker = (window as any).showDirectoryPicker;

    // Chrome and Edge: the folder's handle. Elsewhere: the folder as files (webkitdirectory).
    if (!picker) {
      folderInput?.click();
      return;
    }

    try {
      const dir: FileSystemDirectoryHandle = await picker({ id: 'windows-game', mode: 'read' });

      await useFolder(dir.name, await readHandle(dir));
    } catch (pickError: any) {
      if (pickError?.name !== 'AbortError')
        error = `Could not read the folder: ${pickError.message}`;
    }
  }

  function folderPicked(list: FileList | null) {
    const { name, files: picked } = folderInputFiles(list);

    if (name) useFolder(name, picked);
    // Browsers that ignore webkitdirectory (some on phones) hand back loose files.
    else if (list?.length)
      error = 'This browser picked files, not a folder. Choose a ZIP of the game folder instead.';
  }

  /** A ZIP of the game folder: phones can't pick folders. */
  async function zipPicked(list: FileList | null) {
    const zip = list?.[0];

    if (!zip) return;
    error = '';
    try {
      const { name, files: picked } = await zipGameFiles(zip);

      await useFolder(name, picked, true);
    } catch (zipError: any) {
      error = `Could not read the ZIP: ${zipError.message}`;
    }
  }

  async function hookPicked(list: FileList | null) {
    const file = list?.[0];

    if (!file) return;

    hook = { name: file.name, text: await file.text() };
    picked = CHOSEN;
  }

  async function startInstall() {
    const name = title.trim();

    if (!name || !installer) return;

    error = '';
    abort = new AbortController();

    try {
      // Room for the copy (unpacked discs are moved), about as much again for what the
      // installer writes, and VNBox's zips.
      await roomFor(folderSize * (staged ? 1 : 2) + vnboxZipsSize);

      const folder = windowsGameFolder(name);
      const progress = (done: number, total: number) => (copied = { done, total });

      if (!(await hasWindowsGame(folder))) {
        const [layer] = vnSaveAreas(name, { encoding: 'sjis', files: [], engine: 'vnbox', folder });

        discard = { folder, layer: !(await listSaves(layer)).length };
      }
      copied = { done: 0, total: folderSize };
      if (discs.length) await copyDiscs(discs, folder, progress, abort.signal, staged);
      if (staged) await deleteWindowsGame(unpackFolder).catch(() => undefined);
      // The game's folder (VNBox mounts it as C:\files\<folder>, the install target) holds the
      // installer folder's copy while it runs.
      await copyWindowsGame(
        folder,
        discs.length
          ? {}
          : Object.fromEntries(
              Object.entries(files).map(([path, file]) => [`${setupFolder}/${path}`, file])
            ),
        progress,
        abort.signal
      );
      copied = undefined;
      await runInstaller();
    } catch (installError: any) {
      if (installError?.name !== 'AbortError') error = installError.message;
      copied = undefined;
    }
  }

  async function runInstaller() {
    const folder = windowsGameFolder(title.trim());
    const dir = installDir(folder);
    const windows = installer.replaceAll('/', '\\');
    const program = discs.length
      ? `${discDrive}:\\${windows}`
      : `${dir}\\${setupFolder}\\${windows}`;
    const workingDir = program.slice(0, program.lastIndexOf('\\') + 1);
    const msi = silent && kind === 'msi' && besideMsi(installer, installerPaths());
    const quiet = silent && kind && kind !== 'msi' ? silentArgs(kind, dir) : '';
    const own = autorun?.program.toLowerCase() === installer.toLowerCase() ? autorun.args : '';

    installBefore = await prefixSnapshot(title.trim(), folder);
    finishEarly = false;
    phase = 'installing';
    frameUrl = installUrl(
      folder,
      msi ? 'msiexec' : program,
      msi
        ? msiArgs(`${workingDir}${msi.slice(msi.lastIndexOf('/') + 1)}`, dir)
        : [own, quiet].filter(Boolean).join(' '),
      workingDir,
      discs.map((disc) => discPath(disc, folder))
    );
  }

  /** The installer exited (VNBox: no process left) or the reader says it's done. */
  async function installerDone() {
    if (phase !== 'installing') return;
    phase = 'finding';
    // IDBFS writes the last changes a moment after they happen.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    frameUrl = undefined;
    try {
      const folder = windowsGameFolder(title.trim());

      found = await installedPrograms(title.trim(), folder, installBefore);
      foundPick = 0;
      phase = 'installed';
    } catch (findError: any) {
      error = `Could not look for the installed game: ${findError.message}`;
      phase = 'installed';
    }
  }

  function frameMessage(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'vnbox-exit') installerDone();
    if (event.data?.type === 'vnbox-error') error = `VNBox: ${event.data.message}`;
  }

  function frameLoaded() {
    (frame?.contentWindow as any)
      ?.startGame?.({ textLines: () => [], onText: () => undefined })
      ?.catch?.((startError: Error) => (error = `The player did not start: ${startError.message}`));
  }

  async function addInstalled() {
    const program = found[foundPick];
    const name = title.trim();

    if (!program || !name) return;

    error = '';
    moving = true;
    try {
      const path = await moveInstalledGame(
        windowsGameFolder(name),
        program,
        (done, total) => (copied = { done, total })
      );

      await save?.(
        windowsGameBook(
          name,
          path,
          choice === CHOSEN ? hook?.text : undefined,
          undefined,
          choice === CHOSEN ? undefined : choice || undefined,
          discs.map((disc) => discPath(disc, windowsGameFolder(name)))
        )
      );
      discard = undefined;
      dialogManager.dialogs$.next([]);
    } catch (moveError: any) {
      error = moveError.message;
    } finally {
      moving = false;
      copied = undefined;
    }
  }

  function close() {
    abort?.abort();
    dialogManager.dialogs$.next([]);
    if (discard) freeInstall(discard);
    dropStaged();
  }

  async function freeInstall({ folder, layer }: { folder: string; layer: boolean }) {
    discard = undefined;
    frameUrl = undefined;
    await deleteWindowsGame(folder).catch(() => undefined);
    if (layer) {
      const [area] = vnSaveAreas(title.trim(), {
        encoding: 'sjis',
        files: [],
        engine: 'vnbox',
        folder
      });

      await deleteSaves(area, await listSaves(area), '').catch(() => undefined);
    }
  }

  /** A silent installer shows nothing: finishing before it exits leaves the game half-installed. */
  function finishClicked() {
    if (silent && kind && !finishEarly) finishEarly = true;
    else installerDone();
  }

  async function add() {
    const name = record ? record.title : title.trim();

    if (!name || (record ? wrongFolder : !exe)) return;

    error = '';
    abort = new AbortController();

    try {
      await roomFor(size + vnboxZipsSize);
      copied = { done: 0, total: size };
      await copyWindowsGame(
        record ? record.info.folder! : windowsGameFolder(name),
        files,
        (done, total) => (copied = { done, total }),
        abort.signal
      );
      if (record) added?.();
      else
        await save?.(
          windowsGameBook(
            name,
            exe,
            choice === CHOSEN ? hook?.text : undefined,
            undefined,
            choice === CHOSEN ? undefined : choice || undefined
          )
        );
      dialogManager.dialogs$.next([]);
    } catch (addError: any) {
      if (addError?.name !== 'AbortError') error = addError.message;
      copied = undefined;
    }
  }
</script>

{#snippet hookStep(number: number)}
  <div class="wg-step">
    <SectionHead {number} title="Text hook" level="h3" count="Optional" />
    <p class="wg-note">
      Without a dc00 script the game plays, but no text reaches lookups, statistics or Anki.
      <a
        class="app-button-quiet wg-link"
        href="https://github.com/0xDC00/scripts"
        target="_blank"
        rel="noreferrer">Find a script</a
      >
    </p>
    {#if scripts.length}
      <input
        class="app-input"
        type="search"
        placeholder="Search {scripts.length} scripts"
        aria-label="Search hook scripts"
        bind:value={query}
        disabled={busy}
      />
    {/if}
    <ul class="wg-programs">
      <li>
        <label class="wg-program">
          <input
            type="radio"
            name="wg-hook"
            checked={choice === ''}
            disabled={busy}
            onchange={() => (picked = '')}
          />
          <span>No script</span>
        </label>
      </li>
      {#each listed as script (script.file)}
        <li>
          <label class="wg-program">
            <input
              type="radio"
              name="wg-hook"
              checked={choice === script.file}
              disabled={busy}
              onchange={() => (picked = script.file)}
            />
            <span lang="ja">{script.name}</span>
            {#if script.file === suggested}<span class="wg-dim">Suggested</span>{/if}
          </label>
        </li>
      {/each}
      {#if hook}
        <li>
          <label class="wg-program">
            <input
              type="radio"
              name="wg-hook"
              checked={choice === CHOSEN}
              disabled={busy}
              onchange={() => (picked = CHOSEN)}
            />
            <span>{hook.name}</span>
            <span class="wg-dim">Your file</span>
          </label>
        </li>
      {/if}
    </ul>
    <div class="wg-row">
      <label class="app-button" class:wg-disabled={busy}>
        <input
          hidden
          type="file"
          accept=".js,text/javascript"
          disabled={busy}
          onchange={(event) => hookPicked(event.currentTarget.files)}
        />
        {hook ? 'Choose another file' : 'Choose file…'}
      </label>
      <span class="wg-dim">Your own file can't use require()</span>
    </div>
  </div>
{/snippet}

{#snippet copyProgress()}
  {#if copied}
    <div class="wg-progress" role="status">
      <span class="wg-track">
        <span class="wg-fill" style:width="{copied.total ? (100 * copied.done) / copied.total : 0}%"
        ></span>
      </span>
      <span class="wg-dim">
        Copying {formatBytes(copied.done)} of {formatBytes(copied.total)}
      </span>
    </div>
  {/if}
{/snippet}

<svelte:window onmessage={frameMessage} />

<section class="wg" class:wg-wide={phase === 'installing'} aria-labelledby="wg-title">
  <h2 id="wg-title" class="wg-title">Add a Windows game</h2>
  <p class="wg-lead">Copied into this browser and run here, offline. Nothing is uploaded.</p>

  {#if blocker}
    <p class="wg-note" role="status">{windowsGameBlockerText[blocker]}</p>
    <footer class="wg-actions">
      <button type="button" class="app-button" onclick={close}>Close</button>
    </footer>
  {:else if phase === 'installing' || phase === 'finding'}
    <div class="wg-step">
      <SectionHead number={2} title="Installing" level="h3" />
      <p class="wg-note">
        {#if phase === 'finding'}
          Looking for the installed game…
        {:else if silent && kind}
          {installerNames[kind]} installs without its windows, but a setup it starts (such as DirectX)
          may still open one below: click through it. This step ends when the installer closes.
        {:else}
          Click through the installer below. When it asks where to install, choose
          <code>{installDir(windowsGameFolder(title.trim()))}</code>. This step ends when it closes.
        {/if}
      </p>
      {#if frameUrl}
        <iframe
          bind:this={frame}
          class="wg-frame"
          src={frameUrl}
          title="Installer"
          onload={frameLoaded}
        ></iframe>
      {/if}
    </div>
    {#if finishEarly && phase === 'installing'}
      <p class="wg-error" role="alert">
        The installer may still be copying files. Finishing now can leave the game half-installed:
        wait until it closes by itself unless it has been idle for several minutes.
      </p>
    {/if}
    {#if error}
      <p class="wg-error" role="alert">{error}</p>
    {/if}
    <footer class="wg-actions">
      <button type="button" class="app-button" onclick={close}>Cancel</button>
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={phase === 'finding'}
        onclick={finishClicked}
      >
        {finishEarly ? 'Finish anyway' : 'The installer is done'}
      </button>
    </footer>
  {:else if phase === 'installed'}
    <div class="wg-step">
      <SectionHead number={3} title="Program" level="h3" count={found.length} />
      {#if found.length}
        <ul class="wg-programs">
          {#each found as program, index (program.area.db + program.path)}
            <li>
              <label class="wg-program">
                <input
                  type="radio"
                  name="wg-found"
                  value={index}
                  bind:group={foundPick}
                  disabled={moving}
                />
                <span lang="ja">{program.path}</span>
                {#if program.shortcut}<span class="wg-dim">Shortcut</span>{/if}
                <span class="wg-dim">{formatBytes(program.size)}</span>
              </label>
            </li>
          {/each}
        </ul>
        <p class="wg-note">
          The game's files move into its folder here{discs.length
            ? '; the disc stays in the drive for games that check it'
            : ''}.
        </p>
      {:else}
        <p class="wg-note">
          The installer left no program.{silent && kind
            ? ' It may need its windows: run it again and click through it.'
            : ''}
        </p>
        <div class="wg-row">
          <button
            type="button"
            class="app-button"
            onclick={() => {
              silent = false;
              runInstaller().catch((runError: Error) => (error = runError.message));
            }}
          >
            Run the installer again
          </button>
        </div>
      {/if}
    </div>
    {#if found.length}
      {@render hookStep(4)}
    {/if}
    {#if error}
      <p class="wg-error" role="alert">{error}</p>
    {/if}
    {@render copyProgress()}
    <footer class="wg-actions">
      <button type="button" class="app-button" onclick={close}>Cancel</button>
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={moving || !found.length}
        onclick={addInstalled}
      >
        Add game
      </button>
    </footer>
  {:else}
    <div class="wg-step">
      <SectionHead number={1} title="Game folder" level="h3" />
      <div class="wg-row">
        {#if !$isMobile$ || 'showDirectoryPicker' in window}
          <button type="button" class="app-button" disabled={busy} onclick={chooseFolder}>
            {folderName && !discs.length ? 'Change folder' : 'Choose folder'}
          </button>
        {/if}
        <button
          type="button"
          class="app-button"
          disabled={busy || !!target}
          onclick={() => discInput?.click()}
        >
          Choose disc image…
        </button>
        <button type="button" class="app-button" disabled={busy} onclick={() => zipInput?.click()}>
          Choose ZIP of the folder…
        </button>
        {#if folderName}
          <span class="wg-meta" lang="ja">
            {folderName}<span class="wg-dim">
              · {formatBytes(folderSize)}{discs.length
                ? ` · ${discs.length} ${discs.length === 1 ? 'disc' : 'discs'}`
                : ` · ${count} files`}</span
            >
          </span>
        {/if}
      </div>
      <input
        hidden
        type="file"
        multiple
        accept=".iso,.cue,.bin,.mds,.mdf,.img,.wav"
        bind:this={discInput}
        onchange={(event) => discsPicked(event.currentTarget.files)}
      />
      {#if folderName && !discs.length && !target && programs.length}
        <label class="wg-program">
          <input type="checkbox" bind:checked={install} disabled={busy} />
          <span>This folder holds an installer: install the game from it</span>
        </label>
      {/if}
      <input
        hidden
        type="file"
        webkitdirectory
        bind:this={folderInput}
        onchange={(event) => folderPicked(event.currentTarget.files)}
      />
      <!-- No accept: Android's picker greys out ZIPs whose provider reports another type. -->
      <input
        hidden
        type="file"
        bind:this={zipInput}
        onchange={(event) => zipPicked(event.currentTarget.files)}
      />
      {#if missing.length}
        <label class="wg-field">
          <span class="wg-label">This game is already in my library</span>
          <select class="app-input" lang="ja" bind:value={target} disabled={busy}>
            <option value="">No, it's a new game</option>
            {#each missing as game (game.title)}
              <option value={game.title}>{game.title}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if record}
        {#if wrongFolder}
          <p class="wg-error" role="alert" lang="ja">
            This folder has no {record.info.exe}, the program this game runs. Choose the folder it
            runs from.
          </p>
        {/if}
      {:else if folderName}
        <label class="wg-field">
          <span class="wg-label">Title</span>
          <input class="app-input" lang="ja" bind:value={title} disabled={busy} />
        </label>
      {/if}
    </div>

    {#if installing && installers.length && !record}
      <div class="wg-step">
        <SectionHead number={2} title="Installer" level="h3" count={installers.length} />
        {#if protection.length}
          <p class="wg-error" role="alert">
            This disc has {protection.join(' and ')} files. Copy protection doesn't run in VNBox, so
            the game may not start once it is installed.
          </p>
        {/if}
        <ul class="wg-programs">
          {#each showAll ? installers : installers.slice(0, shownPrograms) as program (program.path)}
            <li>
              <label class="wg-program">
                <input
                  type="radio"
                  name="wg-installer"
                  checked={installer === program.path}
                  disabled={busy}
                  onchange={() => chooseInstaller(program.path)}
                />
                <span lang="ja">{program.path}</span>
                {#if discs.length && program.path.toLowerCase() === autorun?.program.toLowerCase()}
                  <span class="wg-dim">Autorun</span>
                {/if}
                <span class="wg-dim">{formatBytes(program.size)}</span>
              </label>
            </li>
          {/each}
        </ul>
        {#if !showAll && installers.length > shownPrograms}
          <button type="button" class="app-button-quiet wg-more" onclick={() => (showAll = true)}>
            Show all {installers.length}
          </button>
        {/if}
        {#if kind}
          <label class="wg-program">
            <input type="checkbox" bind:checked={silent} disabled={busy} />
            <span>Install without the installer's windows ({installerNames[kind]})</span>
          </label>
        {/if}
      </div>
    {:else if programs.length && !record}
      <div class="wg-step">
        <SectionHead number={2} title="Program" level="h3" count={programs.length} />
        <ul class="wg-programs">
          {#each showAll ? programs : programs.slice(0, shownPrograms) as program (program)}
            <li>
              <label class="wg-program">
                <input
                  type="radio"
                  name="wg-exe"
                  value={program}
                  bind:group={exe}
                  disabled={busy}
                />
                <span lang="ja">{program}</span>
                <span class="wg-dim">{formatBytes(files[program].size)}</span>
              </label>
            </li>
          {/each}
        </ul>
        {#if !showAll && programs.length > shownPrograms}
          <button type="button" class="app-button-quiet wg-more" onclick={() => (showAll = true)}>
            Show all {programs.length}
          </button>
        {/if}
      </div>

      {@render hookStep(3)}
    {/if}

    {#if error}
      <p class="wg-error" role="alert">{error}</p>
    {/if}

    {@render copyProgress()}

    <footer class="wg-actions">
      <button type="button" class="app-button" onclick={close}>Cancel</button>
      {#if installing && !record}
        <button
          type="button"
          class="app-button app-button-primary"
          disabled={busy || !installer || !title.trim()}
          onclick={startInstall}
        >
          Install
        </button>
      {:else}
        <button
          type="button"
          class="app-button app-button-primary"
          disabled={busy || !folderName || (record ? wrongFolder : !exe || !title.trim())}
          onclick={add}
        >
          {record ? 'Add files' : 'Add game'}
        </button>
      {/if}
    </footer>
  {/if}
</section>

<style>
  .wg {
    display: flex;
    width: min(36rem, 80vw);
    max-height: 85vh;
    flex-direction: column;
    gap: 1.5rem;
    overflow-y: auto;
    padding: 1.5rem;
    border-top: 2px solid var(--font-color);
    border-radius: 2px;
    background: var(--surface-strong-color);
    color: var(--font-color);
    font-size: var(--type-body);
  }

  .wg-wide {
    width: min(56rem, 95vw);
  }

  .wg-frame {
    width: 100%;
    aspect-ratio: 4 / 3;
    border: 1px solid var(--border-color);
    border-radius: 2px;
  }

  .wg-title {
    font-size: var(--type-h2);
    font-weight: 700;
    line-height: 1.3;
  }

  .wg-lead {
    margin-top: -1rem;
    color: var(--app-muted-fg);
  }

  .wg-step {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .wg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .wg-meta {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .wg-dim {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .wg-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .wg-label {
    font-size: var(--type-label);
    font-weight: 700;
  }

  .wg-programs {
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--font-color);
    list-style: none;
  }

  .wg-programs li {
    border-bottom: 1px solid var(--border-color);
  }

  .wg-program {
    display: flex;
    min-height: var(--app-control-height, 2.5rem);
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .wg-program input {
    flex: none;
    accent-color: var(--accent-color);
  }

  .wg-program span:first-of-type {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .wg-more {
    align-self: flex-start;
  }

  .wg-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.7;
  }

  .wg-link {
    display: inline;
    height: auto;
    padding: 0;
  }

  .wg-disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .wg-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .wg-progress {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .wg-track {
    position: relative;
    height: 3px;
    background: var(--app-progress-track);
  }

  .wg-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-color);
  }

  .wg-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
