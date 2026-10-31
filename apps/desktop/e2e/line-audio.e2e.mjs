/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Line audio bank: how often a mined line of a game played natively gets the right sound for
// Anki (game-media.js windows, lib/data/vn/line-audio.ts voice finder). The test VN (testvn.c,
// scene mode) plays the scenes below over looping music: real speech (voices/, LibriVox, public
// domain) and voiceless lines, text drawn at once or a character at a time, voices cut at the
// click or running past it, lines advanced by clicks (xdotool, so chimihook's input hooks see
// them) or by the game's own timer. Each line is mined into a fake AnkiConnect afterwards, and its
// clip is scored by the pilot tone each voice carries (4000 + 150 × scene Hz):
//   right  = a voiced line's clip holds its whole voice (90 % of the tone's span the voice file
//            gives, referenceSpan) and no other line's; a voiceless line gets no sound
//   wrong  = another line's voice (or its tail) in the clip, or any sound on a voiceless line
//   missed = a voiced line with no sound or only part of its voice
// LINE_AUDIO_BANK=heldout runs the held-out bank instead (below). Prints the table and the score,
// and fails below 95 % right or above 2 % wrong
// (LINE_AUDIO_SCORE_ONLY=1 only prints, for a baseline run of an older build).
//
// Needs what native-vn.e2e.mjs needs (Wine, mingw, xdotool, PulseAudio with pactl/parec, a
// display): cd apps/desktop && pnpm run fetch && pnpm run build:web
//   xvfb-run -a node e2e/line-audio.e2e.mjs   (E2E_DIR, PULSE_MODULES, E2E_APP as there)

/* global localStorage, window -- used inside page.evaluate */
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const desktop = join(import.meta.dirname, '..');
const { _electron } = createRequire(join(desktop, '../web/package.json'))('playwright');
const root = process.env.E2E_DIR ?? mkdtempSync(join(tmpdir(), 'chimi-line-audio-'));
const gameDir = join(root, 'games', 'Line VN');
const home = join(root, 'home');
const title = 'ラインVN';
// Each voice file's length (16 kHz mono s16 after a 44-byte header).
const voiceSeconds = Array.from(
  { length: 10 },
  (_, i) => (readFileSync(join(import.meta.dirname, 'voices', `voice${i}.wav`)).length - 44) / 32000
);

