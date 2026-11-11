/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Anki media for games played natively (games.js): the game's sound in a rolling buffer and a
// screenshot of its window per line, so a note mined from a line on /hook gets that line's picture
// and audio, as VNBox games do on /v. Memory only (about 25 MB at most), never written to disk;
// kept until the next game starts, so lines mined just after closing still get theirs.
//
// Sound: on Linux the game plays straight to the speakers, as any program does: nothing is put in
// its way, so its level is the system's. Its streams carry a mark (PULSE_PROP in Wine's env) and
// each is recorded on its own with parec --monitor-stream; with no way to watch for them, the
// whole system's sound (the default sink's monitor). Windows: the helper (chimihook --audio)
// records the game's process tree (Windows 10 2004+, else the whole system) into a named pipe.
// Either way PCM s16le mono 24 kHz, each chunk stamped on arrival: a sink with nothing playing sends
// nothing, so gaps are silence, not missing time.

import { Buffer } from 'node:buffer';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { clearTimeout, setTimeout } from 'node:timers';

const rate = 24000;
/** Sound kept: 3 minutes (8.6 MB). */
const keepMs = 180_000;
/** GameSentenceMiner's audio.beginning_offset: a line's sound starts this long before it arrived. */
const beginOffsetMs = 500;
const maxClipMs = 40_000;
/** Screenshots kept: the newest 30 lines, 16 MB at most. */
const keepShots = 30;
const maxShotBytes = 16 * 1024 * 1024;
/** A line's screenshot after it arrived (its text is drawn), again later if still the newest line. */
const shotDelays = [200, 2500];
const streamMark = 'chimi.game';

const run = (command, args, env) =>
  new Promise((resolve) =>
    execFile(command, args, { env, timeout: 10_000 }, (error, stdout) =>
      resolve(error ? undefined : stdout.toString())
    )
  );

/**
 * The rolling sound buffer: chunks with the time their first sample played (main's clock).
 * `clip(from, to)` lays them on a silent buffer, so time with no chunk (an idle sink) is silence:
 * its samples, or undefined when nothing played.
 */
export function soundRing(now = Date.now) {
  let chunks = [];
  let odd; // a byte left over from the last chunk
  return {
    push(buffer) {
      const bytes = odd ? Buffer.concat([odd, buffer]) : buffer;
      const even = bytes.length & ~1;
      odd = even < bytes.length ? bytes.subarray(even) : undefined;
      if (!even) return;
      const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + even));
      const end = now();
      chunks.push({ start: end - (samples.length / rate) * 1000, samples });
      const keepFrom = end - keepMs;
      if (chunks[0].start < keepFrom) chunks = chunks.filter((chunk) => chunk.start >= keepFrom);
    },
    clip(from, to) {
      to = Math.min(to, from + maxClipMs);
      if (!(to > from)) return undefined;
      const out = new Int16Array(Math.round(((to - from) / 1000) * rate));
      let heard = false;
      for (const { start, samples } of chunks) {
        const offset = Math.round(((start - from) / 1000) * rate);
        if (offset >= out.length || offset + samples.length <= 0) continue;
        const skip = Math.max(0, -offset);
        out.set(
          samples.subarray(skip, Math.min(samples.length, out.length - offset)),
          offset + skip
        );
        heard = true;
      }
      return heard ? out : undefined;
    },
    clear() {
      chunks = [];
      odd = undefined;
    },
    /** When its last sound started; 0 before any. A stream long gone is dropped by this. */
    newest: () => chunks.at(-1)?.start ?? Date.now()
  };
}

/** Several rolling buffers heard together: one per stream, since each has its own timing. */
function soundMix() {
  let rings = [];
  return {
    add() {
      const cutoff = Date.now() - keepMs;
      rings = rings.filter((ring) => ring.newest() >= cutoff);
      const ring = soundRing();
      rings.push(ring);
      return ring;
    },
    clip(from, to) {
      let mixed;
      for (const ring of rings) {
        const part = ring.clip(from, to);
        if (!part) continue;
        if (!mixed) mixed = part;
        else part.forEach((v, i) => (mixed[i] = Math.max(-32768, Math.min(32767, mixed[i] + v))));
      }
      return mixed;
    },
    clear() {
      rings = [];
    }
  };
}

/**
 * One game's media at a time. games.js stamps the helper's text lines (`stamp`), forwards its
 * `window` messages (`window`), and /hook marks the lines it shows (`mark`) and asks for a mined
 * line's media (`media`).
 */
