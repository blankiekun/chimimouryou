/**
 * Player for Windows games: VNBox (vnbox/, GPL-2.0, a fork of Boxedwine fetched by
 * scripts/vnbox/build.sh) in a same-origin iframe of the reader's /v page. VNBox reads its
 * settings from this page's address (vnboxPlayerUrl in lib/data/windows-game.ts): the game
 * folder in OPFS, the program and the dc00 text hook script, whose lines arrive at
 * window.boxedwineText(line). Each line goes to the overlay (overlay.js) and the page, as
 * player.js does with CONscripter's pages. The page calls startGame() once the frame loaded.
 */

// The game's screen, which overlay lines are laid out in (vnboxLines in lib/data/vn.ts): VNBox
// sizes its screen to the game's window (fitWindow), so it is read from the canvas.
var g_screen_width = 800;
var g_screen_height = 600;
// overlay.js's hooks: hooks give no voice files and there is no backlog to read.
var lineVoice = null;

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

// The page's CONscripter settings (furigana, text speed) have no VNBox counterpart.
function engineSet() {}

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
// game's window), so the page can keep a game's size (fittedTuning in lib/data/windows-game.ts).
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

/**
 * options: textLines(line) (overlay lines), onText(line), onScreen(width, height) (screen size
 * changes), keepLines (keep the recent lines with their screenshots for ankiMedia()), recordLines
 * (and record their sound).
 */
async function startGame(options) {
  onScreen = options.onScreen || onScreen;
  keepLines = !!options.keepLines;
  recordLines = !!options.recordLines && typeof MediaRecorder !== 'undefined';
  window.boxedwineText = function (line) {
    // The screen can change size without the frame's box changing (same aspect).
    fitOverlay();
    var lines = options.textLines(line, g_screen_width, g_screen_height);

    showText(lines);
    options.onText(line);
    keepLine(lines);
  };
  // VNBox takes mouse events on window (capture, stopImmediatePropagation) anywhere over the game,
  // so Yomitan never saw a mousemove over the lines. Events on the overlay's text skip the page's
  // window mouse listeners (VNBox's, added once it runs; Yomitan's world has its own) and go
  // overlay.js's way: hover stays with the page, the rest reaches VNBox as passToGame's copy.
  var overlay = document.getElementById('overlay');
  var addWindowListener = window.addEventListener;
  var removeWindowListener = window.removeEventListener;
  // listener → its wrapper, so removeEventListener(type, listener) removes the wrapper.
  var wrappers = new WeakMap();
  var wrapped = function (target, type, listener) {
    if (target !== window || !/^mouse/.test(type) || typeof listener !== 'function')
      return listener;
    if (!wrappers.has(listener)) {
      wrappers.set(listener, function (event) {
        if (!overlay.contains(event.target)) return listener.call(this, event);
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
