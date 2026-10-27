/**
 * The text overlay and Anki mining shared by the visual novel players (player.html for
 * CONscripter, vnbox.html for Windows games), loaded before the player's own script. The
 * player defines g_screen_width/g_screen_height (the screen the overlay lines are laid out
 * in), lineVoice (the voice of the line being read), voiceFile(file) and shownPages() (backlog
 * text on screen), and may redefine screenCanvas(); the page's text source
 * (lib/data/vn-text.ts) gives it the lines to show.
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

/** lines: [{ text, x, y, size, pitch, vertical? }] in screen pixels (overlayLines in lib/data/vn.ts). */
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

// Right-click is the game's (menu, skip): never the browser's menu, on the canvas or the black bars.
document.addEventListener('contextmenu', function (event) {
  event.preventDefault();
});

// Anki mining (lib/data/anki.ts): the recent lines with their voice files, and for the newest
// their screenshot and sound, so a note gets those of the line it was mined from (vnLineFor),
// however late it is noticed or from however far back in a backlog.
var KEPT_LINES = 500;
var KEPT_MEDIA = 30;
var keptLines = []; // [{ text, voice, picture?: Promise<Blob>, audio?: Promise<Blob> }], oldest first
var keepLines = false;
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

/** At each click wait while mining: the page so far, its voice, screen and (being recorded) sound. */
function keepLine(lines) {
  if (!keepLines) return;

  var line = {
    text: lines
      .map(function (l) {
        return l.text;
      })
      .join(''),
    voice: lineVoice,
    picture: screenshot()
  };

  // The sound recorded since the click that brought this line is its sound.
  if (lineRecorder && lineRecorder.state !== 'inactive') lineRecorder.line = line;
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

['mousedown', 'touchstart', 'keydown'].forEach(function (type) {
  window.addEventListener(type, restartLineRecorder, true);
});

/** The kept lines' text, oldest first, for vnLineFor. */
function ankiTexts() {
  return keptLines.map(function (line) {
    return line.text;
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
