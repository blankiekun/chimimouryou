/**
 * Shell for the CONscripter web engine (conscripter.js, GPL-2.0, fetched by scripts/conscripter/),
 * loaded by the reader's /v page in a same-origin iframe. The engine calls the globals below
 * (g_cons_*, fetch_file, flush_save, playVideo, playVideoHold, consMovie*, scale_full, consText,
 * consChoice, consOverlay, consBacklog, consSprites, consVoice, consPosition, consMode,
 * consLanguage) from its C code; the loader is
 * cons() (CONscripter v0.23.0 renamed them from ONScripter-yuri's onsyuri names).
 * The page calls startGame() once the frame has loaded. The overlay and Anki mining are in
 * overlay.js, shared with the Windows game player (vnbox.html).
 */

var g_cons_module = {};
var g_cons_index = {};
var g_cons_filemap = {};
var g_screen_width = 640;
var g_screen_height = 480;
var consText;
var textLines = function () {
  return [];
};
var onSave = function () {};
var textEncoding = 'shift_jis';

function mkdirs(FS, path) {
  var dir = '';

  path
    .split('/')
    .filter(Boolean)
    .forEach(function (part) {
      dir += '/' + part;
      try {
        FS.mkdir(dir);
      } catch (e) {
        // exists
      }
    });
}

function scale_full(canvas, ratio) {
  var w = window.innerWidth;
  var h = window.innerHeight;
  var overlay = document.getElementById('overlay');

  if (w / h > ratio) w = h * ratio;
  else h = w / ratio;
  canvas.style.width = overlay.style.width = w + 'px';
  canvas.style.height = overlay.style.height = h + 'px';
  // Overlay lines are laid out in screen pixels, scaled like the canvas.
  overlay.style.setProperty('--scale', w / g_screen_width);
}

/** A choice (or system menu item) drawn by the engine: its text in script bytes. */
function consChoice(bytes, x, y, size, pitch) {
  document.getElementById('choices').appendChild(
    overlayLine({
      text: new TextDecoder(textEncoding).decode(bytes),
      x: x,
      y: y,
      size: size,
      pitch: pitch
    })
  );
}

var stashedChoices = [];
var stashedPage = [];
var inSystem = false;
var inBacklog = false;
var windowHidden = false;

function updateHidden() {
  document.getElementById('page-text').hidden = windowHidden || (inSystem && !inBacklog);
  document.getElementById('sprite-text').hidden = inSystem;
}

/**
 * The engine says when text leaves the screen, so the overlay never outlives it (clicks
 * elsewhere, e.g. to close Yomitan, leave it alone): 'page' (new page), 'hide'/'show' (text
 * window hidden and back with its page), 'choices' (buttons removed), 'enter'/'leave' (system
 * menu or backlog over the page and back), 'reset' (left the system menu elsewhere, e.g. a
 * loaded game).
 */
function consOverlay(event) {
  var page = document.getElementById('page-text');
  var choices = document.getElementById('choices');

  if (event === 'page') {
    page.textContent = '';
    lineVoice = null;
  } else if (event === 'choices') choices.textContent = '';
  else if (event === 'hide') windowHidden = true;
  else if (event === 'show') windowHidden = false;
  else if (event === 'enter') {
    stashedChoices = Array.prototype.slice.call(choices.children);
    stashedPage = Array.prototype.slice.call(page.children);
    choices.textContent = '';
    inSystem = true;
    inBacklog = false;
  } else if (event === 'leave') {
    choices.replaceChildren.apply(choices, stashedChoices);
    page.replaceChildren.apply(page, stashedPage);
    inSystem = false;
  } else if (event === 'reset') {
    page.textContent = choices.textContent = '';
    inSystem = windowHidden = false;
  }
  updateHidden();
}

