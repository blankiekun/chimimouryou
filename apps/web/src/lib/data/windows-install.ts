/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Installing a Windows game from a disc image (ISO, BIN+CUE, MDF+MDS) or an installer folder
 * inside VNBox. The images go to OPFS `vnbox/discs/<id>/`, VNBox reads them lazily (`cdrom=opfs:`)
 * and the installer runs with the game's own folder (`vnbox/<folder>`, empty) mounted at
 * C:\files\<folder>, its install target, so whatever it writes into the registry points where the
 * game runs later. What it installs lands in VNBox's IndexedDB layers (vn-save-store.ts); once it
 * exits, the game's files are moved from there into the OPFS folder, as if the folder had been
 * imported. Not upstream.
 */

import { hashPage } from '$lib/data/vn';
import {
  deleteSaves,
  listSaves,
  readSaveFile,
  vnSaveAreas,
  type SaveArea,
  type SaveEntry
} from '$lib/data/vn-save-store';
import { copyWindowsGame, vnboxPlayerUrl, windowsPrograms } from '$lib/data/windows-game';

/** VNBox's CD-ROM drive (DEFAULT_CDROM_DRIVE in boxedwine-shell.js) */
export const discDrive = 'e';

/** Where the installer's folder is copied inside the game's folder for the install */
export const setupFolder = '_setup';

export const discFilePattern = /\.(iso|cue|bin|mds|mdf|img|wav)$/i;

/** One disc: the file VNBox opens (`main`) and the files it reads through it */
export interface Disc {
  main: File;
  files: File[];
}

const base = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase();
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const mainOrder = ['cue', 'mds', 'iso', 'mdf', 'img', 'bin'];

/** The picked image files grouped into discs (a CUE's BINs, an MDS's MDF), in name order. */
export async function discsOf(picked: File[]): Promise<Disc[]> {
  const byName = new Map(picked.map((file) => [file.name.toLowerCase(), file]));
  const used = new Set<File>();
  const discs: Disc[] = [];

  for (const kind of mainOrder) {
    for (const main of picked.filter((file) => extension(file.name) === kind && !used.has(file))) {
      const files = [main];

      if (kind === 'cue') {
        for (const match of (await main.text()).matchAll(/^\s*FILE\s+(?:"([^"]*)"|(\S+))/gim)) {
          const file = byName.get((match[1] ?? match[2]).replace(/^.*[\\/]/, '').toLowerCase());

          if (file && !files.includes(file)) files.push(file);
        }
      } else if (kind === 'mds') {
        // The MDS names its MDF ("*.mdf" = its own name), most often an .mdf, sometimes an .iso.
        files.push(
          ...picked.filter((file) => file !== main && base(file.name) === base(main.name))
        );
      }
      files.forEach((file) => used.add(file));
      discs.push({ main, files });
    }
  }

  return discs.sort((a, b) => a.main.name.localeCompare(b.main.name, undefined, { numeric: true }));
}

/**
 * A disc's OPFS folder under vnbox/, inside the game's folder so deleting the game frees it (from
 * its file names and sizes: hashing GBs takes too long).
 */
export function discFolder(disc: Disc, folder: string) {
  return `${folder}/_discs/d${hashPage(disc.files.map((file) => `${file.name}:${file.size}`).join('/'))}`;
}

/** A disc as VnInfo.discs and VNBox's cdrom= list name it: its main file under vnbox/ */
export const discPath = (disc: Disc, folder: string) =>
  `${discFolder(disc, folder)}/${disc.main.name}`;

/** Copies the discs into OPFS (files already there with the same size are kept). */
export async function copyDiscs(
  discs: Disc[],
  folder: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
) {
  const total = discs.reduce(
    (sum, disc) => sum + disc.files.reduce((size, file) => size + file.size, 0),
    0
  );
  let before = 0;

  for (const disc of discs) {
    const files = Object.fromEntries(disc.files.map((file) => [file.name, file]));

    await copyWindowsGame(
      discFolder(disc, folder),
      files,
      (done) => onProgress(before + done, total),
      signal
    );
    before += disc.files.reduce((size, file) => size + file.size, 0);
  }
}

/** A file on a disc's ISO 9660 file system */
export interface DiscFile {
  /** '/'-separated, as the disc names it (Joliet names when the disc has them) */
  path: string;
  size: number;
  sector: number;
}

export interface DiscListing {
  label: string;
  files: DiscFile[];
  read: (file: DiscFile, max?: number) => Promise<Uint8Array>;
}

