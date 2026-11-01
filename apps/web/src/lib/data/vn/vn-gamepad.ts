/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Gamepads in the visual novel player (/v), read with the Gamepad API by the page and turned
 * into the game's mouse and keys in the frame (player.js, vnbox.js; Wine gets no joystick).
 * One fixed map for the standard layout (Xbox names; a Steam Deck's buttons sit at the same
 * places). Not upstream.
 */

/** Standard-mapping button index → action. */
export const padButtonActions = {
  0: 'advance', // A: left click (Windows games) or Enter (CONscripter)
  1: 'menu', // B: the game's right click; closes an open sheet first
  2: 'skip', // X: skip on/off
  3: 'backlog', // Y: the Backlog sheet
  4: 'wheelUp', // LB: mouse wheel up (most games' own backlog)
  5: 'wheelDown', // RB: mouse wheel down
  8: 'fullscreen', // View/Select
  9: 'more', // Menu/Start: the More sheet
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right'
} as const;

export type PadAction = (typeof padButtonActions)[keyof typeof padButtonActions];

type Pad = Pick<Gamepad, 'buttons' | 'axes'>;

/** How far the left stick goes before it counts as a d-pad press (CONscripter's arrow keys). */
const stickPress = 0.5;
/** Stick travel ignored as drift. */
const deadZone = 0.2;

/** The actions held on a pad: its buttons, and the left stick pushed past half way as the d-pad. */
export function heldActions(pad: Pad) {
  const held = new Set<PadAction>();

  pad.buttons.forEach((button, index) => {
    const action = padButtonActions[index as keyof typeof padButtonActions];

    if (action && button.pressed) held.add(action);
  });

  const [x = 0, y = 0] = pad.axes;

  if (x <= -stickPress) held.add('left');
  if (x >= stickPress) held.add('right');
  if (y <= -stickPress) held.add('up');
  if (y >= stickPress) held.add('down');
  return held;
}

/** What changed between two polls: the actions pressed and released since `before`. */
export function padChanges(before: Set<PadAction>, now: Set<PadAction>) {
  return {
    pressed: [...now].filter((action) => !before.has(action)),
    released: [...before].filter((action) => !now.has(action))
  };
}

/**
 * The cursor's speed for Windows games, each axis -1…1: the left stick past its dead zone
 * (scaled so it starts slow), else the d-pad at full speed.
 */
export function cursorSpeed(pad: Pad): [number, number] {
  const axis = (value = 0) =>
    Math.abs(value) < deadZone
      ? 0
      : Math.sign(value) * ((Math.abs(value) - deadZone) / (1 - deadZone)) ** 2;
  const pressed = (index: number) => (pad.buttons[index]?.pressed ? 1 : 0);

  return [
    axis(pad.axes[0]) || pressed(15) - pressed(14),
    axis(pad.axes[1]) || pressed(13) - pressed(12)
  ];
}

/** The /v sheets a pad button opens or closes. */
export interface PadSheets {
  more: boolean;
  backlog: boolean;
  tuning: boolean;
  hooks: boolean;
  saves: boolean;
}

/** What the page does for a poll's changes, in order: its own actions, or a button in the game. */
export type PadEffect = 'skip' | 'fullscreen' | 'closeSaves' | { button: PadAction; down: boolean };

/**
 * A poll's presses and releases on /v: the sheets after them and the effects to run. The page's
 * own buttons (skip, Backlog, More, full screen; B closing a sheet) act here, the rest go to the
 * game; releases always do.
 */
export function padStep(
  sheets: PadSheets,
  pressed: PadAction[],
  released: PadAction[],
  game: { started: boolean; blocked: boolean }
) {
  const next = { ...sheets };
  const effects: PadEffect[] = released.map((button) => ({ button, down: false }));

  for (const action of pressed) {
    if (action === 'skip') {
      if (game.started) effects.push('skip');
    } else if (action === 'backlog') {
      next.more = false;
      next.backlog = !next.backlog && !game.blocked;
    } else if (action === 'more') {
      next.backlog = false;
      next.more = !next.more;
    } else if (action === 'fullscreen') {
      effects.push('fullscreen');
    } else if (action === 'menu' && (next.more || next.backlog || next.tuning || next.hooks)) {
      // B closes a sheet before it reaches the game.
      next.more = next.backlog = next.tuning = next.hooks = false;
    } else if (action === 'menu' && next.saves) {
      next.saves = false;
      effects.push('closeSaves');
    } else {
      effects.push({ button: action, down: true });
    }
  }

  return { sheets: next, effects };
}

/** A pad untouched this long is polled every `idlePoll` ms rather than each frame. */
const idleAfter = 1000;
const idlePoll = 50;

/**
 * Polls the first connected pad while one is connected and the tab is visible: each animation
 * frame while it is in use, every `idlePoll` ms once idle (a Steam Deck's pad is always
 * connected). `pads()` gives the pads (the page's, else the frame's). Returns the stop function.
 */
export function watchGamepads(
  pads: () => (Gamepad | null)[],
  handlers: {
    change: (pressed: PadAction[], released: PadAction[]) => void;
    cursor: (dx: number, dy: number, ms: number) => void;
  }
) {
  let held = new Set<PadAction>();
  let frame = 0;
  let idle = 0;
  let last = 0;
  let used = 0;

  function poll(time: number) {
    frame = 0;
    idle = 0;

    const pad = pads().find((each) => each?.connected);
    const now = pad ? heldActions(pad) : new Set<PadAction>();
    const { pressed, released } = padChanges(held, now);

    held = now;
    if (pressed.length || released.length) handlers.change(pressed, released);
    if (!pad || document.visibilityState !== 'visible') return;

    const [dx, dy] = cursorSpeed(pad);

    if (now.size || dx || dy) used = time;
    if ((dx || dy) && last) handlers.cursor(dx, dy, Math.min(time - last, 50));
    if (time - used < idleAfter) {
      last = time;
      frame = requestAnimationFrame(poll);
    } else {
      last = 0;
      idle = window.setTimeout(() => poll(performance.now()), idlePoll);
    }
  }

  function start() {
    if (!frame && !idle && document.visibilityState === 'visible') {
      last = 0;
      used = performance.now();
      frame = requestAnimationFrame(poll);
    }
  }

  window.addEventListener('gamepadconnected', start);
  document.addEventListener('visibilitychange', start);
  start();

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(idle);
    window.removeEventListener('gamepadconnected', start);
    document.removeEventListener('visibilitychange', start);
  };
}
