// SPDX-License-Identifier: GPL-3.0-or-later
// chimihook: starts a game, injects LunaHook (LunaTranslator, GPL-3.0) into it and prints every
// text line as one JSON object per line on stdout (UTF-8). A separate program from the desktop app
// (it loads the GPL-3.0 LunaHost64.dll in-process), like the bundled Yomitan.
//
// Usage: chimihook.exe [--locale] [--audio <pipe>] <game.exe>
//   --locale  start the game through Locale Remulator (LRProc.exe, LGPL-3.0, beside this exe) with
//             its "Run in Japanese" profile (Windows: Shift JIS games on any system locale).
//   --audio   Windows: record the game's sound (its process tree; Windows 10 2004+, else the whole
//             system) as PCM s16le mono 24 kHz into the named pipe <pipe>, for Anki clips.
// Lines: {"type":"text","thread":{pid,addr,ctx,ctx2,hookcode,name},"sentence":"…"}; also "thread"
// (a new thread), "inject", "connect", "disconnect", "error" {message}, "window" {hwnd, xid, title,
// x, y, width, height, active, minimized} (the game's main window, on change; xid: Wine's X11
// window, else 0; x/y/size: its client area in screen pixels, which is what a window manager's
// frame holds under Wine; active: it is the foreground window), "input" (a click on the game's
// window or a key pressed while it is in front, not modifiers or key repeats: where Anki clips
// start; low-level hooks, which may not fire under every Wine), "audio" {mode:
// "process" | "system" | "none"} (with --audio) and "exit" last.
// LunaHost64.dll, LunaHook32/64.dll and inject32.exe sit next to it. Same under Wine and Windows.
#include <initguid.h>
#include <windows.h>
#include <tlhelp32.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <stdint.h>
#include <stdio.h>

typedef struct { DWORD processId; uint64_t addr, ctx, ctx2; } ThreadParam;
typedef void (*ProcessEvent)(DWORD);
typedef void (*ThreadEventE)(const wchar_t *, const char *, ThreadParam, BOOLEAN);
typedef void (*ThreadEvent)(const wchar_t *, const char *, ThreadParam);
typedef void (*OutputCb)(const wchar_t *, const char *, ThreadParam, const wchar_t *);
typedef void (*HostInfo)(int, const wchar_t *);
typedef void (*HookInsert)(DWORD, uint64_t, const wchar_t *);
typedef void (*Embed)(const wchar_t *, ThreadParam);
typedef wchar_t *(*I18N)(const wchar_t *);
typedef void (*EmuInfo)(const wchar_t *, const wchar_t *, const wchar_t *);
typedef void (*StartFn)(ProcessEvent, ProcessEvent, ThreadEventE, ThreadEvent, OutputCb, HostInfo, HookInsert, Embed, I18N, EmuInfo);
typedef void (*SettingsFn)(int, int, int, int, BOOLEAN);
typedef void (*PidFn)(DWORD);
typedef BOOLEAN (*NeedFn)(DWORD);

// LRConfig.xml's "Run in Japanese" profile (the copy LunaTranslator ships).
#define LR_JAPANESE L"688d4946-eed5-4983-9915-a0022f0f759c"

static CRITICAL_SECTION out;

// JSON string body, UTF-8.
static void jstr(const wchar_t *s) {
  putchar('"');
  for (; s && *s; s++) {
    wchar_t c = *s;
    if (c == '"' || c == '\\') printf("\\%c", (char)c);
    else if (c < 0x20) printf("\\u%04x", c);
    else {
      int pair = c >= 0xd800 && c < 0xdc00 && s[1];
      char buf[8]; int n = WideCharToMultiByte(CP_UTF8, 0, s, pair ? 2 : 1, buf, 8, 0, 0);
      fwrite(buf, 1, n, stdout);
      if (pair) s++;
    }
  }
  putchar('"');
}