/** The sector layouts a data track can be stored in: bytes per sector, user data offset */
const layouts = [
  [2048, 0],
  [2352, 16],
  [2352, 24],
  [2336, 8],
  [2448, 16],
  [2448, 24]
];
const maxEntries = 20000;

/**
 * The ISO 9660 file system of a disc's first data track (as VNBox mounts it), or undefined when
 * there is none (UDF-only DVDs, audio CDs). Reads only the sectors it needs.
 */
export async function listDisc(disc: Disc): Promise<DiscListing | undefined> {
  // The data file: the CUE's first file, the MDS's image, else the main file.
  const data = disc.files.find((file) => !/\.(cue|mds|wav)$/i.test(file.name));

  if (!data) return undefined;

  const bytes = async (from: number, length: number) =>
    new Uint8Array(await data.slice(from, from + length).arrayBuffer());
  let layout: number[] | undefined;

  for (const candidate of layouts) {
    const head = await bytes(16 * candidate[0] + candidate[1], 6);

    if (head[0] === 1 && String.fromCharCode(...head.subarray(1)) === 'CD001') {
      layout = candidate;
      break;
    }
  }
  if (!layout) return undefined;

  const [sectorSize, dataOffset] = layout;
  const readSectors = async (sector: number, length: number) => {
    if (sectorSize === 2048) return bytes(sector * 2048, length);

    const out = new Uint8Array(length);

    for (let done = 0; done < length; done += 2048) {
      const part = await bytes((sector + done / 2048) * sectorSize + dataOffset, 2048);

      out.set(part.subarray(0, Math.min(2048, length - done)), done);
    }

    return out;
  };
  const u32 = (view: Uint8Array, at: number) =>
    (view[at] | (view[at + 1] << 8) | (view[at + 2] << 16) | (view[at + 3] << 24)) >>> 0;

  // The primary descriptor, or a Joliet one (UCS-2 names) when the disc has it.
  let root = await readSectors(16, 2048);
  let joliet = false;

  for (let sector = 17; sector < 32; sector++) {
    const descriptor = await readSectors(sector, 2048);

    if (descriptor[0] === 255) break;
    if (
      descriptor[0] === 2 &&
      descriptor[88] === 0x25 &&
      descriptor[89] === 0x2f &&
      [0x40, 0x43, 0x45].includes(descriptor[90])
    ) {
      root = descriptor;
      joliet = true;
      break;
    }
  }

  const label = (
    joliet
      ? new TextDecoder('utf-16be').decode(root.subarray(40, 72))
      : new TextDecoder('shift_jis').decode(root.subarray(40, 72))
  )
    .replace(/\0/g, '')
    .trim();
  const files: DiscFile[] = [];
  const seen = new Set<number>();
  const decodeName = (name: Uint8Array) =>
    (joliet ? new TextDecoder('utf-16be') : new TextDecoder('shift_jis'))
      .decode(name)
      .replace(/;\d+$/, '')
      .replace(/\.$/, '');

  async function walk(sector: number, size: number, prefix: string, depth: number) {
    if (seen.has(sector) || depth > 16 || files.length > maxEntries) return;
    seen.add(sector);

    const dir = await readSectors(sector, Math.min(size, 1 << 20));
    let at = 0;

    while (at < dir.length && files.length <= maxEntries) {
      const length = dir[at];

      // Records never cross a sector: a zero length skips to the next one.
      if (!length) {
        at = (Math.floor(at / 2048) + 1) * 2048;
        continue;
      }

      const nameLength = dir[at + 32];
      const name = dir.subarray(at + 33, at + 33 + nameLength);
      const child = u32(dir, at + 2);
      const childSize = u32(dir, at + 10);
      const isDir = (dir[at + 25] & 2) !== 0;

      if (!(nameLength === 1 && name[0] <= 1)) {
        const path = prefix + decodeName(name);

        if (isDir) await walk(child, childSize, `${path}/`, depth + 1);
        else files.push({ path, size: childSize, sector: child });
      }
      at += length;
    }
  }

  await walk(u32(root, 158), u32(root, 166), '', 0);

  return {
    label,
    files,
    read: (file, max = file.size) => readSectors(file.sector, Math.min(file.size, max))
  };
}