export function gameMedia({ desktopCapturer, platform = process.platform }) {
  const sound = soundMix();
  /** The whole system's sound, for a game whose streams never showed their mark. */
  const whole = soundRing();
  // From the clock: numbers kept in /hook's saved lines never meet a later run's.
  let seq = Date.now();
  /** Arrival times of the recent text lines, by seq. */
  let arrivals = new Map();
  /** Lines /hook showed, oldest first: { seq, at, shot?, timers } */
  let marks = [];
  let source; // { id, name, width, height } of the game's window
  let recorder; // parec, or the Windows pipe server
  let mode = 'none';
  let env = process.env;
  let shooting = Promise.resolve();

  const stopRecorder = () => {
    recorder?.kill?.();
    recorder?.close?.();
    recorder = undefined;
  };

  function record(device, extra = [], ring = sound.add()) {
    const child = spawn(
      'parec',
      [
        '-d',
        device,
        ...extra,
        '--raw',
        '--format=s16le',
        `--rate=${rate}`,
        '--channels=1',
        '--latency-msec=30'
      ],
      { env, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    child.on('error', () => {});
    child.stdout.on('data', (chunk) => ring.push(chunk));
    return child;
  }

  /**
   * Records each stream carrying `mark` as it appears (a game opens several, and closes some).
   * pactl's text is parsed, so in English whatever the game's locale.
   */
  function recordStreams(mark) {
    const english = { ...env, LC_ALL: 'C' };
    const live = new Map(); // stream index → its parec
    let scanning = false;
    let again = false;
    async function scan() {
      if (scanning) return void (again = true);
      scanning = true;
      const list = await run('pactl', ['list', 'sink-inputs'], english);
      const sinks = (await run('pactl', ['list', 'short', 'sinks'], english)) ?? '';
      const blocks = list?.split(/^Sink Input #/m).slice(1) ?? [];
      // PipeWire doesn't end a recording whose stream ended: it goes on with the whole sink.
      if (list !== undefined) {
        const open = new Set(blocks.map((block) => parseInt(block)));
        live.forEach((child, index) => open.has(index) || child.kill());
      }
      for (const block of blocks) {
        const index = parseInt(block);
        if (!block.includes(`${streamMark} = "${mark}"`) || live.has(index) || !watch) continue;
        const sink = /^\s*Sink: (\d+)/m.exec(block)?.[1];
        const name = sinks.split('\n').find((line) => line.startsWith(`${sink}\t`));
        if (!name) continue;
        // Must be that sink's monitor (PulseAudio); it ends if the stream moves: found again then.
        const child = record(`${name.split('\t')[1]}.monitor`, [`--monitor-stream=${index}`]);
        live.set(index, child);
        child.on('exit', () => live.delete(index));
      }
      scanning = false;
      if (again) {
        again = false;
        scan();
      }
    }
    let watch = spawn('pactl', ['subscribe'], {
      env: english,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    watch.on('error', () => {});
    watch.stdout.on('data', (events) => /sink-input/.test(events) && scan());
    // PulseAudio renders far ahead unless a client asks for low latency, and a stream's recording
    // only gets what is rendered after it attaches (short sounds: nothing). This one asks, and
    // is the sound of a game whose streams carry no mark (a runner that drops PULSE_PROP).
    const pace = record('@DEFAULT_MONITOR@', [], whole);
    return {
      kill() {
        pace.kill();
        watch?.kill();
        watch = undefined;
        live.forEach((child) => child.kill());
      }
    };
  }

  async function shoot(png = false, exact = false) {
    if (!source || !desktopCapturer) return undefined;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: source.width || 1280, height: source.height || 720 },
        fetchWindowIcons: false
      });
      // By id; the title when the id differs (a window manager's frame on X11).
      const found =
        sources.find((item) => item.id === source.id) ??
        (exact ? undefined : sources.find((item) => source.name && item.name === source.name));
      const image = found?.thumbnail;
      if (!image || image.isEmpty()) return undefined;
      return png ? image.toPNG() : image.toJPEG(90);
    } catch {
      return undefined;
    }
  }

  /** Shots in order, one at a time (getSources captures every window). */
  const queueShot = (mark) => {
    shooting = shooting.then(async () => {
      const shot = await shoot();
      if (shot) mark.shot = shot;
      let bytes = 0;
      for (const item of marks.toReversed()) {
        bytes += item.shot?.length ?? 0;
        if (bytes > maxShotBytes) item.shot = undefined;
      }
    });
    return shooting;
  };

  return {
    /**
     * A game starts: what came before is dropped. Linux: returns Wine's env additions (the mark
     * on its streams); Windows: the helper's extra arguments (the pipe). `baseEnv`: the env Wine
     * runs with. `ownStreams` false (Linux): a game already running has no mark, so the whole
     * system's.
     */
    async start(baseEnv = process.env, { ownStreams = true } = {}) {
      await this.stop();
      sound.clear();
      whole.clear();
      marks.forEach((mark) => mark.timers.forEach(clearTimeout));
      marks = [];
      arrivals = new Map();
      source = undefined;
      env = baseEnv;
      mode = 'none';
      if (platform === 'win32') {
        const pipe = `\\\\.\\pipe\\chimi-audio-${randomBytes(8).toString('hex')}`;
        const ring = sound.add();
        const server = createServer((socket) => {
          socket.on('data', (chunk) => ring.push(chunk));
          socket.on('error', () => {});
        });
        server.on('error', () => {});
        server.listen(pipe);
        recorder = server;
        return { args: ['--audio', pipe] };
      }
      const parec = await run('parec', ['--help'], env);
      if (!parec || !(await run('pactl', ['info'], env))) return { mode };
      if (ownStreams && parec.includes('--monitor-stream')) {
        const mark = randomBytes(8).toString('hex');
        mode = 'game';
        recorder = recordStreams(mark);
        const props = [baseEnv.PULSE_PROP, `${streamMark}=${mark}`].filter(Boolean).join(' ');
        return { mode, env: { PULSE_PROP: props } };
      }
      mode = 'system';
      recorder = record('@DEFAULT_MONITOR@');
      return { mode };
    },

    /** The game closed (or the app quits): recording stops, what was kept stays. */
    stop() {
      stopRecorder();
    },

    /** A text line from the helper: its seq and arrival time. */
    stamp() {
      seq += 1;
      const at = Date.now();
      arrivals.set(seq, at);
      if (arrivals.size > 2000) arrivals.delete(arrivals.keys().next().value);
      return { seq, at };
    },

    /** The helper's `window` message: the game's main window, for screenshots. */
    window({ hwnd, xid, title, width, height }) {
      const id = platform === 'win32' ? hwnd : xid;
      source = { id: id ? `window:${id}:0` : '', name: title, width, height };
    },

    /** The game's window now (PNG), for the overlay's screen read; after any waiting shot. */
    frame() {
      // Only that very window: another of the same title (/hook's) would put the text elsewhere.
      const shot = shooting.then(() => shoot(true, true));
      shooting = shot.then(() => {});
      return shot;
    },

    /** /hook shows line `seq`: its screenshot is taken once its text is drawn. */
    mark(lineSeq) {
      const at = arrivals.get(lineSeq);
      if (at === undefined || marks.some((mark) => mark.seq === lineSeq)) return;
      const mark = { seq: lineSeq, at, timers: [] };
      // Shots stop at the next line: by then the screen shows it.
      marks.at(-1)?.timers.forEach(clearTimeout);
      mark.timers = shotDelays.map((delay) =>
        setTimeout(() => marks.at(-1) === mark && queueShot(mark), delay)
      );
      marks.push(mark);
      if (marks.length > keepShots) marks.shift().timers.forEach(clearTimeout);
    },

    /** A mined line's media: { picture (JPEG), audio (sound, above), mode }; either may be missing. */
    async media(lineSeq, want = {}) {
      const index = marks.findIndex((mark) => mark.seq === lineSeq);
      const mark = marks[index];
      const result = { mode };
      if (!mark) return result;
      const newest = index === marks.length - 1;
      if (want.picture) {
        if (!mark.shot && newest) await queueShot(mark);
        result.picture = mark.shot;
      }
      if (want.audio) {
        // GameSentenceMiner's window (trim_audio_based_on_last_line), for the voice finder
        // (line-audio.ts): just before the line arrived up to the next line's arrival.
        const start = mark.at - beginOffsetMs;
        const end = marks[index + 1]?.at ?? Date.now();
        const pcm = sound.clip(start, end) ?? whole.clip(start, end);
        if (pcm)
          result.audio = {
            pcm: new Uint8Array(pcm.buffer),
            rate,
            start: 0,
            end: (end - start) / 1000
          };
      }
      return result;
    },

    get mode() {
      return mode;
    }
  };
}