static void emit(const char *kind, const wchar_t *hookcode, const char *name, ThreadParam tp, const wchar_t *text) {
  EnterCriticalSection(&out);
  wchar_t wname[128]; MultiByteToWideChar(CP_UTF8, 0, name ? name : "", -1, wname, 128);
  printf("{\"type\":\"%s\",\"thread\":{\"pid\":%lu,\"addr\":%llu,\"ctx\":%llu,\"ctx2\":%llu,\"hookcode\":", kind,
         tp.processId, (unsigned long long)tp.addr, (unsigned long long)tp.ctx, (unsigned long long)tp.ctx2);
  jstr(hookcode); printf(",\"name\":"); jstr(wname); printf("}");
  if (text) { printf(",\"sentence\":"); jstr(text); }
  printf("}\n"); fflush(stdout);
  LeaveCriticalSection(&out);
}

static void event(const char *kind, DWORD pid) {
  EnterCriticalSection(&out); printf("{\"type\":\"%s\",\"pid\":%lu}\n", kind, pid); fflush(stdout); LeaveCriticalSection(&out);
}

static void fail(const char *what, DWORD code) {
  EnterCriticalSection(&out);
  printf("{\"type\":\"error\",\"message\":\"%s (error %lu)\"}\n", what, code); fflush(stdout);
  LeaveCriticalSection(&out);
}

static void onConnect(DWORD pid) { event("connect", pid); }
static void onDisconnect(DWORD pid) { event("disconnect", pid); }
static void onCreate(const wchar_t *hc, const char *n, ThreadParam tp, BOOLEAN e) { emit("thread", hc, n, tp, NULL); }
static void onDestroy(const wchar_t *hc, const char *n, ThreadParam tp) {}
static void onOutput(const wchar_t *hc, const char *n, ThreadParam tp, const wchar_t *text) { emit("text", hc, n, tp, text); }
static void onInfo(int type, const wchar_t *log) {}
static void onInsert(DWORD pid, uint64_t addr, const wchar_t *hc) {}
static void onEmbed(const wchar_t *t, ThreadParam tp) {}
static wchar_t *onI18n(const wchar_t *t) { return NULL; }
static void onEmu(const wchar_t *a, const wchar_t *b, const wchar_t *c) {}

static BOOL inject64(HANDLE proc, const wchar_t *dll) {
  SIZE_T size = (wcslen(dll) + 1) * sizeof(wchar_t);
  LPVOID mem = VirtualAllocEx(proc, NULL, size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
  if (!mem || !WriteProcessMemory(proc, mem, dll, size, NULL)) return FALSE;
  HANDLE t = CreateRemoteThread(proc, NULL, 0, (LPTHREAD_START_ROUTINE)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"), mem, 0, NULL);
  if (!t) return FALSE;
  WaitForSingleObject(t, 10000);
  DWORD code = 0; GetExitCodeThread(t, &code); CloseHandle(t);
  return code != 0;
}

static BOOL run(wchar_t *cmd, const wchar_t *cwd, PROCESS_INFORMATION *pi) {
  STARTUPINFOW si = {sizeof si};
  return CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, cwd, &si, pi);
}

// The game LRProc.exe started (LRProc exits right after): the newest process running <game> that
// started after <since>. NULL after 15 s.
static HANDLE findGame(const wchar_t *game, ULONGLONG since, DWORD *pid) {
  const wchar_t *base = wcsrchr(game, L'\\'); base = base ? base + 1 : game;
  for (int tries = 0; tries < 150; tries++, Sleep(100)) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32W pe = {sizeof pe};
    HANDLE found = NULL;
    for (BOOL more = Process32FirstW(snap, &pe); more && !found; more = Process32NextW(snap, &pe)) {
      if (_wcsicmp(pe.szExeFile, base)) continue;
      HANDLE proc = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pe.th32ProcessID);
      if (!proc) continue;
      wchar_t image[MAX_PATH]; DWORD size = MAX_PATH;
      FILETIME created, x1, x2, x3;
      if (QueryFullProcessImageNameW(proc, 0, image, &size) && !_wcsicmp(image, game) &&
          GetProcessTimes(proc, &created, &x1, &x2, &x3) &&
          (((ULONGLONG)created.dwHighDateTime << 32) | created.dwLowDateTime) >= since) {
        found = proc; *pid = pe.th32ProcessID;
      } else CloseHandle(proc);
    }
    CloseHandle(snap);
    if (found) return found;
  }
  return NULL;
}

