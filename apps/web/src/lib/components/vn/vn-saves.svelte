<script lang="ts">
  /**
   * The /v player's Saves sheet: a file browser over the game's save area (vn-save-store.ts),
   * opened while the game is stopped. Download a file or a folder as a ZIP, upload files into
   * a folder, restore a ZIP at its paths, delete; a backup ZIP of what an overwrite or delete
   * touches is downloaded first. Not upstream.
   */
  import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import {
    deleteSaves,
    listSaves,
    savesUnder,
    unzipSaves,
    writeSaves,
    zipSaves,
    type SaveArea,
    type SaveEntry
  } from '$lib/data/vn-save-store';

  interface Props {
    areas: SaveArea[];
    /** For file names of downloads */
    title: string;
    /** Shown paths of files deleted from an area */
    ondelete?: (area: SaveArea, paths: string[]) => void;
  }

  let { areas, title, ondelete }: Props = $props();

  let areaIndex = $state(0);
  let entries: SaveEntry[] = $state([]);
  let open = $state(new Set<string>());
  /** Selected path; '' = the area's top */
  let selected = $state('');
  let busy = $state(false);
  let error = $state('');
  let status = $state('');
  let filesInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();

  const area = $derived(areas[areaIndex]);
  const selectedEntry = $derived(entries.find((entry) => entry.path === selected));
  /** Uploads go into the selected folder, or the selected file's */
  const folder = $derived(
    !selected
      ? ''
      : selectedEntry?.dir
        ? `${selected}/`
        : selected.slice(0, selected.lastIndexOf('/') + 1)
  );
  const rows = $derived(
    entries
      .filter((entry) => {
        const parts = entry.path.split('/');

        return parts
          .slice(0, -1)
          .every((_, index) => open.has(parts.slice(0, index + 1).join('/')));
      })
      .sort((a, b) => order(a).localeCompare(order(b)))
  );

  // Folders before files at each level: sort on the path with a 0/1 before each name.
  function order(entry: SaveEntry) {
    const parts = entry.path.split('/');

    return parts
      .map((part, index) => `${index < parts.length - 1 || entry.dir ? 0 : 1}${part}`)
      .join('\u0000');
  }

  $effect(() => {
    area;
    selected = '';
    open = new Set();
    reload();
  });

  async function reload() {
    entries = await listSaves(area).catch((caught) => {
      error = caught.message;
      return [];
    });
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const zipName = (what: string) =>
    `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} ${area.label} ${what} ${stamp()}.zip`;

  async function run(task: () => Promise<string>) {
    busy = true;
    error = '';
    status = '';
    try {
      status = await task();
    } catch (caught: any) {
      error = caught.message;
    } finally {
      busy = false;
      await reload();
    }
  }

  async function backup(touched: SaveEntry[]) {
    if (touched.some((entry) => !entry.dir)) {
      downloadBlob(await zipSaves(area, touched), zipName('backup'));
    }
  }

  function download() {
    run(async () => {
      downloadBlob(
        await zipSaves(area, savesUnder(entries, selected)),
        zipName(selected ? selected.split('/').pop()! : 'all')
      );
      return '';
    });
  }

  async function write(files: { path: string; bytes: Uint8Array }[]) {
    const paths = new Set(files.map((file) => file.path));

    await backup(entries.filter((entry) => !entry.dir && paths.has(entry.path)));
    const replaced = await writeSaves(area, files, entries);

    return `${files.length} ${files.length === 1 ? 'file' : 'files'} written${replaced.length ? `, ${replaced.length} replaced (backup downloaded)` : ''}.`;
  }

  function uploadFiles(picked: FileList | null) {
    if (!picked?.length) return;
    run(async () =>
      write(
        await Promise.all(
          [...picked].map(async (file) => ({
            path: folder + file.name,
            bytes: new Uint8Array(await file.arrayBuffer())
          }))
        )
      )
    );
  }

  function restoreZip(picked: FileList | null) {
    if (!picked?.[0]) return;
    run(async () => {
      const files = await unzipSaves(picked[0]);

      if (!files.length) throw new Error('That ZIP has no files.');
      return write(files);
    });
  }

  function remove() {
    if (!selected) return;
    run(async () => {
      const touched = savesUnder(entries, selected);

      await backup(touched);
      const gone = await deleteSaves(area, entries, selected);

      ondelete?.(
        area,
        gone.filter((entry) => !entry.dir).map((entry) => entry.path)
      );
      selected = '';
      return `Deleted ${gone[0]?.path ?? 'it'}${touched.some((entry) => !entry.dir) ? ' (backup downloaded)' : ''}.`;
    });
  }

  function choose(entry: SaveEntry) {
    selected = entry.path;
    if (!entry.dir) return;

    const next = new Set(open);

    if (!next.delete(entry.path)) next.add(entry.path);
    open = next;
  }

  const size = (bytes: number) =>
    bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : bytes >= 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${bytes} B`;
  const date = (time: number) => (time ? new Date(time).toLocaleString() : '');
</script>

<div class="saves">
  <p class="saves-muted">Close the game in other tabs first, or it writes its old saves back.</p>

  {#if areas.length > 1}
    <ButtonToggleGroup
      options={areas.map((item, index) => ({ id: index, text: item.label }))}
      bind:selectedOptionId={areaIndex}
    />
    <p class="saves-muted">
      {area.label === 'Game folder'
        ? 'These win over the copy you imported.'
        : 'drive_c is C:, user.reg the registry.'}
    </p>
  {/if}

  <div class="saves-actions">
    <button class="app-button" disabled={busy || !entries.length} onclick={download}>
      {selected ? (selectedEntry?.dir ? 'Download folder' : 'Download') : 'Download all'}
    </button>
    <button class="app-button" disabled={busy} onclick={() => filesInput?.click()}>
      Upload files{folder ? ` to ${folder.replace(/\/$/, '')}` : ''}
    </button>
    <button class="app-button" disabled={busy} onclick={() => zipInput?.click()}>Restore ZIP</button
    >
    <button class="app-button app-button-danger" disabled={busy || !selected} onclick={remove}>
      Delete
    </button>
  </div>
  <input
    bind:this={filesInput}
    type="file"
    multiple
    hidden
    onchange={(event) => {
      uploadFiles(event.currentTarget.files);
      event.currentTarget.value = '';
    }}
  />
  <input
    bind:this={zipInput}
    type="file"
    accept=".zip,application/zip"
    hidden
    onchange={(event) => {
      restoreZip(event.currentTarget.files);
      event.currentTarget.value = '';
    }}
  />

  {#if error}
    <p class="saves-error" role="alert">{error}</p>
  {:else if status}
    <p class="saves-muted" role="status">{status}</p>
  {/if}

  {#if entries.length}
    <ul class="saves-tree" role="tree" aria-label="{area.label} files">
      <li role="treeitem" aria-selected={!selected}>
        <button class="saves-row" class:saves-selected={!selected} onclick={() => (selected = '')}>
          <span class="saves-name">{area.label}</span>
          <span class="saves-meta">{entries.filter((entry) => !entry.dir).length} files</span>
        </button>
      </li>
      {#each rows as entry (entry.key)}
        <li
          role="treeitem"
          aria-selected={selected === entry.path}
          aria-expanded={entry.dir ? open.has(entry.path) : undefined}
        >
          <button
            class="saves-row"
            class:saves-selected={selected === entry.path}
            style:padding-left="{entry.path.split('/').length * 1}rem"
            onclick={() => choose(entry)}
          >
            <span class="saves-name">
              {#if entry.dir}<span class="saves-caret" aria-hidden="true"
                  ><Fa icon={open.has(entry.path) ? faChevronDown : faChevronRight} /></span
                >{/if}{entry.path.split('/').pop()}{entry.dir ? '/' : ''}
            </span>
            {#if !entry.dir}
              <span class="saves-meta">{size(entry.size)} · {date(entry.modified)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if !error}
    <p class="saves-empty">
      {area.label === 'Saves'
        ? 'No saves in this browser yet. They show here once the game has saved.'
        : 'Nothing written here yet.'}
    </p>
  {/if}
</div>

<style>
  .saves {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
  }

  .saves-muted,
  .saves-empty {
    margin: 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .saves-error {
    margin: 0;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .saves-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .saves-tree {
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--font-color);
    list-style: none;
  }

  .saves-row {
    display: flex;
    width: 100%;
    min-height: 2.5rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--border-color);
    color: var(--font-color);
    font-size: var(--type-body);
    text-align: left;
  }

  .saves-row:hover {
    background: var(--app-spot-tint);
  }

  .saves-row:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
  }

  .saves-selected,
  .saves-selected:hover {
    background: var(--app-spot-tint);
    font-weight: 700;
  }

  .saves-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .saves-caret {
    display: inline-block;
    width: 1rem;
    color: var(--accent-color);
    font-size: 0.75em;
  }

  .saves-meta {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }
</style>