// voice (-1: none), cut (1: stopped at the next line), draw, advance, ms (until the click or the
// game's own advance), text. Scene 0 waits for the thread to be picked; the last one ends the game.
const tuned = [
  [-1, 1, 'once', 'click', 0, '準備ができたらクリックしてください。'],
  [0, 1, 'once', 'click', 3000, '春の朝は空気が澄んでいる。'],
  [-1, 1, 'once', 'click', 2500, '窓の外で鳥が鳴いた。'],
  [1, 1, 'type', 'click', 3500, '彼女は静かに本を閉じた。'],
  [4, 0, 'once', 'click', 1800, '長い話はまだ終わらない。'],
  [-1, 1, 'once', 'click', 3500, '部屋には誰もいなかった。'],
  [2, 1, 'once', 'auto', 3000, '駅までの道を急いだ。'],
  [3, 1, 'once', 'auto', 3800, '遠くで汽笛が聞こえる。'],
  [-1, 1, 'once', 'auto', 2500, '風が少し冷たくなった。'],
  [0, 1, 'type', 'click', 3000, '机の上に手紙があった。'],
  [4, 0, 'type', 'click', 2000, '答えは最初から決まっていた。'],
  [1, 1, 'once', 'click', 3200, '雨が上がって虹が出た。'],
  [-1, 1, 'type', 'click', 2500, '時計の針が十二時を指す。'],
  [2, 1, 'once', 'click', 2600, '扉の向こうに光が見えた。'],
  [3, 1, 'once', 'click', 3200, '誰かが名前を呼んでいる。'],
  [-1, 1, 'once', 'click', 2000, '足音が近づいてくる。'],
  [4, 1, 'once', 'click', 4500, '夜の海は思ったより静かだ。'],
  [-1, 1, 'once', 'auto', 2000, '灯りがひとつ消えた。'],
  [2, 1, 'type', 'auto', 3000, '猫が日なたで眠っている。'],
  [0, 0, 'once', 'click', 1200, '約束の時間はとうに過ぎた。'],
  [-1, 1, 'once', 'click', 3000, '返事はなかった。'],
  [3, 1, 'once', 'click', 3200, '明日もきっと晴れるだろう。'],
  [-1, 1, 'once', 'auto', 1500, 'おしまい。']
];
// LINE_AUDIO_BANK=heldout: the held-out bank, never tuned on (line-audio.ts rules are tuned on
// the scenes above only): the same kinds of lines with other voices (voice5-9, two with a pause
// inside), the other music and other timings.
const heldout = [
  [-1, 1, 'once', 'click', 0, '準備ができたらクリックしてください。'],
  [5, 1, 'once', 'click', 2800, '山の上に古い寺がある。'],
  [6, 1, 'type', 'click', 3300, '彼は黙って頷いた。'],
  [-1, 1, 'once', 'auto', 2200, '夕日が沈みかけていた。'],
  [7, 1, 'type', 'auto', 3600, '遠い町から手紙が届いた。'],
  [8, 0, 'once', 'click', 2200, '話の続きはまた明日だ。'],
  [-1, 1, 'once', 'click', 3000, '誰も答えなかった。'],
  [9, 0, 'once', 'click', 1500, 'その日は朝から雨だった。'],
  [-1, 1, 'type', 'click', 3200, '窓を閉めて灯りを消した。'],
  [5, 1, 'once', 'auto', 3000, '鐘の音が三度鳴った。'],
  [-1, 1, 'once', 'auto', 2400, 'しばらく沈黙が続いた。'],
  [6, 1, 'type', 'auto', 3400, '道の先に人影が見えた。'],
  [7, 1, 'once', 'click', 3400, '約束を忘れたわけではない。'],
  [9, 0, 'once', 'click', 2300, 'それは誰にも言えない秘密だった。'],
  [-1, 1, 'once', 'click', 2800, '返事を待った。'],
  [8, 1, 'type', 'click', 4800, '長い坂道をゆっくりと登っていく。'],
  [-1, 1, 'type', 'auto', 2500, '時間だけが過ぎていった。'],
  [5, 1, 'type', 'auto', 2800, '扉が静かに開いた。'],
  [6, 1, 'once', 'click', 2600, '名前を呼ぶ声がした。'],
  [8, 0, 'once', 'click', 2000, 'その先の話は聞きたくない。'],
  [7, 1, 'once', 'click', 3300, '彼女は小さく笑った。'],
  [-1, 1, 'once', 'click', 2400, '外はもう暗い。'],
  [-1, 1, 'once', 'auto', 1500, 'おしまい。']
];
const bank = process.env.LINE_AUDIO_BANK === 'heldout' ? 'heldout' : 'tuned';
const scenes = bank === 'heldout' ? heldout : tuned;
const scored = scenes.slice(1, -1).map((scene, i) => {
  const index = i + 1;
  const [voice, cut, , , ms] = scene;
  const next = scenes[index + 1];
  // A voice plays until it ends, its cut, or the next voice.
  const stopped = cut || next[0] >= 0;
  const played =
    voice < 0 ? 0 : stopped ? Math.min(voiceSeconds[voice], ms / 1000) : voiceSeconds[voice];
  return { index, voice, text: scene[5], played };
});

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

rmSync(root, { recursive: true, force: true });
mkdirSync(gameDir, { recursive: true });
mkdirSync(join(home, 'Documents'), { recursive: true });
execFileSync('i686-w64-mingw32-gcc', [
  '-municode',
  '-mwindows',
  '-O2',
  '-s',
  '-o',
  join(gameDir, 'testvn.exe'),
  join(import.meta.dirname, 'testvn.c'),
  '-lole32',
  '-luuid',
  '-lwinmm'
]);
cpSync(join(import.meta.dirname, 'voices'), join(gameDir, 'voices'), { recursive: true });
writeFileSync(
  join(gameDir, 'scenes.txt'),
  (bank === 'heldout' ? 'music 1\n' : '') + scenes.map((scene) => scene.join(' ')).join('\n') + '\n'
);

