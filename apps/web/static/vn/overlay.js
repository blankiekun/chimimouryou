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
var keptLines = []; // [{ text, voice, picture?: Promise<Blob>, at, start, end?, recorded? }], oldest first
var keepLines = false; // mining: keep screenshots and sound too
// Set by players whose lines come from a text hook (vnbox.js), which fires before the text is
// fully drawn and again when the game's own backlog screen shows a line.
var hookedLines = false;
// Hooked lines waiting for their screenshot (the same line can be hooked twice), taken at the
// next click or key or as a different line comes, whichever is first (keepLine).
var waitingLines = [];
var recordLines = false;
var nativeConnect = AudioNode.prototype.connect;
var nativeGetContext = HTMLCanvasElement.prototype.getContext;

// The sound: one continuous recording of what the engine sends to the speakers (soundTap), the
// last 3 minutes kept as mono s16 at about 24 kHz in a ring placed by the sound's own clock, so a
// line's sound is cut from it by time (lineSound), whatever came between. A ScriptProcessorNode,
// not an AudioWorklet: worklets need a secure context, and the players also run over plain HTTP.
var RING_SECONDS = 180;
// A line starts at the first click or key after the line before it, if within this before it.
var CLICK_WITHIN = 3;
// Sound kept around a line's window for the page's voice finder (lib/data/vn/line-audio.ts).
var PRE_ROLL = 0.4;
var TAIL = 6;
var soundTap; // { node, context, rate, samples, end: frames written, in context time × rate }
var clickTimes = [];

function soundNow() {
  return soundTap ? soundTap.context.currentTime : performance.now() / 1000;
}

function startSoundTap(context) {
  var size = 2048;
  var step = context.sampleRate >= 44100 ? 2 : 1;
  var rate = context.sampleRate / step;
  var node = context.createScriptProcessor(size, 2, 1);
  var tap = {
    node: node,
    context: context,
    rate: rate,
    samples: new Int16Array(Math.round(rate * RING_SECONDS)),
    end: 0
  };
  var ring = tap.samples;

  node.onaudioprocess = function (event) {
    var input = event.inputBuffer;
    var left = input.getChannelData(0);
    var right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
    var count = Math.floor(input.length / step);
    // The input block is two blocks before the one played at playbackTime (measured in Chromium).
    var at = Math.round((event.playbackTime - 2 * input.duration) * rate);
    var i;

    event.outputBuffer.getChannelData(0).fill(0);
    // Time the engine sent nothing for (a missed block): silence.
    for (i = Math.max(tap.end, at - ring.length); i < at; i += 1) ring[i % ring.length] = 0;
    for (i = 0; i < count; i += 1) {
      var sum = 0;

      for (var k = 0; k < step; k += 1) sum += left[i * step + k] + right[i * step + k];
      var value = Math.round((sum / (2 * step)) * 32767);
      if (at + i >= 0)
        ring[(at + i) % ring.length] = value > 32767 ? 32767 : value < -32768 ? -32768 : value;
    }
    tap.end = Math.max(tap.end, at + count);
  };
  nativeConnect.call(node, context.destination);
  // Clicks so far were timed by another clock.
  clickTimes = [];
  return tap;
}

// Whatever the engine sends to the speakers is also sent to soundTap.
AudioNode.prototype.connect = function (target) {
  if (recordLines && target instanceof AudioDestinationNode && this.context.createScriptProcessor) {
    if (!soundTap) soundTap = startSoundTap(this.context);
    if (soundTap.context === this.context && this !== soundTap.node)
      nativeConnect.call(this, soundTap.node);
  }
  return nativeConnect.apply(this, arguments);
};

// Keeps the last frame readable after it is shown, for screenshots. Only while mining with
// screenshots on: it costs a buffer copy per frame. startGame sets keepLines before it loads the
// engine, so before any context.
HTMLCanvasElement.prototype.getContext = function (type, attributes) {
  if (keepLines && (type === 'webgl' || type === 'webgl2')) {
    attributes = Object.assign({}, attributes, { preserveDrawingBuffer: true });
  }
  return nativeGetContext.call(this, type, attributes);
};

/**
 * When a line shown now was brought up: a click within CLICK_WITHIN before it, else now. A hooked
 * line comes as its text starts, right after the click that brought it: the last one. A player's
 * click wait comes once the text is drawn, after any click that sped it up: the first one after
 * the line before.
 */