/** The program autorun.inf's open= (or shellexecute=) line runs, '/'-separated, and its arguments. */
export function autorunProgram(text: string) {
  let section = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);

    if (header) section = header[1].trim().toLowerCase();
    if (section !== 'autorun') continue;

    const value = /^(?:open|shellexecute)\s*=\s*(.+)$/i.exec(line)?.[1].trim();

    if (!value) continue;

    const quoted = /^"([^"]+)"\s*(.*)$/.exec(value);
    const [program, args] = quoted
      ? [quoted[1], quoted[2]]
      : [value.split(/\s+/)[0], value.split(/\s+/).slice(1).join(' ')];

    return { program: program.replace(/^\.?[\\/]+/, '').replaceAll('\\', '/'), args };
  }

  return undefined;
}

/** Files that copy protection installs or checks for: such games don't run in VNBox. */
const protectionFiles: [RegExp, string][] = [
  [/(?:^|\/)(?:cms16\.dll|cms_95\.dll|cms32_95\.dll|cmsnt\.dll|paul\.dll|drm_data)$/i, 'SecuROM'],
  [
    /(?:^|\/)(?:00000001\.tmp|clcd16\.dll|clcd32\.dll|clokspl\.exe|dplayerx\.dll|secdrv\.sys|.*\.icd)$/i,
    'SafeDisc'
  ],
  [/(?:^|\/)(?:protect\.dll|protect\.exe|sfdrvup\.exe|sfdrvrem\.exe|.*\.sfx)$/i, 'StarForce']
];

/** The copy protection a disc's files point to, each once. */
export function copyProtection(paths: string[]) {
  return [
    ...new Set(
      protectionFiles
        .filter(([pattern]) => paths.some((path) => pattern.test(path)))
        .map(([, name]) => name)
    )
  ];
}

export type InstallerKind = 'inno' | 'nsis' | 'installshield';

export const installerNames: Record<InstallerKind, string> = {
  inno: 'Inno Setup',
  nsis: 'NSIS',
  installshield: 'InstallShield'
};

/** The installer an .exe is, from the start of it (its resources name the tool), if known. */
export function installerKind(bytes: Uint8Array): InstallerKind | undefined {
  const text = new TextDecoder('latin1').decode(bytes);
  const has = (word: string) => text.includes(word) || text.includes(word.split('').join('\0'));

  if (has('Inno Setup')) return 'inno';
  if (has('Nullsoft')) return 'nsis';
  if (has('InstallShield')) return 'installshield';
  return undefined;
}

/** Arguments that install without asking, into dir (InstallShield: its own default folder). */
export function silentArgs(kind: InstallerKind, dir: string) {
  if (kind === 'inno') return `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="${dir}"`;
  // NSIS takes /D= last and unquoted.
  if (kind === 'nsis') return `/S /D=${dir}`;
  // InstallShield's MSI setup.exe hands /v's text to msiexec (/qn: no windows). It installs where
  // the package says, often Program Files: installedPrograms looks there too.
  return '/s /v/qn';
}

/** The game folder as the installer sees it (VNBox mounts it at C:\files\<folder>) */
export const installDir = (folder: string) => `C:\\files\\${folder}`;

/** The target of a Windows shortcut (.lnk): its LinkInfo's local path. */
export function lnkTarget(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 0x4c || view.getUint32(0, true) !== 0x4c) return undefined;

  const flags = view.getUint32(0x14, true);
  let at = 0x4c;

  if (flags & 1) at += 2 + view.getUint16(at, true);
  if (!(flags & 2) || at + 0x1c > bytes.length) return undefined;

  const infoHeader = view.getUint32(at + 4, true);
  const infoFlags = view.getUint32(at + 8, true);

  if (!(infoFlags & 1)) return undefined;

  const string = (from: number, wide: boolean) => {
    let end = from;

    while (end + (wide ? 1 : 0) < bytes.length && (bytes[end] || (wide && bytes[end + 1])))
      end += wide ? 2 : 1;

    return new TextDecoder(wide ? 'utf-16le' : 'shift_jis').decode(bytes.subarray(from, end));
  };

  if (infoHeader >= 0x24 && at + 0x20 <= bytes.length) {
    const unicode = view.getUint32(at + 0x1c, true);

    if (unicode) return string(at + unicode, true);
  }

  return string(at + view.getUint32(at + 0x10, true), false);
}

/** An installed program: where it is (an area of vn-save-store) and its path in that area */
export interface InstalledProgram {
  area: SaveArea;
  path: string;
  size: number;
  /** A shortcut (Start Menu, desktop) the installer made points at it */
  shortcut: boolean;
}