static DWORD gamePid;

// The game's main window: its largest visible unowned top-level window.
typedef struct { HWND hwnd; LONG area; } Found;
static BOOL CALLBACK findWindow(HWND hwnd, LPARAM data) {
  DWORD pid; GetWindowThreadProcessId(hwnd, &pid);
  RECT r;
  if (pid != gamePid || !IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) || !GetWindowRect(hwnd, &r)) return TRUE;
  Found *f = (Found *)data;
  LONG area = (r.right - r.left) * (r.bottom - r.top);
  if (area > f->area) { f->hwnd = hwnd; f->area = area; }
  return TRUE;
}

// Says where the game's window is whenever it changes (screenshots for Anki, the overlay), every
// 0.1 s so the overlay follows a moved window.
static DWORD WINAPI watchWindow(LPVOID unused) {
  HWND lastHwnd = NULL; wchar_t lastTitle[256] = L""; RECT last = {0}; BOOL lastActive = -1, lastMin = -1;
  for (;; Sleep(100)) {
    Found f = {NULL, 0};
    EnumWindows(findWindow, (LPARAM)&f);
    if (!f.hwnd) continue;
    wchar_t title[256] = L""; GetWindowTextW(f.hwnd, title, 256);
    RECT r; GetClientRect(f.hwnd, &r);
    MapWindowPoints(f.hwnd, NULL, (POINT *)&r, 2);
    BOOL active = GetForegroundWindow() == f.hwnd, minimized = IsIconic(f.hwnd);
    if (f.hwnd == lastHwnd && EqualRect(&r, &last) && active == lastActive && minimized == lastMin &&
        !wcscmp(title, lastTitle)) continue;
    lastHwnd = f.hwnd; last = r; lastActive = active; lastMin = minimized; wcscpy(lastTitle, title);
    // winex11's X window for this HWND (absent on Windows).
    ULONGLONG xid = (ULONGLONG)(UINT_PTR)GetPropA(f.hwnd, "__wine_x11_whole_window");
    EnterCriticalSection(&out);
    printf("{\"type\":\"window\",\"hwnd\":%llu,\"xid\":%llu,\"title\":", (ULONGLONG)(UINT_PTR)f.hwnd, xid);
    jstr(title);
    printf(",\"x\":%ld,\"y\":%ld,\"width\":%ld,\"height\":%ld,\"active\":%s,\"minimized\":%s}\n", r.left, r.top,
           r.right - r.left, r.bottom - r.top, active ? "true" : "false", minimized ? "true" : "false");
    fflush(stdout);
    LeaveCriticalSection(&out);
  }
  return 0;
}

// Clicks and keys in the game, for where each line's sound starts (game-media.js).
static void inputEvent(void) {
  EnterCriticalSection(&out); printf("{\"type\":\"input\"}\n"); fflush(stdout); LeaveCriticalSection(&out);
}

static BOOL ofGame(HWND hwnd) {
  DWORD pid = 0;
  if (hwnd) GetWindowThreadProcessId(GetAncestor(hwnd, GA_ROOT), &pid);
  return pid && pid == gamePid;
}

static LRESULT CALLBACK mouseHook(int code, WPARAM w, LPARAM l) {
  // The window under the pointer: a click on the overlay above the game isn't the game's.
  if (code == HC_ACTION && w == WM_LBUTTONDOWN && ofGame(WindowFromPoint(((MSLLHOOKSTRUCT *)l)->pt))) inputEvent();
  return CallNextHookEx(NULL, code, w, l);
}