/** A backlog page (between 'enter' and 'leave'): script bytes and boxes, as for consText. */
function consBacklog(bytes, boxes, voice) {
  var lines = textLines(bytes, boxes);

  backlogVoice = voice;
  backlogText = lines
    .map(function (line) {
      return line.text;
    })
    .join('');
  showText(lines);
  inBacklog = true;
  updateHidden();
}

/** The visible string sprites (strsp: script-drawn menus and backlogs) at each wait for input. */
function consSprites(bytes, boxes) {
  var layer = document.getElementById('sprite-text');
  var lines = textLines(bytes, boxes);

  spriteText = lines
    .map(function (line) {
      return line.text;
    })
    .join('');
  layer.replaceChildren.apply(layer, lines.map(overlayLine));
}

// The voice (dwave channel 0) of the page being read, and of the backlog page shown.
var lineVoice = null;
var backlogVoice = null;
var backlogText = '';
var spriteText = '';
// From consPosition: 1 if the engine has the text as read before, 0 if not, -1 unknown.
var textRead = -1;
var autoMode = false;
var onMode = function () {};

function consVoice(channel, file) {
  if (channel === 0) lineVoice = file;
}

function consPosition(offset, total, label, read) {
  textRead = read;
}

function consMode(auto, skip) {
  autoMode = !!auto;
  onMode(autoMode, !!skip);
}

/** Opens the game's system menu, as a right-click on the game does. */
function openMenu() {
  var canvas = document.getElementById('canvas');
  var box = canvas.getBoundingClientRect();
  var at = {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 2,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2
  };

  canvas.dispatchEvent(new MouseEvent('mousedown', at));
  at.buttons = 0;
  canvas.dispatchEvent(new MouseEvent('mouseup', at));
}

// Gamepad actions (lib/data/vn/vn-gamepad.ts) as the keys ONScripter knows: A Enter, the d-pad the
// arrow keys (choices and menus), the shoulders the wheel (up opens the backlog).
var padKeys = {
  advance: ['Enter', 'Enter', 13],
  up: ['ArrowUp', 'ArrowUp', 38],
  down: ['ArrowDown', 'ArrowDown', 40],
  left: ['ArrowLeft', 'ArrowLeft', 37],
  right: ['ArrowRight', 'ArrowRight', 39]
};

/** A pad action pressed (down) or released. */
function padButton(action, down) {
  var key = padKeys[action];
  var middle = canvasMiddle();

  if (key) gameKey(down, key[0], key[1], key[2]);
  else if (action === 'menu' && down) openMenu();
  else if (action === 'wheelUp' && down) gameWheel(-120, middle.x, middle.y);
  else if (action === 'wheelDown' && down) gameWheel(120, middle.x, middle.y);
}

/** Calls one of the engine's _consSet* exports (CONscripter v0.19.0+), e.g. ('Ruby', 0). */
function engineSet(name, value) {
  var set = g_cons_module['_consSet' + name];

  if (typeof set === 'function') set(value);
}

// Yomitan's scan keys stop auto mode, so the text doesn't move on during a lookup.
window.addEventListener(
  'keydown',
  function (event) {
    if (autoMode && /^(Shift|Control|Alt|Meta)$/.test(event.key)) engineSet('Auto', 0);
  },
  true
);

window.addEventListener('resize', function () {
  scale_full(document.getElementById('canvas'), g_screen_width / g_screen_height);
});

