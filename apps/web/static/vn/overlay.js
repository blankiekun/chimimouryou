/**
 * The text overlay and Anki mining shared by the visual novel players (player.html for
 * CONscripter, vnbox.html for Windows games), loaded before the player's own script. The
 * player defines g_screen_width/g_screen_height (the screen the overlay lines are laid out
 * in), lineVoice (the voice of the line being read), voiceFile(file) and shownPages() (backlog
 * text on screen), and may redefine screenCanvas() and set hookedLines; the page's text source
 * (lib/data/vn/vn-text.ts) gives it the lines to show.
 */
function overlayLine(line) {
  var div = document.createElement('div');

  div.textContent = line.text;
  div.style.left = (100 * line.x) / g_screen_width + '%';
  div.style.top = (100 * line.y) / g_screen_height + '%';
  div.style.fontSize = 'calc(var(--scale) * ' + line.size + 'px)';
  div.style.letterSpacing = 'calc(var(--scale) * ' + (line.pitch - line.size) + 'px)';
  // Yomitan reads the writing mode to scan the column and place its popup beside it.
  if (line.vertical) div.style.writingMode = 'vertical-rl';
  return div;
}

/** lines: [{ text, x, y, size, pitch, vertical? }] in screen pixels (overlayLines in lib/data/vn/vn.ts). */
function showText(lines) {
  document
    .getElementById('page-text')
    .replaceChildren.apply(document.getElementById('page-text'), lines.map(overlayLine));
}

/**
 * Set by the page while its built-in dictionary is on: textTap(x, y) looks up the text at a tap
 * (frame coordinates) and is true when it found a word, so the game doesn't get the tap.
 */
var textTap = null;
var heldTouch = null;

// Clicks on the overlay's text go to the game, as if the text weren't there.
[
  'mousedown',
  'mouseup',
  'mousemove',
  'click',
  'contextmenu',
  'wheel',
  'touchstart',
  'touchmove',
  'touchend'
].forEach(function (type) {
  document.getElementById('overlay').addEventListener(type, function (event) {
    // Hover stays with the page (Yomitan scans on mousemove); the rest is the game's.
    if (type !== 'mousemove') event.preventDefault();
    // While the page's built-in lookups are on, a tap on text is held until it ends: a tap
    // that finds a word is the popup's, anything else goes to the game after all.
    if (type === 'touchstart' && textTap && event.touches.length === 1) {
      heldTouch = event;
      return;
    }
    if (heldTouch) {
      var held = heldTouch;
      heldTouch = null;
      var touch = event.changedTouches && event.changedTouches[0];
      if (type === 'touchend' && touch && textTap && textTap(touch.clientX, touch.clientY)) return;
      passToGame(held);
    }
    passToGame(event);
  });
});

document.getElementById('overlay').addEventListener('touchcancel', function () {
  heldTouch = null;
});

function passToGame(event) {
  var Copy = event.constructor;

  try {
    document.getElementById('canvas').dispatchEvent(new Copy(event.type, event));
  } catch (error) {
    console.warn('Could not pass ' + event.type + ' to the game', error);
  }
}

// Gamepads (lib/data/vn/vn-gamepad.ts): the page reads them and sends the game mouse and keys, so the
// engines' own SDL never sees one (it would act twice); framePads() keeps them for the page.
var framePads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : null;

if (framePads) {
  navigator.getGamepads = function () {
    return [];
  };
}
window.addEventListener('gamepadconnected', function () {
  parent.dispatchEvent(new Event('gamepadconnected'));
});

/** A mouse event at x, y (frame coordinates) on the game's canvas, as passToGame's copies go. */
function gameMouse(type, button, x, y) {
  document.getElementById('canvas').dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: button,
      buttons: type === 'mousedown' ? 1 << button : 0,
      clientX: x,
      clientY: y
    })
  );
}

function gameWheel(deltaY, x, y) {
  document.getElementById('canvas').dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: deltaY,
      clientX: x,
      clientY: y
    })
  );
}

/** A key (KeyboardEvent code, key and legacy keyCode) pressed or released on the game. */
function gameKey(down, code, key, keyCode) {
  var event = new KeyboardEvent(down ? 'keydown' : 'keyup', {
    bubbles: true,
    cancelable: true,
    code: code,
    key: key,
    ctrlKey: down && key === 'Control'
  });

  // Engines that still read keyCode get it too (the constructor leaves it 0).
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  Object.defineProperty(event, 'which', { value: keyCode });
  document.getElementById('canvas').dispatchEvent(event);
}

