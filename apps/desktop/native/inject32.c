// SPDX-License-Identifier: GPL-3.0-or-later
// 32-bit side of chimihook: LoadLibraryW of <dll> in the 32-bit process <pid>. Exit 0 = loaded.
#include <windows.h>
#include <stdlib.h>
int wmain(int argc, wchar_t **argv) {
  if (argc < 3) return 2;
  HANDLE proc = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ, FALSE, wcstoul(argv[1], 0, 10));
  if (!proc) return 3;
  SIZE_T size = (lstrlenW(argv[2]) + 1) * sizeof(wchar_t);
  LPVOID mem = VirtualAllocEx(proc, NULL, size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
  if (!mem || !WriteProcessMemory(proc, mem, argv[2], size, NULL)) return 4;
  HANDLE t = CreateRemoteThread(proc, NULL, 0, (LPTHREAD_START_ROUTINE)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"), mem, 0, NULL);
  if (!t) return 5;
  WaitForSingleObject(t, 10000);
  DWORD code = 0; GetExitCodeThread(t, &code);
  return code ? 0 : 6;
}
