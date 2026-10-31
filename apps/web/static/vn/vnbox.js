/**
 * Player for Windows games: VNBox (vnbox/, GPL-2.0, a fork of Boxedwine fetched by
 * scripts/vnbox/build.sh) in a same-origin iframe of the reader's /v page. VNBox reads its
 * settings from this page's address (vnboxPlayerUrl in lib/data/vn/windows-game.ts): the game
 * folder in OPFS, the program and the dc00 text hook script, whose lines arrive at
 * window.boxedwineText(line, thread). The selected thread's lines go to the overlay (overlay.js)
 * and the page, as player.js does with CONscripter's pages; the others only to vnboxHooks (the
 * Hooks sheet). The page calls startGame() once the frame loaded.
 */

// The game's screen, which overlay lines are laid out in (vnboxLines in lib/data/vn/vn.ts): VNBox
// sizes its screen to the game's window (fitWindow), so it is read from the canvas.
var g_screen_width = 800;
var g_screen_height = 600;
// overlay.js's hooks: hooks give no voice files and there is no backlog to read.
var lineVoice = null;
hookedLines = true;

function voiceFile() {
  return null;
}

function shownPages() {
  return [];
}

// Wine's frames go to the present canvas while it is shown (VNBox hides it when the game
// draws with GL on #canvas), so screenshots for Anki come from whichever is visible.
function screenCanvas() {
  var present = document.getElementById('boxedwine-webgl-canvas-0');
  var style = present && getComputedStyle(present);

  // The same test as VNBox's own activeCanvas (boxedwine.js).
  return present && present.width && style.display !== 'none' && style.visibility !== 'hidden'
    ? present
    : document.getElementById('canvas');
}

// The page's CONscripter settings (furigana, text speed) have no VNBox counterpart; Skip holds
// Ctrl, the key most Windows visual novels skip with while it is down.
function engineSet(name, value) {
  if (name === 'Skip') gameKey(!!value, 'ControlLeft', 'Control', 17);
}

/** The game's menu: a right click where the pad's cursor is, else in the middle of the game. */
function openMenu() {
  var at = cursorAt();

  gameMouse('mousedown', 2, at.x, at.y);
  gameMouse('mouseup', 2, at.x, at.y);
}

// Touch (phones, tablets): VNBox only takes the mouse, so a finger is the left button, sent the way
// passToGame's copies go; SDL's own touch handling never gets it. Touches on the overlay's text
// are overlay.js's, which passes them on to the canvas as copies, so they come back here.
var touchId = null;