// Our own PulseAudio: one null sink as the speakers.
const pulseDir = join(root, 'pulse');
mkdirSync(pulseDir);
writeFileSync(
  join(pulseDir, 'default.pa'),
  `load-module module-native-protocol-unix socket=${pulseDir}/native auth-anonymous=1
load-module module-null-sink sink_name=speakers
set-default-sink speakers
`
);
const pulse = spawn(
  'pulseaudio',
  [
    '-n',
    '--daemonize=no',
    '--exit-idle-time=-1',
    ...(process.env.PULSE_MODULES ? [`--dl-search-path=${process.env.PULSE_MODULES}`] : []),
    '-F',
    join(pulseDir, 'default.pa')
  ],
  {
    env: { ...process.env, HOME: home, PULSE_RUNTIME_PATH: pulseDir, PULSE_STATE_PATH: pulseDir },
    stdio: 'ignore'
  }
);
for (let tries = 0; !existsSync(join(pulseDir, 'native')); tries += 1) {
  if (tries > 50) fail('PulseAudio didn’t start (pulseaudio and pulseaudio-utils needed)');
  await wait(100);
}

// A fake AnkiConnect: the notes the test adds, and what the app writes into them.
const anki = { notes: [], updates: new Map() };
const ankiServer = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const { action, params } = body ? JSON.parse(body) : {};
    let result = null;
    if (action === 'findNotes') result = anki.notes.map((note) => note.noteId);
    else if (action === 'notesInfo')
      result = anki.notes.filter((note) => params.notes.includes(note.noteId));
    else if (action === 'updateNoteFields') anki.updates.set(params.note.id, params.note);
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    response.end(JSON.stringify({ result, error: null }));
  });
});
await new Promise((resolve) => ankiServer.listen(0, '127.0.0.1', resolve));

const app = await _electron.launch({
  executablePath: process.env.E2E_APP ?? join(desktop, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', ...(process.env.E2E_APP ? [] : [desktop])],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: join(root, 'config'),
    HOME: home,
    PULSE_SERVER: `unix:${pulseDir}/native`,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  }
});

/** The game's X windows (no window manager: Wine places the game at 0,0). */
const gameWindows = () =>
  execFileSync('xwininfo', ['-root', '-tree'])
    .toString()
    .split('\n')
    .filter((line) => line.includes('("testvn.exe"'))
    .map((line) => line.trim().split(' ')[0]);

/** Mono s16 samples and rate of a WAV (data at 44, as both writers make them). */
function readWav(data) {
  const rate = data.readUInt32LE(24);
  const samples = new Int16Array(
    data.buffer.slice(data.byteOffset + 44, data.byteOffset + data.length)
  );
  return { rate, samples };
}

/**
 * Where in the clip each scene's pilot tone is heard (40 ms frames): { seconds heard, span from
 * the first frame to the last } (speech near the tone can hide it for a frame or two).
 */
function pilotSeconds({ rate, samples }) {
  const size = Math.round(rate * 0.04);
  const amplitude = (offset, hz) => {
    const k = 2 * Math.cos((2 * Math.PI * hz) / rate);
    let [s1, s2] = [0, 0];
    for (let i = offset; i < offset + size; i += 1) [s1, s2] = [samples[i] + k * s1 - s2, s1];
    return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2))) / size;
  };
  const heard = new Map();
  for (let offset = 0; offset + size <= samples.length; offset += size)
    for (let scene = 1; scene < scenes.length; scene += 1) {
      const hz = 4000 + 150 * scene;
      // Against the spectrum beside it: speech and music have no steady tone there. The sound
      // server's clock runs up to 1 % off the game's, so the tone may sit a little higher.
      const floor = Math.max(amplitude(offset, hz - 75), amplitude(offset, hz + 75), 20);
      const tone = Math.max(
        ...[0, 0.003, 0.006, 0.009].map((d) => amplitude(offset, hz * (1 + d)))
      );
      if (tone > 3 * floor) {
        const time = offset / rate;
        const seen = heard.get(scene) ?? { seconds: 0, first: time };
        heard.set(scene, {
          seconds: seen.seconds + 0.04,
          first: seen.first,
          span: time + 0.04 - seen.first
        });
      }
    }
  return heard;
}

