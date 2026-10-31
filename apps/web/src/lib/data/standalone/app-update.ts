/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Compares the deployed version (/version.txt) with GitHub, for the admin panel's
 * Updates tool: the latest release (stable) or the main branch (bleeding edge). The update itself is done by the server's
 * ebook-update (account.ts requestUpdate). Also the Android app's update offer (offerApkUpdate). Not part of upstream.
 */

import { Capacitor } from '@capacitor/core';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import { dialogManager } from '$lib/data/dialog-manager';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';

export const defaultUpdateRepo = 'blankiekun/chimimouryou';
export const engineRepo = 'blankiekun/CONscripter';
export const learningGuideUrl = `https://github.com/${defaultUpdateRepo}/blob/main/docs/LEARNING.md`;

export type UpdateChannel = 'stable' | 'edge';

export const updateChannel$ = writableStringLocalStorageSubject<UpdateChannel>()(
  'updateChannel',
  'stable'
);

export interface UpdateCheck {
  /** What it was compared with: the latest release's tag, or main. */
  target: string;
  /** Deployed commit; empty if version.txt doesn't name one (e.g. a plain docker build). */
  current: string;
  /** Deployed with uncommitted changes. */
  dirty: boolean;
  /** The target's commit. */
  latest: string;
  /** behind: the target has newer commits; unknown: the deployed commit isn't on GitHub. */
  state: 'current' | 'behind' | 'ahead' | 'diverged' | 'unknown';
  /** Commits in the target that aren't deployed, newest first. */
  commits: { sha: string; message: string }[];
}

/** The commit in version.txt (deploy.sh: git describe --always --dirty). */
export function commitOfVersion(version: string) {
  const match = version.trim().match(/(?:^|-g)([0-9a-f]{7,40})(?:-dirty)?$/);

  return { commit: match ? match[1] : '', dirty: version.trim().endsWith('-dirty') };
}

async function github(repo: string, path: string) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store'
  });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(
      response.status === 403 || response.status === 429
        ? 'GitHub rate limit reached; try again in a while'
        : `GitHub answered HTTP ${response.status}`
    );
  }

  return response.json();
}

export async function checkForUpdate(
  repo: string,
  version: string,
  channel: UpdateChannel = 'edge'
): Promise<UpdateCheck> {
  const { commit: current, dirty } = commitOfVersion(version);
  let target = 'main';

  if (channel === 'stable') {
    const release = await github(repo, 'releases/latest');

    if (!release) {
      throw new Error(`${repo} has no release on GitHub`);
    }

    target = release.tag_name;
  }

  const compare = current ? await github(repo, `compare/${current}...${target}`) : undefined;

  if (!compare) {
    const head = await github(repo, `commits/${target}`);

    if (!head) {
      throw new Error(`${repo} has no ${target} on GitHub`);
    }

    return { target, current, dirty, latest: head.sha, state: 'unknown', commits: [] };
  }

  const commits: { sha: string; commit: { message: string } }[] = compare.commits ?? [];
  // GitHub describes the target relative to the deployed commit.
  const state = ({ identical: 'current', ahead: 'behind', behind: 'ahead' } as const)[
    compare.status as 'identical' | 'ahead' | 'behind'
  ];

  return {
    target,
    current,
    dirty,
    latest: commits.length ? commits[commits.length - 1].sha : current,
    state: state ?? 'diverged',
    commits: commits
      .map((entry) => ({ sha: entry.sha, message: entry.commit.message.split('\n')[0] }))
      .reverse()
  };
}

/** The visual novel engine's version (static/vn/conscripter-version.txt) and CONscripter's latest release. */
export async function checkEngineRelease(installed: string) {
  const release = await github(engineRepo, 'releases/latest');

  if (!release) {
    throw new Error(`${engineRepo} has no release on GitHub`);
  }

  const latest: string = release.tag_name;

  return {
    installed: installed.trim(),
    latest,
    url: release.html_url as string,
    newer: latest !== installed.trim(),
    /** build.sh needs the release's web build, which is uploaded after the tag. */
    webBuild: (release.assets ?? []).some((asset: { name: string }) =>
      asset.name.endsWith('_web.7z')
    )
  };
}

const parts = (version: string) => version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);

/** Whether release `tag` (v1.2.3) is a higher version than `current` (1.2.3); anything unparsable is not (as apps/desktop/version.js). */
export function isNewerVersion(tag: string, current: string) {
  const [a, b] = [parts(tag), parts(current)];

  if ([...a, ...b].some(Number.isNaN) || a.length < 3 || b.length < 3) return false;
  const index = a.findIndex((part, i) => part !== b[i]);

  return index >= 0 && a[index] > b[index];
}

/** The release's tag (release.yml sets it for the build the apps package); empty in other builds. */
const appVersion: string = import.meta.env.VITE_APP_VERSION || '';
const apkCheckKey = 'apkUpdateCheck';
const day = 86_400_000;

interface ApkCheck {
  checked: number;
  tag: string;
  url: string;
}

/**
 * A release newer than this Android app, with its APK. Only the `github` build (the one with the
 * MihonHost plugin; Play updates the `play` one) asks GitHub, at most once a day; the answer is
 * kept, so a release turned down with Later is offered again on the next start.
 */
export async function newerApk(current = appVersion, now = Date.now()) {
  if (!current || !Capacitor.isPluginAvailable('MihonHost')) return undefined;
  let check: ApkCheck | undefined;
  try {
    check = JSON.parse(localStorage.getItem(apkCheckKey) || 'null') ?? undefined;
  } catch {
    // No storage or a broken entry: ask GitHub.
  }
  if (!check || !(now >= check.checked && now - check.checked < day)) {
    let release;
    try {
      release = (await github(defaultUpdateRepo, 'releases/latest')) ?? {};
    } catch {
      return undefined; // Offline or rate limited: asked again on the next start.
    }
    const apk = (release.assets ?? []).find((asset: { name: string }) =>
      asset.name.endsWith('.apk')
    );
    check = { checked: now, tag: release.tag_name ?? '', url: apk?.browser_download_url ?? '' };
    try {
      localStorage.setItem(apkCheckKey, JSON.stringify(check));
    } catch {
      // Not kept: asked again on the next start.
    }
  }

  return check.url && isNewerVersion(check.tag, current)
    ? { version: check.tag.replace(/^v/, ''), url: check.url }
    : undefined;
}

/** On app start (root layout): "chimimouryou X.Y.Z is out", Download opens the APK in the system browser. */
export async function offerApkUpdate(window: Window) {
  const apk = await newerApk();
  if (!apk) return;
  const later = await new Promise<boolean>((resolver) =>
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          dialogHeader: `chimimouryou ${apk.version} is out`,
          dialogMessage:
            'Download the new APK and open it to install it over this one. Your books stay.',
          confirmLabel: 'Download',
          cancelLabel: 'Later',
          resolver
        }
      }
    ])
  );
  // Another site's address leaves the WebView for the system browser (Capacitor's Bridge.launchIntent).
  if (!later) window.open(apk.url, '_blank');
}