function touchMouse(event) {
  if (document.getElementById('overlay').contains(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  padCursor.hidden = true;

  var touch = Array.prototype.find.call(event.changedTouches, function (each) {
    return event.type === 'touchstart' ? touchId === null : each.identifier === touchId;
  });

  if (!touch) return;
  if (event.type === 'touchstart') {
    touchId = touch.identifier;
    gameMouse('mousemove', 0, touch.clientX, touch.clientY);
    gameMouse('mousedown', 0, touch.clientX, touch.clientY);
  } else if (event.type === 'touchmove') {
    gameMouse('mousemove', 0, touch.clientX, touch.clientY);
  } else {
    touchId = null;
    gameMouse('mouseup', 0, touch.clientX, touch.clientY);
  }
}

['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
  window.addEventListener(type, touchMouse, { capture: true, passive: false });
});

// Gamepads (the page's watchGamepads): a visible cursor the left stick and d-pad move, clicks
// and the wheel where it is. A real mouse hides it.
var padCursor = document.createElement('div');

padCursor.id = 'pad-cursor';
padCursor.hidden = true;
document.body.appendChild(padCursor);
window.addEventListener(
  'mousemove',
  function (event) {
    if (event.isTrusted) padCursor.hidden = true;
  },
  true
);

function cursorAt() {
  if (padCursor.hidden) return canvasMiddle();
  return { x: parseFloat(padCursor.style.left), y: parseFloat(padCursor.style.top) };
}

/** Moves the cursor by its speed (each axis -1…1) for ms milliseconds, within the game. */
function padMove(dx, dy, ms) {
  var box = screenCanvas().getBoundingClientRect();
  var at = cursorAt();
  // Crossing the game in about two seconds at full tilt.
  var speed = (Math.max(box.width, box.height) / 2000) * ms;
  var x = Math.max(box.left, Math.min(box.right - 1, at.x + dx * speed));
  var y = Math.max(box.top, Math.min(box.bottom - 1, at.y + dy * speed));

  padCursor.style.left = x + 'px';
  padCursor.style.top = y + 'px';
  padCursor.hidden = false;
  gameMouse('mousemove', 0, x, y);
}

/** A pad action pressed (down) or released (lib/data/vn/vn-gamepad.ts; directions move the cursor). */
function padButton(action, down) {
  var at = cursorAt();

  if (action === 'advance') gameMouse(down ? 'mousedown' : 'mouseup', 0, at.x, at.y);
  else if (action === 'menu' && down) openMenu();
  else if (action === 'wheelUp' && down) gameWheel(-120, at.x, at.y);
  else if (action === 'wheelDown' && down) gameWheel(120, at.x, at.y);
}

// Overlay lines scale with the game, which VNBox fits into the frame.
function fitOverlay() {
  var canvas = screenCanvas();
  var border = document.querySelector('.emscripten_border');

  g_screen_width = canvas.width || 800;
  g_screen_height = canvas.height || 600;
  document
    .getElementById('overlay')
    .style.setProperty('--scale', border.getBoundingClientRect().width / g_screen_width);
}

new ResizeObserver(fitOverlay).observe(document.querySelector('.emscripten_border'));

// startGame's onScreen(width, height): each size VNBox's screen takes (fitWindow sizes it to the
// game's window), so the page can keep a game's size (fittedTuning in lib/data/vn/windows-game.ts).
var onScreen = function () {};
var screenSize = '';

new MutationObserver(function () {
  var canvas = screenCanvas();
  var size = canvas.width + 'x' + canvas.height;

  if (size === screenSize) return;
  screenSize = size;
  onScreen(canvas.width, canvas.height);
}).observe(document.getElementById('dropzone'), {
  subtree: true,
  attributes: true,
  attributeFilter: ['width', 'height', 'style']
});

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var script = document.createElement('script');

    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

// Hook threads (VNBox's boxedwineText(line, thread), hooks contract): every thread's last line,
// count and recent lines with the click they came after, for the Hooks sheet and rankThreads.
var hookThreads = {};
// A search can make a thread per call site: keep the most recently heard ones.
var HOOK_THREADS = 200;
var hookHeard = 0;
// The thread whose lines drive the overlay, stats and Anki; null: hook scripts (today's behaviour).
var hookSelected = null;
// After a live load: the kind whose next new thread is picked, so a loaded hook drives at once.
var hookFollow = null;
// Handles of hooks loaded here, which "Back to the saved hook" unloads.
var hookHandles = [];
var hookListeners = [];
var hookTimer = 0;
var clicks = 0;

// Touches reach the game as mousedowns (touchMouse), so they aren't counted twice. Modifiers are
// Yomitan's scan keys, not clicks.
['mousedown', 'keydown'].forEach(function (type) {
  window.addEventListener(
    type,
    function (event) {
      if (!/^(Shift|Control|Alt|Meta)$/.test(event.key)) clicks += 1;
    },
    true
  );
});

// Set by the page: the scan modifier keys (KeyboardEvent.key) the key gate keeps from the game.
var scanKeys = ['Shift'];

function hookChanged() {
  // Search hooks can fire per character: tell the sheet at most 4 times a second.
  hookTimer =
    hookTimer ||
    setTimeout(function () {
      hookTimer = 0;
      hookListeners.forEach(function (listener) {
        listener();
      });
    }, 250);
}

// Over HOOK_THREADS: drops the thread heard longest ago, never the selected one.
function pruneHookThreads() {
  var ids = Object.keys(hookThreads);
  if (ids.length <= HOOK_THREADS) return;
  var oldest = null;
  ids.forEach(function (id) {
    if (id === String(hookSelected)) return;
    if (!oldest || hookThreads[id].heard < hookThreads[oldest].heard) oldest = id;
  });
  if (oldest) delete hookThreads[oldest];
}

// Not `drives`: VNBox v0.2.2's boxedwine-shell.js has a global `var drives` in this frame.
function threadDrives(thread) {
  return hookSelected ? thread.id === hookSelected : thread.kind === 'script';
}

// Feature-detected: VNBox before the hooks contract has no runtime loading.
function frida() {
  var api = window.boxedwineFrida;
  return api && typeof api.load === 'function' ? api : null;
}

function loaded(kind, handle) {
  hookHandles.push(handle);
  hookFollow = kind;
  hookChanged();
  return handle;
}

/** The Hooks sheet's view of the hooks (vnbox-hooks.svelte). */
var vnboxHooks = {
  live: function () {
    return !!frida();
  },
  threads: function () {
    return Object.keys(hookThreads).map(function (id) {
      return hookThreads[id];
    });
  },
  selected: function () {
    return hookSelected;
  },
  select: function (id) {
    hookSelected = id;
    hookFollow = null;
    hookChanged();
  },
  /** Calls listener() after thread changes; returns the unsubscribe. */
  listen: function (listener) {
    hookListeners.push(listener);
    return function () {
      hookListeners = hookListeners.filter(function (other) {
        return other !== listener;
      });
    };
  },
  load: function (source) {
    return loaded('script', frida().load(source, 'Hooks sheet'));
  },
  loadHcode: function (code) {
    return loaded('hcode', frida().loadHcode(code));
  },
  searching: function () {
    return !!frida()?.search.running;
  },
  searchStart: function () {
    frida().search.start();
    hookChanged();
  },
  searchStop: function () {
    var api = frida();
    var thread = hookThreads[hookSelected];

    // A picked search thread stays as its own hook; stop() detaches the other search hooks.
    if (thread && thread.kind === 'search') hookHandles.push(api.keep(thread.id));
    api.search.stop();
    hookChanged();
  },
  scriptFor: function (id) {
    return frida().scriptFor(id);
  },
  /** Back to the boot hook: unloads what was loaded here and stops a search. */
  reset: function () {
    var api = frida();

    if (api) {
      hookHandles.forEach(function (handle) {
        api.unload(handle);
      });
      if (api.search.running) api.search.stop();
    }
    hookHandles = [];
    vnboxHooks.select(null);
  }
};

/**
 * options: textLines(line) (overlay lines), onText(line), onScreen(width, height) (screen size
 * changes), keepLines (keep the recent lines with their screenshots for ankiMedia()), recordLines
 * (and record their sound), clean(line, threadId) (the game's text cleanup: the line to use, ''
 * to drop it).
 */
async function startGame(options) {
  onScreen = options.onScreen || onScreen;
  keepLines = !!options.keepLines;
  recordLines = !!options.recordLines && typeof MediaRecorder !== 'undefined';
  window.boxedwineText = function (line, thread) {
    // VNBox before the hooks contract sends no thread: its lines are the boot hook script's.
    thread = thread || { id: 'script', kind: 'script' };
    var known = hookThreads[thread.id];

    if (!known) {
      known = hookThreads[thread.id] = Object.assign({}, thread, {
        count: 0,
        recent: [],
        heard: ++hookHeard
      });
      if (hookFollow === thread.kind) vnboxHooks.select(thread.id);
      pruneHookThreads();
    }
    known.heard = ++hookHeard;
    known.last = line;
    known.count += 1;
    known.recent = known.recent.slice(-19).concat([{ text: line, click: clicks }]);
    hookChanged();
    if (!threadDrives(known)) return;
    if (options.clean) line = options.clean(line, thread.id);
    if (!line) return;
    // The screen can change size without the frame's box changing (same aspect).
    fitOverlay();
    var lines = options.textLines(line, g_screen_width, g_screen_height);

    showText(lines);
    options.onText(line);
    keepLine(lines);
  };
  // VNBox takes mouse and key events on window (capture, stopImmediatePropagation) anywhere over
  // the game, so Yomitan never saw a mousemove over the lines. Events on the overlay's text skip
  // the page's window mouse listeners (VNBox's, added once it runs; Yomitan's world has its own)
  // and go overlay.js's way: hover stays with the page, the rest reaches VNBox as passToGame's copy.
  var overlay = document.getElementById('overlay');
  // Key gate: many engines hide the text box or skip on Shift, so a scan modifier (scanKeys)
  // pressed with the pointer on the overlay's text is held back from VNBox (and VNBox's
  // stopImmediatePropagation doesn't keep it from Yomitan). It reaches the game late, just before
  // the next key or click it goes with; released alone, the game never sees it. Untrusted events
  // (the pad's gameKey, the late copy itself) always pass.
  var overText = false;
  var gated = new WeakSet();
  var heldKey = null;
  var sendHeld = function () {
    if (!heldKey || heldKey.sent) return;
    heldKey.sent = true;
    gameKey(true, heldKey.code, heldKey.key, heldKey.keyCode);
  };
  window.addEventListener(
    'pointermove',
    function (event) {
      overText = overlay.contains(event.target);
    },
    true
  );
  window.addEventListener('mousedown', sendHeld, true);
  window.addEventListener('blur', function () {
    heldKey = null;
  });
  ['keydown', 'keyup'].forEach(function (type) {
    window.addEventListener(
      type,
      function (event) {
        if (!event.isTrusted) return;
        var held = heldKey && heldKey.code === event.code;

        if (type === 'keydown' && !held && overText && scanKeys.indexOf(event.key) >= 0) {
          heldKey = { code: event.code, key: event.key, keyCode: event.keyCode, sent: false };
          held = true;
        } else if (type === 'keydown' && !held) {
          sendHeld();
        }
        if (held && !heldKey.sent) gated.add(event);
        if (held && type === 'keyup') heldKey = null;
      },
      true
    );
  });
  var addWindowListener = window.addEventListener;
  var removeWindowListener = window.removeEventListener;
  // listener → its wrapper, so removeEventListener(type, listener) removes the wrapper.
  var wrappers = new WeakMap();
  var wrapped = function (target, type, listener) {
    if (target !== window || !/^(mouse|key)/.test(type) || typeof listener !== 'function')
      return listener;
    if (!wrappers.has(listener)) {
      wrappers.set(listener, function (event) {
        var skip = /^mouse/.test(type) ? overlay.contains(event.target) : gated.has(event);
        if (!skip) return listener.call(this, event);
      });
    }
    return wrappers.get(listener);
  };
  window.addEventListener = function (type, listener, options) {
    return addWindowListener.call(this, type, wrapped(this, type, listener), options);
  };
  window.removeEventListener = function (type, listener, options) {
    return removeWindowListener.call(this, type, wrapped(this, type, listener), options);
  };
  // Fetched in parallel, run in order (async = false): the shell uses the libraries before it,
  // and boxedwine.js starts the shell's setup.
  var scripts = ['fsfs.js', 'lazyfs.js', 'frida-compat.js', 'boxedwine-shell.js', 'boxedwine.js'];

  await Promise.all(
    scripts.map(function (name) {
      return loadScript('vnbox/' + name);
    })
  );
  document.getElementById('canvas').focus();
}
