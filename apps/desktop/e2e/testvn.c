// SPDX-License-Identifier: BSD-3-Clause
// Tiny test "VN": each click (or every 1.5 s) shows the next line, drawn the way VN engines do:
// TextOutW, ExtTextOutW, DrawTextW, GetGlyphOutlineW (one char at a time) and TextOutA (Shift-JIS).
// It also writes a save file to %APPDATA%\TestVN\save1.dat, Documents\TestVN\, Saved Games\TestVN\
// and savedata\ in its own folder. For Anki media, each step also has its own background colour, its
// own tone (stepHz) and a caption naming it, drawn with DrawTextExW (a thread with every step's line).
// With scenes.txt beside it (line-audio.e2e.mjs) it plays those scenes instead: looping music, a
// voice file per line (voices/, with a quiet pilot tone naming the line) and text drawn at once or
// a character at a time, advanced by clicks or by its own timer (see loadScenes).
#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <math.h>
#include <mmsystem.h>
#include <stdlib.h>

static const wchar_t *linesW[] = {
  L"「吾輩は猫である。名前はまだ無い。」",   // TextOutW
  L"どこで生れたかとんと見当がつかぬ。",     // ExtTextOutW
  L"何でも薄暗いじめじめした所で泣いていた。", // DrawTextW
  L"吾輩はここで始めて人間というものを見た。", // GetGlyphOutlineW
};
// "シフトJISの行です。" in Shift-JIS (TextOutA)
static const char lineA[] = "\x83\x56\x83\x74\x83\x67\x82\x69\x82\x68\x82\x72\x82\xcc\x8d\x73\x82\xc5\x82\xb7\x81\x42";
static int step = 0;
// Background per step (the E2E reads it back from the screenshot), and the step's tone.
static const COLORREF stepColors[] = {
  RGB(255, 255, 255), RGB(255, 80, 80), RGB(80, 200, 80), RGB(80, 80, 255), RGB(240, 200, 40), RGB(200, 60, 200),
  RGB(40, 200, 220), RGB(250, 140, 30), RGB(140, 90, 40), RGB(120, 120, 120), RGB(30, 30, 30), RGB(255, 180, 200)
};
#define stepHz(s) (400 + 80 * (s))

