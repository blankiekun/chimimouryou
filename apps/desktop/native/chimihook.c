// SPDX-License-Identifier: GPL-3.0-or-later
// chimihook: starts a game, injects LunaHook (LunaTranslator, GPL-3.0) into it and prints every
// text line as one JSON object per line on stdout (UTF-8). A separate program from the desktop app
// (it loads the GPL-3.0 LunaHost64.dll in-process), like the bundled Yomitan.
//
// Usage: chimihook.exe [--locale] <game.exe>
//   --locale  start the game through Locale Remulator (LRProc.exe, LGPL-3.0, beside this exe) with
//             its "Run in Japanese" profile (Windows: Shift JIS games on any system locale).
// Lines: {"type":"text","thread":{pid,addr,ctx,ctx2,hookcode,name},"sentence":"…"}; also "thread"
// (a new thread), "inject", "connect", "disconnect", "error" {message} and "exit" last.
// LunaHost64.dll, LunaHook32/64.dll and inject32.exe sit next to it. Same under Wine and Windows.
#include <windows.h>
#include <tlhelp32.h>
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

int wmain(int argc, wchar_t **argv) {
  BOOL locale = argc > 2 && !wcscmp(argv[1], L"--locale");
  if (argc < 2 + locale) { fprintf(stderr, "usage: chimihook [--locale] game.exe\n"); return 2; }
  InitializeCriticalSection(&out);
  wchar_t game[MAX_PATH]; GetFullPathNameW(argv[1 + locale], MAX_PATH, game, NULL);
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