function lineStart(now) {
  var last = keptLines[keptLines.length - 1];
  var after = last && last.recorded ? last.at : -Infinity;
  var clicks = clickTimes.filter(function (time) {
    return time > after && time <= now && time >= now - CLICK_WITHIN;
  });
  var click = hookedLines ? clicks[clicks.length - 1] : clicks[0];

  return click === undefined ? now : click;
}

/** At each click wait: the page so far and its voice; while mining also its screen and the sound's times. */
function keepLine(lines) {
  var text = lines
    .map(function (l) {
      return l.text;
    })
    .join('');
  var now = soundNow();
  var start = lineStart(now);
  var last = keptLines[keptLines.length - 1];
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
    ? {
        text: text,
        voice: earlier.voice,
        picture: earlier.picture,
        at: earlier.at,
        start: earlier.start,
        end: earlier.end,
        recorded: earlier.recorded
      }
    : {
        text: text,
        voice: lineVoice,
        // A hooked line comes before its text is drawn: its screenshot waits (waitingLines).
        picture: keepLines && !hookedLines ? screenshot() : undefined,
        at: now,
        start: start,
        recorded: !!soundTap
      };

  // The line before ends where this one starts.
  if (last && last.end === undefined) last.end = start;
  // The screen now still shows the line before, fully drawn.
  if (waitingLines.length && waitingLines[0].text !== text) shootWaiting();
  if (keepLines && hookedLines && !earlier) waitingLines.push(line);
  keptLines.push(line);
  if (keptLines.length > KEPT_LINES) keptLines.shift();

  var old = keptLines[keptLines.length - 1 - KEPT_MEDIA];

  if (old) {
    old.picture = undefined;
    old.recorded = false;
  }
}

/**
 * The line's recorded sound for the page's voice finder: { samples (mono s16), rate, start, end },
 * its window in seconds into samples, or null when not recorded or no longer in the ring.
 */
function lineSound(line) {
  if (!soundTap || !line.recorded) return null;
  var rate = soundTap.rate;
  var ring = soundTap.samples;
  var end = line.end === undefined ? soundNow() : line.end;
  var from = Math.round((line.start - PRE_ROLL) * rate);
  var to = Math.min(Math.round((end + TAIL) * rate), soundTap.end);

  if (from < soundTap.end - ring.length) from = soundTap.end - ring.length;
  if (from < 0) from = 0;
  if (to <= from || line.start * rate < from) return null;
  var samples = new Int16Array(to - from);

  for (var i = 0; i < samples.length; i += 1) samples[i] = ring[(from + i) % ring.length];
  return { samples: samples, rate: rate, start: line.start - from / rate, end: end - from / rate };
}

function noteClick(event) {
  // Modifier keys are Yomitan's scan keys, not the game's. Held keys repeat.
  if (!recordLines || event.repeat || /^(Shift|Control|Alt|Meta)$/.test(event.key)) return;
  clickTimes.push(soundNow());
  if (clickTimes.length > 50) clickTimes.shift();
}

/** One screenshot for the waiting hooked lines. */
function shootWaiting() {
  var shot = screenshot();

  waitingLines.forEach(function (line) {
    line.picture = shot;
  });
  waitingLines = [];
}

function retakeScreenshot(event) {
  if (!waitingLines.length || event.repeat || /^(Shift|Control|Alt|Meta)$/.test(event.key)) return;
  shootWaiting();
}

['mousedown', 'touchstart', 'keydown'].forEach(function (type) {
  // First: the screen as it is before the game takes the click.
  window.addEventListener(type, retakeScreenshot, true);
  window.addEventListener(type, noteClick, true);
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
      picture: !!line.picture || waitingLines.indexOf(line) >= 0,
      sound: line.hasVoice || !!line.recorded
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
 * file, else its recorded sound (lineSound: the page trims it to the voice), else the backlog
 * page's voice file (null without sound).
 */
async function ankiMedia(kept, shown, want) {
  var line = keptLines[kept] || {};
  var page = shownPages()[shown] || {};

  return {
    picture: want.picture ? (await line.picture) || (await screenshot()) : null,
    audio: want.audio
      ? voiceFile(line.voice) || lineSound(line) || voiceFile(page.voice) || null
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