/**
 * The pilot span a whole voice gives: the voice file as played (its first `played` seconds) with
 * the line's tone, at the recording's 24 kHz, through the same detector.
 */
function referenceSpan(line) {
  const voice = readWav(
    readFileSync(join(import.meta.dirname, 'voices', `voice${line.voice}.wav`))
  );
  const length = Math.min(voice.samples.length, Math.round(line.played * voice.rate));
  const samples = new Int16Array(Math.round((length * 24000) / voice.rate));
  for (let i = 0; i < samples.length; i += 1) {
    const at = (i * voice.rate) / 24000;
    const tone = 300 * Math.sin((2 * Math.PI * (4000 + 150 * line.index) * at) / voice.rate);
    samples[i] = Math.max(-32768, Math.min(32767, voice.samples[Math.floor(at)] + tone));
  }
  return pilotSeconds({ rate: 24000, samples }).get(line.index)?.span ?? 0;
}

const page = await app.firstWindow();
try {
  page.setDefaultTimeout(180_000);
  await page.waitForLoadState('load');
  await page.evaluate((port) => {
    localStorage.setItem('storageChosen', '1');
    localStorage.setItem('ankiEnabled', '1');
    localStorage.setItem('ankiConnectUrl', `http://127.0.0.1:${port}`);
  }, ankiServer.address().port);
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, gameDir);

  step('Import → Installed game, opened from the library');
  await page.goto('http://127.0.0.1:41917/manage');
  await page.getByTitle('Import books').click();
  await page.getByRole('button', { name: 'Installed game…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.locator('.ng-program', { hasText: 'testvn.exe' }).click();
  await page.locator('.ng-field input').fill(title);
  await page.getByRole('button', { name: 'Add game' }).click();
  await page.locator('.ng').waitFor({ state: 'detached' });
  await page.locator(`.cover-card-main[title="${title}"]`).click();
  await page.getByText('Read', { exact: true }).click();
  await page.waitForURL(/\/hook\?native=/);
  // Linked on this computer by Add game: it starts; else the folder dialog.
  if (await page.getByRole('button', { name: 'Choose folder…' }).count()) {
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await page.getByRole('button', { name: 'Link and play' }).click();
  }

  step('The game’s TextOutW thread picked, then the scenes played');
  await page.locator('.nt-row').first().waitFor();
  await wait(1500);
  console.log(`  threads: ${(await page.locator('.nt-row').allTextContents()).join(' | ')}`);
  await page.locator('.nt-row', { hasText: 'TextOutW' }).first().click({ timeout: 20_000 });
  for (let tries = 0; !gameWindows().length; tries += 1) {
    if (tries > 100) fail('no game window');
    await wait(100);
  }
  // Xvfb has no window manager: screenshots need WM_STATE.
  for (const window of gameWindows())
    execFileSync('xprop', ['-id', window, '-f', 'WM_STATE', '32c', '-set', 'WM_STATE', '1']);
  execFileSync('xdotool', ['mousemove', '400', '120']);
  await wait(500);
  const click = () => execFileSync('xdotool', ['click', '1']);
  click();
  for (const [, , , advance, ms] of scenes.slice(1, -1)) {
    await wait(ms);
    if (advance === 'click') click();
  }
  await page.getByText('The game has closed.').waitFor();
  const shown = await page.locator('.hook-text li').allTextContents();
  const missing = scored.filter((line) => !shown.some((text) => text.includes(line.text)));
  if (missing.length) fail(`lines not shown: ${missing.map((line) => line.index)}`);

  // LINE_AUDIO_DUMP=1: each line's raw window (what /hook hands lineAudio), for tuning offline.
  if (process.env.LINE_AUDIO_DUMP) {
    const raw = await page.evaluate(
      async (texts) => {
        const kept = JSON.parse(localStorage.getItem('hookLines') ?? '[]');
        const out = [];
        for (const text of texts) {
          const line = kept.find((item) => item.text === text);
          const found = line && (await window.chimiDesktop.games.media(line.seq, { audio: true }));
          out.push(found?.audio && { ...found.audio, pcm: [...found.audio.pcm] });
        }
        return out;
      },
      scored.map((line) => line.text)
    );
    raw.forEach((audio, i) => {
      if (!audio) return;
      writeFileSync(join(root, `raw${scored[i].index}.pcm`), Buffer.from(audio.pcm));
      writeFileSync(
        join(root, `raw${scored[i].index}.json`),
        JSON.stringify({ ...audio, pcm: undefined, text: scored[i].text })
      );
    });
  }

  step('Each line mined: its clip scored');
  const rows = [];
  for (const line of scored) {
    const noteId = 1000 + line.index;
    anki.notes.push({
      noteId,
      modelName: 'Basic',
      fields: {
        Sentence: { value: line.text, order: 0 },
        SentenceAudio: { value: '', order: 1 },
        Picture: { value: '', order: 2 }
      }
    });
    // The app's notice for the note (why a line got nothing, when it says).
    let notice = '';
    for (let tries = 0; !anki.updates.has(noteId); tries += 1) {
      // A note with neither picture nor sound gets no update.
      if (tries > 60) break;
      notice = (await page.locator('.anki-notice').allTextContents()).join(' ').trim() || notice;
      await wait(250);
    }
    const audio = anki.updates.get(noteId)?.audio?.[0]?.data;
    const clip = audio && readWav(Buffer.from(audio, 'base64'));
    const heard = clip ? pilotSeconds(clip) : new Map();
    const own = heard.get(line.index)?.span ?? 0;
    const others = [...heard]
      .filter(([scene, { seconds }]) => scene !== line.index && seconds >= 0.12)
      .map(([scene, { seconds }]) => [scene, seconds]);
    let result;
    if (line.voice < 0) result = clip ? 'wrong' : 'right';
    else if (others.length) result = 'wrong';
    else if (clip && own >= 0.9 * referenceSpan(line)) result = 'right';
    else result = 'missed';
    rows.push({
      line: line.index,
      voice: line.voice < 0 ? '-' : `${line.played.toFixed(1)} s`,
      clip: clip ? `${(clip.samples.length / clip.rate).toFixed(2)} s` : 'none',
      own: own.toFixed(2),
      others: others.map(([scene, seconds]) => `${scene}:${seconds.toFixed(2)}`).join(' '),
      result,
      ...(clip ? {} : { notice })
    });
    if (clip) writeFileSync(join(root, `line${line.index}.wav`), Buffer.from(audio, 'base64'));
  }
  console.table(rows);
  const count = (result) => rows.filter((row) => row.result === result).length;
  const right = count('right') / rows.length;
  const wrong = count('wrong') / rows.length;
  const voiceless = rows.filter((row) => row.voice === '-');
  console.log(
    `score (${bank}): ${(100 * right).toFixed(1)} % right, ${(100 * wrong).toFixed(1)} % wrong, ` +
      `${count('missed')} missed of ${rows.length}; voiceless right ` +
      `${voiceless.filter((row) => row.result === 'right').length}/${voiceless.length}`
  );
  writeFileSync(join(root, 'score.json'), JSON.stringify({ right, wrong, rows }, null, 2));
  if (!process.env.LINE_AUDIO_SCORE_ONLY && (right < 0.95 || wrong > 0.02))
    fail(`below the bar: ${(100 * right).toFixed(1)} % right, ${(100 * wrong).toFixed(1)} % wrong`);
  console.log(`OK (clips in ${root})`);
} catch (error) {
  await page.screenshot({ path: join(root, 'failed.png') });
  throw error;
} finally {
  await app.close();
  ankiServer.close();
  pulse.kill();
}
