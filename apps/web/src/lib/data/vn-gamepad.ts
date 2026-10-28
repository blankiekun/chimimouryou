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

/**
 * Polls the first connected pad each animation frame while one is connected and the tab is
 * visible; `pads()` gives the pads (the page's, else the frame's). Returns the stop function.
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
  let last = 0;

  function poll(time: number) {
    frame = 0;

    const pad = pads().find((each) => each?.connected);
    const now = pad ? heldActions(pad) : new Set<PadAction>();
    const { pressed, released } = padChanges(held, now);

    held = now;
    if (pressed.length || released.length) handlers.change(pressed, released);
    if (!pad || document.visibilityState !== 'visible') return;

    const [dx, dy] = cursorSpeed(pad);

    if ((dx || dy) && last) handlers.cursor(dx, dy, Math.min(time - last, 50));
    last = time;
    frame = requestAnimationFrame(poll);
  }

  function start() {
    if (!frame && document.visibilityState === 'visible') {
      last = 0;
      frame = requestAnimationFrame(poll);
    }
  }

  window.addEventListener('gamepadconnected', start);
  document.addEventListener('visibilitychange', start);
  start();

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('gamepadconnected', start);
    document.removeEventListener('visibilitychange', start);
  };
}