// A 1 s sine at the step's tone, as a WAV in memory for PlaySound.
static void playTone(int s) {
  static BYTE wav[44 + 48000];
  const DWORD rate = 24000, n = 24000;
  DWORD *d = (DWORD *)wav;
  memcpy(wav, "RIFF", 4); d[1] = 36 + n * 2; memcpy(wav + 8, "WAVEfmt ", 8); d[4] = 16;
  WAVEFORMATEX fmt = {WAVE_FORMAT_PCM, 1, rate, rate * 2, 2, 16, 0}; memcpy(wav + 20, &fmt, 16);
  memcpy(wav + 36, "data", 4); d[10] = n * 2;
  short *samples = (short *)(wav + 44);
  for (DWORD i = 0; i < n; i++) samples[i] = (short)(10000 * sin(6.283185307 * stepHz(s) * i / rate));
  PlaySoundW((LPCWSTR)wav, NULL, SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
}

static void writeSaveIn(const wchar_t *base, const wchar_t *sub) {
  wchar_t dir[MAX_PATH], file[MAX_PATH];
  swprintf(dir, MAX_PATH, L"%ls\\%ls", base, sub);
  CreateDirectoryW(dir, NULL);
  swprintf(file, MAX_PATH, L"%ls\\save1.dat", dir);
  HANDLE h = CreateFileW(file, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
  char data[64]; int n = sprintf(data, "step=%d\n", step);
  DWORD w; WriteFile(h, data, n, &w, NULL); CloseHandle(h);
  wprintf(L"save: %ls\n", file); fflush(stdout);
}

static void writeSave(REFKNOWNFOLDERID id, const wchar_t *sub) {
  PWSTR base;
  if (SHGetKnownFolderPath(id, KF_FLAG_CREATE, NULL, &base) != S_OK) return;
  writeSaveIn(base, sub);
  CoTaskMemFree(base);
}

static void paint(HWND hwnd) {
  PAINTSTRUCT ps; HDC dc = BeginPaint(hwnd, &ps);
  RECT all; GetClientRect(hwnd, &all);
  HBRUSH bg = CreateSolidBrush(stepColors[step % 12]); FillRect(dc, &all, bg); DeleteObject(bg);
  HFONT font = CreateFontW(28, 0, 0, 0, FW_NORMAL, 0, 0, 0, SHIFTJIS_CHARSET, 0, 0, ANTIALIASED_QUALITY, 0, L"MS Gothic");
  SelectObject(dc, font);
  SetBkMode(dc, TRANSPARENT);
  int kind = step % 5;
  if (kind == 0) TextOutW(dc, 20, 40, linesW[0], lstrlenW(linesW[0]));
  else if (kind == 1) ExtTextOutW(dc, 20, 40, 0, NULL, linesW[1], lstrlenW(linesW[1]), NULL);
  else if (kind == 2) { RECT r = {20, 40, 780, 200}; DrawTextW(dc, linesW[2], -1, &r, DT_LEFT | DT_WORDBREAK); }
  else if (kind == 3) {
    // Glyph by glyph, like engines that rasterise text themselves.
    MAT2 m = {{0, 1}, {0, 0}, {0, 0}, {0, 1}};
    int x = 20;
    for (const wchar_t *c = linesW[3]; *c; c++) {
      GLYPHMETRICS gm; DWORD size = GetGlyphOutlineW(dc, *c, GGO_GRAY8_BITMAP, &gm, 0, NULL, &m);
      if (size != GDI_ERROR && size) {
        BYTE *buf = malloc(size);
        GetGlyphOutlineW(dc, *c, GGO_GRAY8_BITMAP, &gm, size, buf, &m);
        int pitch = (gm.gmBlackBoxX + 3) & ~3;
        for (UINT y = 0; y < gm.gmBlackBoxY; y++)
          for (UINT xx = 0; xx < gm.gmBlackBoxX; xx++)
            if (buf[y * pitch + xx] > 20) SetPixel(dc, x + gm.gmptGlyphOrigin.x + xx, 64 - gm.gmptGlyphOrigin.y + y, 0);
        free(buf);
      }
      x += gm.gmCellIncX;
    }
  } else TextOutA(dc, 20, 40, lineA, lstrlenA(lineA));
  wchar_t caption[64]; swprintf(caption, 64, L"第%d場面の台詞です。", step);
  RECT capRect = {20, 120, 500, 160}; DrawTextExW(dc, caption, -1, &capRect, DT_LEFT, NULL);
  DeleteObject(font);
  EndPaint(hwnd, &ps);
}


// Scene mode. scenes.txt: one line per scene, "voice cut draw advance ms text": voice = index of
// voices/voiceN.wav or -1; cut = 1 stops the voice at the next scene (0 lets it run, until the
// next voice); draw = once | type (one character every 1.5 s / length); advance = click | auto
// (after ms). Every scene's text goes through drawLine (one TextOutW thread).
typedef struct { int voice, cut, type, autoMs; wchar_t text[128]; } Scene;
static Scene scenes[64];
static int sceneCount = 0, typed = 0;
static HWAVEOUT bgmOut, voiceOut;
static WAVEHDR bgmHdr, voiceHdr;
static short *voiceBuf;
static HWND mainHwnd;
#define RATE 16000

static int loadScenes(void) {
  FILE *f = _wfopen(L"scenes.txt", L"rb");
  if (!f) return 0;
  char line[1024];
  while (sceneCount < 64 && fgets(line, sizeof line, f)) {
    Scene *sc = &scenes[sceneCount];
    char draw[16], adv[16]; int used = 0;
    if (sscanf(line, "%d %d %15s %15s %d %n", &sc->voice, &sc->cut, draw, adv, &sc->autoMs, &used) < 5) continue;
    line[strcspn(line, "\r\n")] = 0;
    MultiByteToWideChar(CP_UTF8, 0, line + used, -1, sc->text, 128);
    sc->type = !strcmp(draw, "type");
    if (strcmp(adv, "auto")) sc->autoMs = 0;
    sceneCount++;
  }
  fclose(f);
  return sceneCount;
}

static HWAVEOUT openOut(void) {
  WAVEFORMATEX fmt = {WAVE_FORMAT_PCM, 1, RATE, RATE * 2, 2, 16, 0};
  HWAVEOUT out = NULL;
  waveOutOpen(&out, WAVE_MAPPER, &fmt, 0, 0, CALLBACK_NULL);
  return out;
}

// 8 s of music, looped: an arpeggio, a bass line and a soft kick, all under 2 kHz.
static void startMusic(void) {
  static short music[RATE * 8];
  static const double chords[4][3] = {{261.6, 329.6, 392.0}, {220.0, 261.6, 329.6}, {174.6, 220.0, 261.6}, {196.0, 246.9, 293.7}};
  for (int i = 0; i < RATE * 8; i++) {
    double t = (double)i / RATE, v = 0;
    int bar = i / (RATE * 2), note = (i / (RATE / 4)) % 8;
    double nt = fmod(t, 0.25), f = chords[bar][note % 3] * (note >= 3 ? 2 : 1);
    v += 2200 * exp(-nt * 6) * (sin(6.2832 * f * t) + 0.3 * sin(6.2832 * 2 * f * t) + 0.1 * sin(6.2832 * 3 * f * t));
    v += 1600 * sin(6.2832 * chords[bar][0] / 2 * t);
    double kt = fmod(t, 0.5);
    v += 2500 * exp(-kt * 30) * sin(6.2832 * (60 + 80 * exp(-kt * 40)) * kt);
    music[i] = (short)v;
  }
  bgmOut = openOut();
  bgmHdr.lpData = (LPSTR)music; bgmHdr.dwBufferLength = sizeof music;
  bgmHdr.dwFlags = WHDR_BEGINLOOP | WHDR_ENDLOOP; bgmHdr.dwLoops = 1000;
  waveOutPrepareHeader(bgmOut, &bgmHdr, sizeof bgmHdr);
  waveOutWrite(bgmOut, &bgmHdr, sizeof bgmHdr);
}

// The scene's voice with a quiet pilot tone at 4000 + 150 × scene Hz (the E2E finds lines by it).
static void playVoice(int scene) {
  if (voiceHdr.dwFlags & WHDR_PREPARED) { waveOutReset(voiceOut); waveOutUnprepareHeader(voiceOut, &voiceHdr, sizeof voiceHdr); }
  if (scenes[scene].voice < 0) return;
  wchar_t name[64]; swprintf(name, 64, L"voices\\voice%d.wav", scenes[scene].voice);
  FILE *f = _wfopen(name, L"rb");
  if (!f) return;
  fseek(f, 0, SEEK_END); long size = ftell(f) - 44; fseek(f, 44, SEEK_SET);
  free(voiceBuf); voiceBuf = malloc(size);
  size = fread(voiceBuf, 1, size, f); fclose(f);
  double hz = 4000 + 150 * scene;
  for (long i = 0; i < size / 2; i++) {
    int v = voiceBuf[i] + (int)(300 * sin(6.2832 * hz * i / RATE));
    voiceBuf[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  memset(&voiceHdr, 0, sizeof voiceHdr);
  voiceHdr.lpData = (LPSTR)voiceBuf; voiceHdr.dwBufferLength = size;
  waveOutPrepareHeader(voiceOut, &voiceHdr, sizeof voiceHdr);
  waveOutWrite(voiceOut, &voiceHdr, sizeof voiceHdr);
}

static __attribute__((noinline)) void drawLine(HDC dc, int x, const wchar_t *text, int n) {
  TextOutW(dc, x, 40, text, n);
}

static HFONT sceneFont(HDC dc) {
  static HFONT font;
  if (!font) font = CreateFontW(28, 0, 0, 0, FW_NORMAL, 0, 0, 0, SHIFTJIS_CHARSET, 0, 0, ANTIALIASED_QUALITY, 0, L"MS Gothic");
  SetBkMode(dc, TRANSPARENT);
  return SelectObject(dc, font);
}

// The next character of a typewriter scene, drawn on its own.
static void typeNext(void) {
  const wchar_t *text = scenes[step].text;
  if (typed >= lstrlenW(text)) { KillTimer(mainHwnd, 2); return; }
  HDC dc = GetDC(mainHwnd); sceneFont(dc);
  SIZE before; GetTextExtentPoint32W(dc, text, typed, &before);
  drawLine(dc, 20 + before.cx, text + typed, 1);
  ReleaseDC(mainHwnd, dc);
  typed++;
}

static void showScene(void) {
  Scene *sc = &scenes[step];
  HDC dc = GetDC(mainHwnd);
  RECT all; GetClientRect(mainHwnd, &all);
  HBRUSH bg = CreateSolidBrush(stepColors[step % 12]); FillRect(dc, &all, bg); DeleteObject(bg);
  ReleaseDC(mainHwnd, dc);
  // A voice that isn't cut runs on, until the next voice.
  if (sc->voice >= 0 || (step > 0 && scenes[step - 1].cut)) playVoice(step);
  typed = 0;
  if (sc->type) SetTimer(mainHwnd, 2, 1500 / lstrlenW(sc->text), NULL);
  else {
    dc = GetDC(mainHwnd); sceneFont(dc);
    drawLine(dc, 20, sc->text, lstrlenW(sc->text));
    ReleaseDC(mainHwnd, dc);
  }
  if (sc->autoMs) SetTimer(mainHwnd, 3, sc->autoMs, NULL);
}

static LRESULT CALLBACK sceneProc(HWND hwnd, UINT msg, WPARAM w, LPARAM l) {
  switch (msg) {
  case WM_PAINT: { PAINTSTRUCT ps; BeginPaint(hwnd, &ps); EndPaint(hwnd, &ps); return 0; }
  case WM_TIMER:
    if (w == 2) { typeNext(); return 0; }
    // Scene 0 again until the first click: the hook comes in after the game starts.
    if (w == 4) { HDC dc = GetDC(hwnd); sceneFont(dc); drawLine(dc, 20, scenes[0].text, lstrlenW(scenes[0].text)); ReleaseDC(hwnd, dc); return 0; }
    KillTimer(hwnd, 3);
    // fall through: the scene's own timer advances it
  case WM_LBUTTONDOWN:
    if (msg == WM_LBUTTONDOWN && scenes[step].autoMs) return 0;
    KillTimer(hwnd, 2);
    KillTimer(hwnd, 4);
    if (++step >= sceneCount) { PostQuitMessage(0); return 0; }
    showScene();
    return 0;
  case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd, msg, w, l);
}

static LRESULT CALLBACK proc(HWND hwnd, UINT msg, WPARAM w, LPARAM l) {
  switch (msg) {
  case WM_PAINT: paint(hwnd); return 0;
  case WM_TIMER: case WM_LBUTTONDOWN:
    step++;
    playTone(step);
    if (step % 5 == 0) {
      writeSave(&FOLDERID_RoamingAppData, L"TestVN");
      writeSave(&FOLDERID_Documents, L"TestVN");
      writeSave(&FOLDERID_SavedGames, L"TestVN");
      wchar_t self[MAX_PATH];
      GetModuleFileNameW(NULL, self, MAX_PATH);
      *wcsrchr(self, L'\\') = 0;
      writeSaveIn(self, L"savedata");
    }
    if (step >= 11) PostQuitMessage(0);
    InvalidateRect(hwnd, NULL, TRUE); return 0;
  case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd, msg, w, l);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
  int sceneMode = loadScenes();
  WNDCLASSW wc = {0}; wc.lpfnWndProc = sceneMode ? sceneProc : proc; wc.hInstance = inst; wc.lpszClassName = L"TestVN";
  wc.hbrBackground = (HBRUSH)GetStockObject(WHITE_BRUSH); wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassW(&wc);
  // TESTVN_MS: the step time when no argument gives it; TESTVN_HEIGHT: the window's (overlay E2E).
  wchar_t env[16];
  int height = GetEnvironmentVariableW(L"TESTVN_HEIGHT", env, 16) ? _wtoi(env) : 200;
  HWND hwnd = CreateWindowW(L"TestVN", L"テストVN", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 820, height, NULL, NULL, inst, NULL);
  int ms = cmd && *cmd ? _wtoi(cmd) : GetEnvironmentVariableW(L"TESTVN_MS", env, 16) ? _wtoi(env) : 1500;
  if (sceneMode) {
    mainHwnd = hwnd;
    voiceOut = openOut();
    startMusic();
    UpdateWindow(hwnd);
    showScene();
    SetTimer(hwnd, 4, 1000, NULL);
  } else SetTimer(hwnd, 1, ms, NULL);
  MSG msg; while (GetMessageW(&msg, NULL, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