/** The folder Windows path → path in an area: C:\files\<folder>\… and the prefix's C:\ */
function areaPath(target: string, folder: string, areas: SaveArea[]) {
  const path = target.replaceAll('\\', '/');
  const inFolder = new RegExp(`^c:/files/${folder}/`, 'i');

  if (inFolder.test(path)) return { area: areas[0], path: path.replace(inFolder, '') };
  if (/^c:\//i.test(path)) return { area: areas[1], path: `drive_c/${path.slice(3)}` };
  return undefined;
}

/**
 * The programs an install left: .exe files written into the game folder, or into the prefix's
 * drive_c since `since` (ms), shortcut targets first. Uninstallers and setup tools come last
 * (windowsPrograms).
 */
export async function installedPrograms(title: string, folder: string, since: number) {
  const areas = vnSaveAreas(title, { encoding: 'sjis', files: [], engine: 'vnbox', folder });
  const [game, prefix] = await Promise.all(areas.map(listSaves));
  const fresh = prefix.filter((entry) => !entry.dir && entry.modified >= since - 60_000);
  const found = new Map<string, InstalledProgram>();
  const key = (area: SaveArea, path: string) => `${area.db}|${path.toLowerCase()}`;
  const add = (area: SaveArea, entry: SaveEntry, shortcut: boolean) =>
    found.set(key(area, entry.path), { area, path: entry.path, size: entry.size, shortcut });

  for (const entry of game)
    if (!entry.dir && /\.exe$/i.test(entry.path)) add(areas[0], entry, false);
  for (const entry of fresh) {
    if (/^drive_c\/.*\.exe$/i.test(entry.path) && !/^drive_c\/windows\//i.test(entry.path))
      add(areas[1], entry, false);
  }
  for (const entry of fresh.filter((entry) => /\.lnk$/i.test(entry.path))) {
    const bytes = await readSaveFile(areas[1], entry.key);
    const target = bytes && lnkTarget(bytes);
    const place = target && areaPath(target, folder, areas);
    const program = place && found.get(key(place.area, place.path));

    if (program) program.shortcut = true;
  }

  // By path for windowsPrograms' ranking (the same path in both areas is unlikely).
  const byPath = new Map([...found.values()].reverse().map((program) => [program.path, program]));

  return windowsPrograms(Object.fromEntries(byPath))
    .map((path) => byPath.get(path)!)
    .sort((a, b) => Number(b.shortcut) - Number(a.shortcut));
}

/**
 * The folder holding an installed program, as it is moved into the game's OPFS folder: all of
 * the game folder's layer, else the program's folder under Program Files (or drive_c).
 */
export function programRoot(program: InstalledProgram) {
  if (program.area.label === 'Game folder') return '';

  const parts = program.path.split('/');
  const depth = /^program files/i.test(parts[1] ?? '') ? 3 : 2;

  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

/**
 * Moves an installed game into its OPFS folder (vnbox/<folder>) and out of VNBox's IndexedDB
 * layer, where it would load whole into memory each start; removes the installer's copy.
 * Returns the program's path in the folder.
 */
export async function moveInstalledGame(
  folder: string,
  program: InstalledProgram,
  onProgress: (done: number, total: number) => void
) {
  const root = programRoot(program);
  const under = (path: string) => !root || path.startsWith(`${root}/`);
  const entries = (await listSaves(program.area)).filter((entry) => under(entry.path));
  const files = entries.filter((entry) => !entry.dir);
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  let done = 0;

  onProgress(0, total);
  for (const entry of files) {
    const bytes = await readSaveFile(program.area, entry.key);
    const path = root ? entry.path.slice(root.length + 1) : entry.path;

    if (bytes) {
      await copyWindowsGame(folder, { [path]: new File([bytes], path) }, () => undefined);
    }
    done += entry.size;
    onProgress(done, total);
  }
  await deleteSaves(program.area, entries, '');

  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('vnbox');
  const game = await dir.getDirectoryHandle(folder);

  await game.removeEntry(setupFolder, { recursive: true }).catch(() => undefined);

  return root ? program.path.slice(root.length + 1) : program.path;
}

/**
 * The player's address for an install: the game's (empty) folder, the discs in the drive, the
 * installer as the program, run in workingDir (a Windows path) with args. No fitWindow: an
 * installer opens several windows.
 */
export function installUrl(
  folder: string,
  program: string,
  args: string,
  workingDir: string,
  discs: string[]
) {
  const tuning = ['fitWindow=false', `w=${encodeURIComponent(workingDir)}`];

  if (args) tuning.push(`args=${encodeURIComponent(args)}`);

  return vnboxPlayerUrl(
    { encoding: 'sjis', files: [], engine: 'vnbox', folder, exe: program, discs },
    undefined,
    tuning.join('&')
  );
}