/** The middle of the game's canvas, in frame coordinates. */
function canvasMiddle() {
  var box = screenCanvas().getBoundingClientRect();

  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// Right-click is the game's (menu, skip): never the browser's menu, on the canvas or the black bars.
document.addEventListener('contextmenu', function (event) {
  event.preventDefault();
});

// The recent lines with their voice files, for the page's Backlog (always) and Anki mining
// (lib/data/dictionary/anki.ts): while mining, the newest also keep their screenshot and sound, so a
// note gets those of the line it was mined from (vnLineFor), however late it is noticed or from
// however far back in a backlog.
var KEPT_LINES = 500;
var KEPT_MEDIA = 30;
var keptLines = []; // [{ text, voice, picture?: Promise<Blob>, audio?: Promise<Blob> }], oldest first
var keepLines = false; // mining: keep screenshots and sound too
// Set by players whose lines come from a text hook (vnbox.js), which fires before the text is
// fully drawn and again when the game's own backlog screen shows a line.
var hookedLines = false;
// A hooked line whose screenshot is retaken at the next click or key (keepLine).
var retakeLine = null;
var soundTap;
var lineRecorder;
var recordLines = false;
var nativeConnect = AudioNode.prototype.connect;
var nativeGetContext = HTMLCanvasElement.prototype.getContext;

// Whatever the engine sends to the speakers is also sent to soundTap.
AudioNode.prototype.connect = function (target) {
  if (recordLines && target instanceof AudioDestinationNode) {
    if (!soundTap) {
      soundTap = this.context.createMediaStreamDestination();
      restartLineRecorder();
    }
    if (soundTap.context === this.context) nativeConnect.call(this, soundTap);
  }
  return nativeConnect.apply(this, arguments);
};

// Keeps the last frame readable after it is shown, for screenshots. Only while mining: it costs a
// buffer copy per frame. startGame sets keepLines before it loads the engine, so before any context.
HTMLCanvasElement.prototype.getContext = function (type, attributes) {
  if (keepLines && (type === 'webgl' || type === 'webgl2')) {
    attributes = Object.assign({}, attributes, { preserveDrawingBuffer: true });
  }
  return nativeGetContext.call(this, type, attributes);
};

/** At each click wait: the page so far and its voice; while mining also its screen and (being recorded) sound. */
function keepLine(lines) {
  var text = lines
    .map(function (l) {
      return l.text;
    })
    .join('');
  // A hooked line shown again (the game's backlog screen) keeps the media it had the first time.
  var earlier = hookedLines
    ? keptLines
        .slice()
        .reverse()
        .find(function (kept) {
          return kept.text === text && kept.picture;
        })
    : null;
  var line = earlier
    ? { text: text, voice: earlier.voice, picture: earlier.picture, audio: earlier.audio }
    : { text: text, voice: lineVoice, picture: keepLines ? screenshot() : undefined };

  // A hook fires before its text is drawn: the screen at the next click or key is the line's,
  // if one comes before the next line.
  retakeLine = keepLines && hookedLines && !earlier ? line : null;
  // The sound recorded since the click that brought this line is its sound.
  if (!earlier && lineRecorder && lineRecorder.state !== 'inactive') lineRecorder.line = line;
  keptLines.push(line);
  if (keptLines.length > KEPT_LINES) keptLines.shift();

  var old = keptLines[keptLines.length - 1 - KEPT_MEDIA];

  if (old) old.picture = old.audio = undefined;
}

function stopLineRecorder() {
  if (!lineRecorder || lineRecorder.state === 'inactive') return;
  lineRecorder.stop();
  if (lineRecorder.line) lineRecorder.line.audio = lineRecorder.stopped;
}

function restartLineRecorder(event) {
  // Modifier keys are Yomitan's scan keys, not the game's.
  // Held keys repeat: the line's sound goes on.
  if (event && (event.repeat || /^(Shift|Control|Alt|Meta)$/.test(event.key))) return;
  stopLineRecorder();
  if (!soundTap) return;

  var chunks = [];
  var recorder = new MediaRecorder(soundTap.stream);

  recorder.ondataavailable = function (e) {
    chunks.push(e.data);
  };
  recorder.stopped = new Promise(function (resolve) {
    recorder.onstop = function () {
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
  });
  recorder.start();
  lineRecorder = recorder;
}

function retakeScreenshot(event) {
  if (!retakeLine || event.repeat || /^(Shift|Control|Alt|Meta)$/.test(event.key)) return;
  // Not once its media was dropped (older than KEPT_MEDIA).
  if (retakeLine.picture) retakeLine.picture = screenshot();
  retakeLine = null;
}

['mousedown', 'touchstart', 'keydown'].forEach(function (type) {
  // First: the screen as it is before the game takes the click.
  window.addEventListener(type, retakeScreenshot, true);
  window.addEventListener(type, restartLineRecorder, true);
});

/** The kept lines' text, oldest first, for vnLineFor. */
function ankiTexts() {
  return keptLines.map(function (line) {
    return line.text;
  });
}

/**
 * The kept lines for the page's Backlog sheet, oldest first: their text and whether their
 * screenshot and sound (voice file, recorded or being recorded) are still kept.
 */
function keptLineList() {
  return keptLines.map(function (line) {
    if (line.hasVoice === undefined) line.hasVoice = !!voiceFile(line.voice);
    return {
      text: line.text,
      picture: !!line.picture,
      sound:
        line.hasVoice ||
        !!line.audio ||
        (!!lineRecorder && lineRecorder.line === line && lineRecorder.state !== 'inactive')
    };
  });
}

function ankiShownTexts() {
  return shownPages().map(function (page) {
    return page.text;
  });
}

/**
 * Media for a mined line: kept line ankiTexts()[kept] and/or backlog page
 * ankiShownTexts()[shown] (-1 for none). The picture is the screen when the line was shown,
 * if still kept, else the screen as it is now (the backlog). The sound is the line's voice
 * file, else the sound recorded from the click that brought it to the next, else the backlog
 * page's voice file (null without sound).
 */
async function ankiMedia(kept, shown, want) {
  var line = keptLines[kept] || {};
  var page = shownPages()[shown] || {};

  // Still being recorded: stop here, so its sound ends now.
  if (lineRecorder && lineRecorder.line === line) stopLineRecorder();
  return {
    picture: want.picture ? (await line.picture) || (await screenshot()) : null,
    audio: want.audio
      ? voiceFile(line.voice) || (await line.audio) || voiceFile(page.voice) || null
      : null
  };
}

/** The canvas the game is shown on; a player whose engine presents elsewhere redefines it. */
function screenCanvas() {
  return document.getElementById('canvas');
}

function screenshot() {
  return new Promise(function (resolve) {
    screenCanvas().toBlob(resolve, 'image/webp', 0.9);
  });
}