static BOOL keyHeld[256];
static LRESULT CALLBACK keyHook(int code, WPARAM w, LPARAM l) {
  if (code == HC_ACTION) {
    DWORD vk = ((KBDLLHOOKSTRUCT *)l)->vkCode & 0xff;
    BOOL down = w == WM_KEYDOWN || w == WM_SYSKEYDOWN;
    // Modifiers are Yomitan's scan keys (and Ctrl a game's skip), held keys repeat.
    BOOL modifier = vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT || vk == VK_CONTROL || vk == VK_LCONTROL ||
                    vk == VK_RCONTROL || vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU || vk == VK_LWIN || vk == VK_RWIN;
    if (down && !keyHeld[vk] && !modifier && ofGame(GetForegroundWindow())) inputEvent();
    keyHeld[vk] = down;
  }
  return CallNextHookEx(NULL, code, w, l);
}

// Low-level hooks run on the thread that set them, which needs a message loop.
static DWORD WINAPI watchInput(LPVOID unused) {
  SetWindowsHookExW(WH_MOUSE_LL, mouseHook, GetModuleHandleW(NULL), 0);
  SetWindowsHookExW(WH_KEYBOARD_LL, keyHook, GetModuleHandleW(NULL), 0);
  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) DispatchMessageW(&msg);
  return 0;
}

// Process loopback (audioclientactivationparams.h, Windows 10 2004+), declared here: older
// mingw-w64 headers lack it.
typedef struct { DWORD ActivationType; DWORD TargetProcessId; DWORD ProcessLoopbackMode; } LoopbackParams;
typedef HRESULT (WINAPI *ActivateFn)(LPCWSTR, REFIID, PROPVARIANT *, IActivateAudioInterfaceCompletionHandler *, IActivateAudioInterfaceAsyncOperation **);
static const GUID agileObject = {0x94ea2b94, 0xe9cc, 0x49e0, {0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90}};

typedef struct { IActivateAudioInterfaceCompletionHandler iface; HANDLE done; } Handler;
static HRESULT STDMETHODCALLTYPE hQuery(IActivateAudioInterfaceCompletionHandler *self, REFIID riid, void **obj) {
  if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_IActivateAudioInterfaceCompletionHandler) || IsEqualIID(riid, &agileObject)) {
    *obj = self; return S_OK;
  }
  *obj = NULL; return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE hRef(IActivateAudioInterfaceCompletionHandler *self) { return 1; } // static lifetime
static HRESULT STDMETHODCALLTYPE hDone(IActivateAudioInterfaceCompletionHandler *self, IActivateAudioInterfaceAsyncOperation *op) {
  SetEvent(((Handler *)self)->done); return S_OK;
}
static IActivateAudioInterfaceCompletionHandlerVtbl handlerVtbl = {hQuery, hRef, hRef, hDone};

// The game's process tree's sound, or NULL (before Windows 10 2004).
static IAudioClient *processClient(void) {
  HMODULE mm = LoadLibraryW(L"Mmdevapi.dll");
  ActivateFn activate = mm ? (ActivateFn)GetProcAddress(mm, "ActivateAudioInterfaceAsync") : NULL;
  if (!activate) return NULL;
  LoopbackParams params = {1 /* PROCESS_LOOPBACK */, gamePid, 0 /* INCLUDE_TARGET_PROCESS_TREE */};
  PROPVARIANT pv; PropVariantInit(&pv);
  pv.vt = VT_BLOB; pv.blob.cbSize = sizeof params; pv.blob.pBlobData = (BYTE *)&params;
  static Handler handler = {{&handlerVtbl}, NULL};
  handler.done = CreateEventW(NULL, FALSE, FALSE, NULL);
  IActivateAudioInterfaceAsyncOperation *op = NULL;
  IAudioClient *client = NULL;
  if (SUCCEEDED(activate(L"VAD\\Process_Loopback", &IID_IAudioClient, &pv, &handler.iface, &op)) &&
      WaitForSingleObject(handler.done, 5000) == WAIT_OBJECT_0) {
    HRESULT hr; IUnknown *unk = NULL;
    if (SUCCEEDED(op->lpVtbl->GetActivateResult(op, &hr, &unk)) && SUCCEEDED(hr) && unk) {
      unk->lpVtbl->QueryInterface(unk, &IID_IAudioClient, (void **)&client);
      unk->lpVtbl->Release(unk);
    }
  }
  if (op) op->lpVtbl->Release(op);
  return client;
}