var voiceTypes = { ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg' };

/** A voice file named by the script, if it is a plain game file (not in an archive). */
function voiceFile(file) {
  var node = file && g_cons_filemap[('/game/' + file.replace(/\\/g, '/')).toLowerCase()];
  var type = file && voiceTypes[file.split('.').pop().toLowerCase()];

  if (!node || !type) return null;
  try {
    return new Blob([g_cons_module.FS.readFile(node.path)], { type: type });
  } catch (error) {
    return null;
  }
}

/** Backlog text on screen now: the built-in backlog's page, and script-drawn (strsp) text. */
function shownPages() {
  var pages = [];

  if (inSystem && inBacklog) pages.push({ text: backlogText, voice: backlogVoice });
  if (!inSystem && spriteText) pages.push({ text: spriteText, voice: null });
  return pages;
}

// Cache API cache of a server game the reader chose to keep in the browser (startGame's cacheName).
var fileCache;
// startGame's fetchFile: how game file URLs are requested (a connected server needs its token).
var fetchFile = function (url) {
  return fetch(url);
};
var progress = { loaded: 0, total: 0 };

function showProgress() {
  var box = document.getElementById('progress');
  var mb = function (bytes) {
    return Math.round(bytes / 1048576);
  };

  box.hidden = progress.loaded >= progress.total;
  if (box.hidden) progress.loaded = progress.total = 0;
  box.querySelector('progress').max = progress.total;
  box.querySelector('progress').value = progress.loaded;
  box.querySelector('span').textContent =
    'Loading game files… ' + mb(progress.loaded) + ' / ' + mb(progress.total) + ' MB';
}

/** A response's bytes; files over 1 MB show in the progress bar while they load. */
async function readResponse(response) {
  var size = Number(response.headers.get('Content-Length')) || 0;

  if (!response.body || size < 1048576) return response.arrayBuffer();

  var data = new Uint8Array(size);
  var offset = 0;
  var reader = response.body.getReader();

  progress.total += size;
  showProgress();
  try {
    for (;;) {
      var chunk = await reader.read();

      if (chunk.done) break;
      data.set(chunk.value, offset);
      offset += chunk.value.length;
      progress.loaded += chunk.value.length;
      showProgress();
    }
    if (offset !== size) throw new Error('Truncated: ' + offset + ' of ' + size + ' bytes');
  } finally {
    // Failed reads leave the bar too.
    progress.loaded += size - offset;
    showProgress();
  }
  return data.buffer;
}

async function loadFile(url) {
  var cached = fileCache && (await fileCache.match(url));

  if (cached) return readResponse(cached);

  var response = await fetchFile(url);

  if (!response.ok) throw new Error('HTTP ' + response.status);
  if (fileCache) {
    fileCache.put(url, response.clone()).catch(function (error) {
      console.warn('Could not keep ' + url + ' in the browser', error);
    });
  }
  return readResponse(response);
}

/** Lazy loading (fopen_ons): copies a game file into the engine's memory on first use. */
function fetch_file(FS, key, filemap) {
  var node = filemap[key];

  if (!node || node.loading) return;
  node.loading = true;
  loadFile(node.url)
    .then(function (data) {
      // canOwn: the engine keeps this buffer instead of a copy, so a file sits in memory once.
      FS.writeFile(node.path, new Uint8Array(data), { canOwn: true });
    })
    .catch(function (error) {
      console.error('Could not load ' + node.path, error);
    })
    .finally(function () {
      // Also on failure: the engine waits for this, and then fails to open the file.
      node.loaded = true;
    });
}

function flush_save() {
  g_cons_module.FS.syncfs(false, function (error) {
    if (error) console.error(error);
    else onSave(readSaves());
  });
}

var video = document.getElementById('video');
var videoSkippable = false;

function videoUrl(path) {
  return URL.createObjectURL(new Blob([g_cons_module.FS.readFile(path)], { type: 'video/mp4' }));
}

/** The video over the game, at the canvas's size, in its place. */
function showVideo() {
  var canvas = document.getElementById('canvas');

  video.style.width = canvas.style.width;
  video.style.height = canvas.style.height;
  canvas.style.display = 'none';
  video.style.display = 'block';
}

// Browsers block autoplay with sound until the page was clicked: play muted rather than wait.
function playOrMute(onFail) {
  video.muted = false;
  video.play().catch(function () {
    video.muted = true;
    video.play().catch(onFail);
  });
}

function videoEnded() {
  holdEnded();
  videoSkippable = false;
  video.onclick = null;
  // Hidden with its src cleared, a video keeps its sound in some browsers: pause it first.
  video.pause();
  document.getElementById('canvas').style.display = 'block';
  video.style.display = 'none';
  if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
  video.removeAttribute('src');
  video.load();
  g_cons_module.wait_video = false;
}

function videoSkipped() {
  g_cons_module.video_skipped = true;
  videoEnded();
}

video.addEventListener('ended', videoEnded);
video.addEventListener('error', function () {
  if (video.getAttribute('src')) videoEnded();
});
// Enter, Space and Escape skip it, as in the native player.
window.addEventListener('keyup', function (event) {
  if (videoSkippable && /^(Enter| |Escape)$/.test(event.key)) videoSkipped();
});

/** mpegplay and movie (CONscripter's web shell, conscripter.html). */
function playVideo(path, clickFlag, loopFlag) {
  g_cons_module.wait_video = true;
  g_cons_module.video_skipped = false;
  video.src = videoUrl(path);
  video.loop = !!loopFlag;
  video.onclick = clickFlag ? videoSkipped : null;
  videoSkippable = !!clickFlag;
  showVideo();
  playOrMute(videoEnded);
}

// mpeghold: the video plays only while the pointer, Enter or Space is held on it, under the
// engine's sprite (a "hold the button" prompt); g_cons_module.video_held tells the engine.
var holdOverlay = document.createElement('canvas');
var hold = null;

holdOverlay.style.cssText = 'position:absolute; display:none; touch-action:none;';
document.body.appendChild(holdOverlay);

function holdSet() {
  if (!hold) return;

  var down = hold.pointers.size > 0 || hold.keys.size > 0;

  if (down === !!g_cons_module.video_held) return;
  g_cons_module.video_held = down;
  if (down) playOrMute(function () {});
  else video.pause();
}

function holdKey(event) {
  if (!hold || !(event.key === 'Enter' || event.key === ' ')) return;
  event.preventDefault();
  if (event.type === 'keydown') hold.keys.add(event.key);
  else hold.keys.delete(event.key);
  holdSet();
}

window.addEventListener('keydown', holdKey);
window.addEventListener('keyup', holdKey);
holdOverlay.addEventListener('pointerdown', function (event) {
  if (!hold || event.button > 0) return;
  holdOverlay.setPointerCapture(event.pointerId);
  hold.pointers.add(event.pointerId);
  holdSet();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
  holdOverlay.addEventListener(type, function (event) {
    if (!hold) return;
    hold.pointers.delete(event.pointerId);
    holdSet();
  });
});
holdOverlay.addEventListener('contextmenu', function (event) {
  event.preventDefault();
});
window.addEventListener('blur', function () {
  if (!hold) return;
  hold.pointers.clear();
  hold.keys.clear();
  holdSet();
});

/** rgba: the sprite's picture (w x h, stride px a row), cells side by side, each shown ms; drawn at x,y of the sw x sh screen. */
function playVideoHold(path, rgba, w, h, stride, cells, ms, x, y, sw, sh) {
  g_cons_module.wait_video = true;
  g_cons_module.video_held = false;
  g_cons_module.video_hold_end = 0;
  video.src = videoUrl(path);
  video.loop = false;
  video.muted = false;
  video.onclick = null;
  videoSkippable = false;
  video.preload = 'auto';
  video.pause();
  showVideo();

  var rect = video.getBoundingClientRect();
  var ctx = holdOverlay.getContext('2d');

  Object.assign(holdOverlay.style, {
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    display: 'block'
  });
  holdOverlay.width = sw;
  holdOverlay.height = sh;
  ctx.clearRect(0, 0, sw, sh);
  hold = { pointers: new Set(), keys: new Set(), timer: null };
  if (!rgba || w <= 0 || h <= 0) return;

  var image = new ImageData(w, h);
  var count = Math.max(cells, 1);
  var cw = Math.floor(w / count);
  var cell = 0;

  for (var row = 0; row < h; row++) {
    image.data.set(rgba.subarray(row * stride * 4, row * stride * 4 + w * 4), row * w * 4);
  }
  function draw() {
    ctx.clearRect(0, 0, sw, sh);
    ctx.putImageData(image, x - cell * cw, y, cell * cw, 0, cw, h);
    cell = (cell + 1) % count;
  }
  draw();
  if (cells > 1 && ms > 0) hold.timer = setInterval(draw, ms);
}

function holdEnded() {
  if (!hold) return;
  g_cons_module.video_hold_end =
    (hold.pointers.size > 0 ? 1 : 0) |
    (hold.keys.has('Enter') ? 2 : 0) |
    (hold.keys.has(' ') ? 8 : 0);
  if (hold.timer) clearInterval(hold.timer);
  hold = null;
  g_cons_module.video_held = false;
  holdOverlay.style.display = 'none';
}

// Movies whose frames the engine draws (a movie as a picture, mpegplay under the text window):
// a hidden <video> each, its current frame read through a canvas as RGBA bytes.
// g_cons_movies: the engine reads a movie's size from it.
var g_cons_movies = {};
var movieId = 0;

function consMovieOpen(path, loop, sound, w, h) {
  var url;

  try {
    url = videoUrl(path);
  } catch (error) {
    console.error('No movie ' + path, error);
    return -1;
  }

  var v = document.createElement('video');
  var id = ++movieId;
  var m = { video: v, state: 0, last: -1, ctx: null };

  v.muted = !sound;
  v.loop = !!loop;
  v.playsInline = true;
  v.preload = 'auto';
  // In the page (a detached or hidden video may not decode), unseen.
  v.style.cssText =
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  v.onloadeddata = function () {
    if (m.state === 0) m.state = 1;
  };
  v.onerror = function () {
    m.state = -1;
  };
  v.src = url;
  document.body.appendChild(v);
  v.play().catch(function () {
    v.muted = true;
    v.play().catch(function () {
      m.state = -1;
    });
  });
  g_cons_movies[id] = m;
  return id;
}

function consMovieState(id) {
  return g_cons_movies[id] ? g_cons_movies[id].state : -1;
}

/** The frame as RGBA bytes when it changed since the last call, else null. */
function consMovieFrame(id, w, h) {
  var m = g_cons_movies[id];

  if (!m || m.video.readyState < 2 || m.video.currentTime === m.last) return null;
  m.last = m.video.currentTime;
  if (!m.ctx) {
    var c = document.createElement('canvas');

    c.width = w;
    c.height = h;
    m.ctx = c.getContext('2d', { willReadFrequently: true });
  }
  m.ctx.drawImage(m.video, 0, 0, w, h);
  return m.ctx.getImageData(0, 0, w, h).data;
}

function consMovieEnded(id) {
  var m = g_cons_movies[id];

  return !m || m.state < 0 || m.video.ended ? 1 : 0;
}

function consMovieClose(id) {
  var m = g_cons_movies[id];

  if (!m) return;
  m.video.pause();
  URL.revokeObjectURL(m.video.src);
  m.video.removeAttribute('src');
  m.video.load();
  m.video.remove();
  delete g_cons_movies[id];
}

/** The script's `language` command: the overlay's language, for Yomitan and fonts. */
function consLanguage(lang) {
  document.getElementById('overlay').lang = lang;
}

/** The save folder's files: name → { modified, bytes }. */
function readSaves() {
  var FS = g_cons_module.FS;
  var dir = g_cons_index.savedir;
  var saves = {};

  FS.readdir(dir).forEach(function (name) {
    var stat = FS.stat(dir + '/' + name);

    if (FS.isFile(stat.mode)) {
      saves[name] = { modified: stat.mtime.getTime(), bytes: FS.readFile(dir + '/' + name) };
    }
  });

  return saves;
}

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
 * options: files (path → Blob or URL, paths relative to the game folder), encoding ('sjis' |
 * 'utf8'), saveDir (unique per game), cacheName (Cache API cache keeping the fetched files, for
 * games served by URL), fetchFile (url → Promise<Response>, for game files; default fetch),
 * saves (synced save files, written when newer than
 * this browser's), keepLines (keep the recent lines with their screenshots for ankiMedia()),
 * recordLines (and record their sound),
 * onText(bytes, skipped, boxes, read), textLines(bytes, boxes) (overlay lines of a page, backlog page or sprites),
 * onSave(saves), onExit(code), onMode(auto, skip) (the engine's auto and skip modes).
 */
async function startGame(options) {
  var gameDir = '/game';
  var hasFont = Object.keys(options.files).some(function (path) {
    return path.toLowerCase() === 'default.ttf';
  });

  // onText also gets whether the engine has the text as read before (consPosition).
  textLines = options.textLines || textLines;
  keepLines = !!options.keepLines;
  consText = function (bytes, skipped, boxes) {
    var lines = textLines(bytes, boxes);

    showText(lines);
    options.onText(bytes, skipped, boxes, textRead);
    // Skipped text goes by too fast to mine.
    if (!skipped) keepLine(lines);
  };
  recordLines = !!options.recordLines;
  if (options.fetchFile) fetchFile = options.fetchFile;
  if (options.cacheName) fileCache = await caches.open(options.cacheName);
  onSave = options.onSave || onSave;
  onMode = options.onMode || onMode;
  textEncoding = options.encoding === 'utf8' ? 'utf-8' : 'shift_jis';
  g_cons_index = { gamedir: gameDir, savedir: options.saveDir };
  Object.keys(options.files).forEach(function (path) {
    g_cons_filemap[(gameDir + '/' + path).toLowerCase()] = {
      path: gameDir + '/' + path,
      url:
        typeof options.files[path] === 'string'
          ? options.files[path]
          : URL.createObjectURL(options.files[path]),
      loaded: false
    };
  });
  if (!hasFont) {
    g_cons_filemap[gameDir + '/default.ttf'] = {
      path: gameDir + '/default.ttf',
      // Absolute, so a fetchFile from the page resolves it against this frame, not the page.
      url: new URL('default.ttf', location.href).href,
      loaded: false
    };
  }

  g_cons_module.canvas = document.getElementById('canvas');
  g_cons_module.onExit = options.onExit;
  // The engine's openurl calls window.open at call time: only web links, never javascript: or file:.
  var open = window.open.bind(window);
  window.open = function (url) {
    if (/^https?:\/\//i.test(String(url))) open(String(url), '_blank', 'noopener');
    return null;
  };
  await loadScript('conscripter.js');
  // INVOKE_RUN=0: the runtime is ready here and main() waits for callMain.
  g_cons_module = await cons(g_cons_module);

  var FS = g_cons_module.FS;

  Object.keys(g_cons_filemap).forEach(function (key) {
    var path = g_cons_filemap[key].path;

    mkdirs(FS, path.slice(0, path.lastIndexOf('/')));
  });
  mkdirs(FS, options.saveDir);
  FS.mount(g_cons_module.IDBFS, {}, options.saveDir);
  await new Promise(function (resolve) {
    FS.syncfs(true, function (error) {
      if (error) console.error(error);
      resolve();
    });
  });

  var local = readSaves();

  Object.keys(options.saves || {}).forEach(function (name) {
    var save = options.saves[name];
    var path = options.saveDir + '/' + name;

    // Synced names become paths: only single path segments.
    if (/[/\\]/.test(name) || name === '.' || name === '..') return;
    if (!local[name] || local[name].modified < save.modified) {
      FS.writeFile(path, save.bytes);
      FS.utime(path, save.modified, save.modified);
    }
  });
  flush_save();

  document.getElementById('canvas').focus();
  g_cons_module.callMain([
    '--root',
    gameDir,
    '--font',
    gameDir + '/default.ttf',
    '--save-dir',
    options.saveDir,
    '--enc:' + options.encoding
  ]);
}
