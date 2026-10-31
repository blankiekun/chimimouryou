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
// Sound: Linux puts the game on its own PulseAudio/PipeWire null sink (PULSE_SINK in Wine's env),
// looped back to the speakers, and records its monitor with parec; when that sink can't be made,
// the whole system's sound (the default sink's monitor). Windows: the helper (chimihook --audio)
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
/**
 * LunaHost sends a line once no more text came for this long (Luna_Settings in chimihook.c), so a
 * line was shown this much before it arrived.
 */
const flushMs = 500;
/** A line starts at the first click or key after the previous line, if within this before it. */
const clickWithinMs = 3000;
/** Sound around a line's window (lib/data/vn/line-audio.ts preRollMs and tailMs). */
const preRollMs = 400;
const tailMs = 6000;
const maxClipMs = 40_000;
/** Screenshots kept: the newest 30 lines, 16 MB at most. */
const keepShots = 30;
const maxShotBytes = 16 * 1024 * 1024;
/** A line's screenshot after it arrived (its text is drawn), again later if still the newest line. */
const shotDelays = [200, 2500];
const sinkName = 'chimi_game';

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
    }
  };
}

/**
 * One game's media at a time. games.js stamps the helper's text lines (`stamp`), forwards its
 * `window` messages (`window`), and /hook marks the lines it shows (`mark`) and asks for a mined
 * line's media (`media`).
 */
export function gameMedia({ desktopCapturer, platform = process.platform }) {
  const sound = soundRing();
  // From the clock: numbers kept in /hook's saved lines never meet a later run's.
  let seq = Date.now();
  /** Arrival times of the recent text lines, by seq. */
  let arrivals = new Map();
  /** Lines /hook showed, oldest first: { seq, at, shot?, timers } */
  let marks = [];
  /** When the player clicked or pressed a key in the game (the helper's `input`), oldest first. */
  let inputs = [];
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

  /** Our sink's modules (from a crash too): unloaded. */
  async function unloadSink() {
    const modules = (await run('pactl', ['list', 'short', 'modules'], env)) ?? '';
    for (const line of modules.split('\n')) {
      const [id, name, args = ''] = line.split('\t');
      if (
        (name === 'module-null-sink' && args.includes(`sink_name=${sinkName}`)) ||
        (name === 'module-loopback' && args.includes(`source=${sinkName}.monitor`))
      )
        await run('pactl', ['unload-module', id], env);
    }
  }

  function record(device) {
    const child = spawn(
      'parec',
      [
        '-d',
        device,
        '--raw',
        '--format=s16le',
        `--rate=${rate}`,
        '--channels=1',
        '--latency-msec=30'
      ],
      { env, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    child.on('error', () => {});
    child.stdout.on('data', (chunk) => sound.push(chunk));
    return child;
  }

  async function shoot() {
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
        sources.find((item) => source.name && item.name === source.name);
      const image = found?.thumbnail;
      return image && !image.isEmpty() ? image.toJPEG(90) : undefined;
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

  /**
   * When line marks[index] was brought up: the first click or key after the previous line was
   * fully drawn (a click that finishes a typewriter comes just before), if one came shortly before
   * this one was shown, else when it was shown (no clicks: auto mode, or the helper's input hooks
   * don't fire; typewriter text then counts from its end).
   */
  function lineStart(index) {
    const shown = marks[index].at - flushMs;
    const after = (marks[index - 1]?.at ?? -Infinity) - flushMs + 100;
    const click = inputs.find(
      (time) => time > after && time <= marks[index].at && time >= shown - clickWithinMs
    );
    return click ?? shown;
  }

  return {
    /**
     * A game starts: what came before is dropped. Linux: returns Wine's env additions (its own
     * sink); Windows: the helper's extra arguments (the pipe). `baseEnv`: the env Wine runs with.
     */
    async start(baseEnv = process.env) {
      await this.stop();
      sound.clear();
      marks.forEach((mark) => mark.timers.forEach(clearTimeout));
      marks = [];
      inputs = [];
      arrivals = new Map();
      source = undefined;
      env = baseEnv;
      mode = 'none';
      if (platform === 'win32') {
        const pipe = `\\\\.\\pipe\\chimi-audio-${randomBytes(8).toString('hex')}`;
        const server = createServer((socket) => {
          socket.on('data', (chunk) => sound.push(chunk));
          socket.on('error', () => {});
        });
        server.on('error', () => {});
        server.listen(pipe);
        recorder = server;
        return { args: ['--audio', pipe] };
      }
      if (!(await run('pactl', ['info'], env))) return { mode };
      await unloadSink();
      const sink = await run(
        'pactl',
        ['load-module', 'module-null-sink', `sink_name=${sinkName}`, `rate=${rate * 2}`],
        env
      );
      const loop =
        sink &&
        (await run(
          'pactl',
          ['load-module', 'module-loopback', `source=${sinkName}.monitor`, 'latency_msec=30'],
          env
        ));
      if (loop) {
        mode = 'game';
        recorder = record(`${sinkName}.monitor`);
        return { mode, env: { PULSE_SINK: sinkName } };
      }
      await unloadSink();
      mode = 'system';
      recorder = record('@DEFAULT_MONITOR@');
      return { mode };
    },

    /** The game closed (or the app quits): recording stops, what was kept stays. */
    stop() {
      stopRecorder();
      if (platform !== 'win32' && mode === 'game') {
        mode = 'none';
        return unloadSink();
      }
    },

    /** A text line from the helper: its seq and arrival time. */
    stamp() {
      seq += 1;
      const at = Date.now();
      arrivals.set(seq, at);
      if (arrivals.size > 2000) arrivals.delete(arrivals.keys().next().value);
      return { seq, at };
    },

    /** The helper's `input` message: a click or key in the game's window. */
    input() {
      const at = Date.now();
      inputs.push(at);
      if (inputs[0] < at - keepMs) inputs = inputs.filter((time) => time >= at - keepMs);
    },

    /** The helper's `window` message: the game's main window, for screenshots. */
    window({ hwnd, xid, title, width, height }) {
      const id = platform === 'win32' ? hwnd : xid;
      source = { id: id ? `window:${id}:0` : '', name: title, width, height };
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
        // From the click that brought the line to the next line's (lineStart), with the sound
        // around it for the voice finder (line-audio.ts): { pcm, rate, start, end }, seconds in.
        const start = lineStart(index);
        const end = index < marks.length - 1 ? lineStart(index + 1) : Date.now();
        const from = start - preRollMs;
        const pcm = sound.clip(from, Math.min(end + tailMs, Date.now()));
        if (pcm)
          result.audio = {
            pcm: new Uint8Array(pcm.buffer),
            rate,
            start: preRollMs / 1000,
            end: (end - from) / 1000
          };
      }
      return result;
    },

    get mode() {
      return mode;
    }
  };
}
