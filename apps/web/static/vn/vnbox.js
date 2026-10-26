/**
 * Player for Windows games: VNBox (vnbox/, GPL-2.0, a fork of Boxedwine fetched by
 * scripts/vnbox/build.sh) in a same-origin iframe of the reader's /v page. VNBox reads its
 * settings from this page's address (vnboxPlayerUrl in lib/data/windows-game.ts): the game
 * folder in OPFS, the program and the dc00 text hook script, whose lines arrive at
 * window.boxedwineText(line). Each line goes to the overlay (overlay.js) and the page, as
 * player.js does with CONscripter's pages. The page calls startGame() once the frame loaded.
 */

// The screen overlay lines are laid out in (vnboxScreen in lib/data/vn.ts).
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

// The page's CONscripter settings (furigana, text speed) have no VNBox counterpart.
function engineSet() {}

// Overlay lines scale with the game, which VNBox fits into the frame.
new ResizeObserver(function (entries) {
  document
    .getElementById('overlay')
    .style.setProperty('--scale', entries[0].contentRect.width / g_screen_width);
}).observe(document.querySelector('.emscripten_border'));

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
    var lines = options.textLines(line);

    showText(lines);
    options.onText(line);
    keepLine(lines);
  };
  // In order: the shell uses the libraries before it, and boxedwine.js starts the shell's setup.
  var scripts = ['fsfs.js', 'lazyfs.js', 'frida-compat.js', 'boxedwine-shell.js', 'boxedwine.js'];

  for (var index = 0; index < scripts.length; index += 1) {
    await loadScript('vnbox/' + scripts[index]);
  }
  document.getElementById('canvas').focus();
}
