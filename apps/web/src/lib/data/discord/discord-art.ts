/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The Discord app's small art (Progress ring, Kind icon) as SVG: drawn by the preview and turned
 * into the PNGs uploaded to the Discord app by scripts/discord-art.mjs. Erasable TypeScript with no
 * $lib imports, so Node runs it as is. Fixed hexes (Study Book dark colours), the approved
 * exception to theme colours, like the preview card. Not part of upstream.
 */

import { faBook, faBookOpen, faGamepad, faHeadphones } from '@fortawesome/free-solid-svg-icons';

const background = '#121413';
const track = '#2e3331';
const spot = '#4fbf95';
const ink = '#e9ebea';

const icons = { book: faBook, manga: faBookOpen, vn: faGamepad, listen: faHeadphones };

export type ArtKind = keyof typeof icons;
export const artKinds = Object.keys(icons) as ArtKind[];
/** 0, 5, … 100 */
export const ringSteps = Array.from({ length: 21 }, (_, index) => index * 5);

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
  `<circle cx="256" cy="256" r="256" fill="${background}"/>${body}</svg>`;

/** A ring filled to `step` percent, clockwise from the top; no number (Discord shows it ~24 px) */
export function ringSvg(step: number) {
  const radius = 176;
  const around = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, step)) / 100) * around;
  const ring = (colour: string, extra = '') =>
    `<circle cx="256" cy="256" r="${radius}" fill="none" stroke="${colour}" stroke-width="80"${extra}/>`;

  return svg(
    ring(track) +
      (filled > 0
        ? ring(
            spot,
            ` stroke-dasharray="${filled.toFixed(2)} ${around.toFixed(2)}" transform="rotate(-90 256 256)"`
          )
        : '')
  );
}

/** The kind's Font Awesome icon, light on the dark circle */
export function kindSvg(kind: ArtKind) {
  const [width, height, , , path] = icons[kind].icon;
  const scale = 260 / Math.max(width, height);
  const x = 256 - (width * scale) / 2;
  const y = 256 - (height * scale) / 2;
  const paths = (Array.isArray(path) ? path : [path]).map((d) => `<path d="${d}"/>`).join('');

  return svg(`<g fill="${ink}" transform="translate(${x} ${y}) scale(${scale})">${paths}</g>`);
}

/** SVG for a ring-N or kind-x art key; undefined for any other key */
export function artSvg(key?: string) {
  const ring = key?.match(/^ring-(\d+)$/);

  if (ring && ringSteps.includes(Number(ring[1]))) return ringSvg(Number(ring[1]));

  const kind = key?.match(/^kind-(\w+)$/)?.[1];

  return kind && Object.hasOwn(icons, kind) ? kindSvg(kind as ArtKind) : undefined;
}