// The whole system's sound: the default output's loopback.
static IAudioClient *systemClient(void) {
  IMMDeviceEnumerator *en = NULL; IMMDevice *dev = NULL; IAudioClient *client = NULL;
  if (SUCCEEDED(CoCreateInstance(&CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, &IID_IMMDeviceEnumerator, (void **)&en)) &&
      SUCCEEDED(en->lpVtbl->GetDefaultAudioEndpoint(en, eRender, eConsole, &dev)))
    dev->lpVtbl->Activate(dev, &IID_IAudioClient, CLSCTX_ALL, NULL, (void **)&client);
  if (dev) dev->lpVtbl->Release(dev);
  if (en) en->lpVtbl->Release(en);
  return client;
}

static void audioMode(const char *mode) {
  EnterCriticalSection(&out); printf("{\"type\":\"audio\",\"mode\":\"%s\"}\n", mode); fflush(stdout); LeaveCriticalSection(&out);
}

// Records the game's sound into the pipe (main's rolling buffer) until the pipe closes.
static DWORD WINAPI recordAudio(LPVOID pipeName) {
  CoInitializeEx(NULL, COINIT_MULTITHREADED);
  WAVEFORMATEX fmt = {WAVE_FORMAT_PCM, 1, 24000, 48000, 2, 16, 0};
  DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  const char *mode = "process";
  IAudioClient *client = processClient();
  if (!client || FAILED(client->lpVtbl->Initialize(client, AUDCLNT_SHAREMODE_SHARED, flags, 2000000, 0, &fmt, NULL))) {
    if (client) client->lpVtbl->Release(client);
    mode = "system";
    client = systemClient();
    if (client && FAILED(client->lpVtbl->Initialize(client, AUDCLNT_SHAREMODE_SHARED, flags, 2000000, 0, &fmt, NULL))) {
      client->lpVtbl->Release(client); client = NULL;
    }
  }
  IAudioCaptureClient *capture = NULL;
  HANDLE pipe = INVALID_HANDLE_VALUE;
  if (client && SUCCEEDED(client->lpVtbl->GetService(client, &IID_IAudioCaptureClient, (void **)&capture)))
    pipe = CreateFileW((wchar_t *)pipeName, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (pipe == INVALID_HANDLE_VALUE || FAILED(client->lpVtbl->Start(client))) { audioMode("none"); return 0; }
  audioMode(mode);
  static short silence[24000];
  for (BOOL ok = TRUE; ok; Sleep(20)) {
    UINT32 frames;
    while (ok && SUCCEEDED(capture->lpVtbl->GetNextPacketSize(capture, &frames)) && frames) {
      BYTE *data; DWORD bufFlags, written;
      if (FAILED(capture->lpVtbl->GetBuffer(capture, &data, &frames, &bufFlags, NULL, NULL))) break;
      // Packets are at most the 0.2 s buffer (4800 frames).
      ok = WriteFile(pipe, bufFlags & AUDCLNT_BUFFERFLAGS_SILENT ? (BYTE *)silence : data, frames * 2, &written, NULL);
      capture->lpVtbl->ReleaseBuffer(capture, frames);
    }
  }
  client->lpVtbl->Stop(client);
  CloseHandle(pipe);
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  int arg = 1;
  BOOL locale = FALSE; wchar_t *audioPipe = NULL;
  for (; arg < argc - 1; arg++) {
    if (!wcscmp(argv[arg], L"--locale")) locale = TRUE;
    else if (!wcscmp(argv[arg], L"--audio") && arg + 2 < argc) audioPipe = argv[++arg];
    else break;
  }
  if (arg != argc - 1) { fprintf(stderr, "usage: chimihook [--locale] [--audio pipe] game.exe\n"); return 2; }
  InitializeCriticalSection(&out);
  wchar_t game[MAX_PATH]; GetFullPathNameW(argv[arg], MAX_PATH, game, NULL);
  wchar_t dir[MAX_PATH]; GetModuleFileNameW(NULL, dir, MAX_PATH); *wcsrchr(dir, L'\\') = 0;
  wchar_t path[MAX_PATH]; swprintf(path, MAX_PATH, L"%ls\\LunaHost64.dll", dir);
  HMODULE host = LoadLibraryW(path);
  if (!host) { fail("LunaHost64.dll didn't load", GetLastError()); return 1; }
  ((SettingsFn)GetProcAddress(host, "Luna_Settings"))(500, 932, 3000, 1000000, TRUE);
  ((StartFn)GetProcAddress(host, "Luna_Start"))(onConnect, onDisconnect, onCreate, onDestroy, onOutput, onInfo, onInsert, onEmbed, onI18n, onEmu);

  // The game starts in its own folder, as a launcher would.
  wchar_t gameDir[MAX_PATH]; wcscpy(gameDir, game); *wcsrchr(gameDir, L'\\') = 0;
  wchar_t cmd[2048];
  HANDLE proc; DWORD pid;
  if (locale) {
    FILETIME now; GetSystemTimeAsFileTime(&now);
    ULONGLONG since = (((ULONGLONG)now.dwHighDateTime << 32) | now.dwLowDateTime) - 10000000; // 1 s slack
    swprintf(cmd, 2048, L"\"%ls\\LRProc.exe\" " LR_JAPANESE L" \"%ls\"", dir, game);
    PROCESS_INFORMATION lr;
    if (!run(cmd, gameDir, &lr)) { fail("Locale Remulator didn't start", GetLastError()); return 1; }
    CloseHandle(lr.hThread); CloseHandle(lr.hProcess);
    proc = findGame(game, since, &pid);
    if (!proc) { fail("The game didn't start through Locale Remulator", 0); return 1; }
  } else {
    PROCESS_INFORMATION pi;
    swprintf(cmd, 2048, L"\"%ls\"", game);
    if (!run(cmd, gameDir, &pi)) { fail("The game didn't start", GetLastError()); return 1; }
    CloseHandle(pi.hThread); proc = pi.hProcess; pid = pi.dwProcessId;
  }
  gamePid = pid;
  // Started at once: the sound from the game's first moments is kept too.
  if (audioPipe) CloseHandle(CreateThread(NULL, 0, recordAudio, audioPipe, 0, NULL));
  CloseHandle(CreateThread(NULL, 0, watchWindow, NULL, 0, NULL));
  CloseHandle(CreateThread(NULL, 0, watchInput, NULL, 0, NULL));
  WaitForInputIdle(proc, 5000);
  Sleep(300);

  ((PidFn)GetProcAddress(host, "Luna_ConnectProcess"))(pid);
  if (((NeedFn)GetProcAddress(host, "Luna_CheckIfNeedInject"))(pid)) {
    BOOL wow = FALSE; IsWow64Process(proc, &wow);
    BOOL ok;
    if (!wow) { swprintf(path, MAX_PATH, L"%ls\\LunaHook64.dll", dir); ok = inject64(proc, path); }
    else {
      // A 32-bit game: a 32-bit helper finds its kernel32's LoadLibraryW.
      swprintf(cmd, 2048, L"\"%ls\\inject32.exe\" %lu \"%ls\\LunaHook32.dll\"", dir, pid, dir);
      PROCESS_INFORMATION p2;
      ok = run(cmd, NULL, &p2);
      if (ok) { WaitForSingleObject(p2.hProcess, 15000); DWORD c = 1; GetExitCodeProcess(p2.hProcess, &c); ok = c == 0; }
    }
    EnterCriticalSection(&out);
    printf("{\"type\":\"inject\",\"pid\":%lu,\"bits\":%d,\"ok\":%s}\n", pid, wow ? 32 : 64, ok ? "true" : "false"); fflush(stdout);
    LeaveCriticalSection(&out);
  }
  WaitForSingleObject(proc, INFINITE);
  Sleep(800); // last lines flush
  EnterCriticalSection(&out); printf("{\"type\":\"exit\"}\n"); fflush(stdout); LeaveCriticalSection(&out);
  return 0;
}
