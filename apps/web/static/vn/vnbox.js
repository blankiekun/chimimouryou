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

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var script = document.createElement('script');

    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

/**
 * options: textLines(line) (overlay lines), onText(line), keepLines (keep the recent lines with
 * their screenshots for ankiMedia()), recordLines (and record their sound).
 */
async function startGame(options) {
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
  window.addEventListener = function (type, listener, options) {
    var own =
      this === window && /^mouse/.test(type) && typeof listener === 'function'
        ? function (event) {
            if (!overlay.contains(event.target)) return listener.call(this, event);
          }
        : listener;
    return addWindowListener.call(this, type, own, options);
  };
  // In order: the shell uses the libraries before it, and boxedwine.js starts the shell's setup.
  var scripts = ['fsfs.js', 'lazyfs.js', 'frida-compat.js', 'boxedwine-shell.js', 'boxedwine.js'];

  for (var index = 0; index < scripts.length; index += 1) {
    await loadScript('vnbox/' + scripts[index]);
  }
  document.getElementById('canvas').focus();
}
