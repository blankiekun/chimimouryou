# Porting LunaHook engines to VNBox hook scripts

This folder holds LunaHook's 32-bit engines (LunaTranslator, HIllya51, `LunaHook/engine32/`, commit
be625f4) ported to JavaScript hook scripts. VNBox runs them in the game process through `frida-compat.js`:
`Interceptor.attach` with `onEnter` only, register and stack reads, guest memory reads, and `trans.send`.
`libLuna.js` maps LunaHook's C++ API (HookParam, MemDbg, Util, string filters, engine checks) onto
that, so a port is a near line-by-line copy of the C++. This file is the rulebook for the ports: follow it
exactly, and a port reads like every other port.

- Source: `$LUNA/src/NativeImpl/LunaHook/LunaHook/engine32/<Name>.cpp` (`$LUNA`: a LunaTranslator clone at commit be625f4) and
  `<Name>.h` (read-only). LunaHook's helpers: `util/util.cc`, `util/memdbg/memsearch.cc`,
  `util/stringfilters.cpp`, `texthook.cc` (TextHook::Send), `include/types.h` (HookParam).
- Licence: LunaTranslator is GPL-3.0; these files are GPL-3.0-or-later. Every port carries the header
  below. Never copy this code into VNBox (GPL-2.0-only).
- Out of scope: translation embedding, memory writes, onLeave. See "Skip rules".

## Files

| File | What it is |
| --- | --- |
| `libLuna.js` | The runtime (`const L = require('./libLuna.js')`). Read its exports when an idiom below is missing. |
| `<Name>.js` | One per C++ file, same stem and case as `engine32/<Name>.cpp`. Exports the engine (or an array when the `.h` declares several classes). Runs itself when VNBox loads it as the hook script. |
| `PC_LunaEngines.js` | The automatic script: every ported engine in LunaHook's order (`enginecollection32.cpp`), the first match attaches; with none, the GDI text exports are hooked. The block between `// <engines>` markers is generated. |
| `order.mjs` | LunaHook's engine order (`ORDER`), and `node order.mjs` regenerates `PC_LunaEngines.js`. |
| `engines.check.mjs` | Self-check: libLuna unit tests on a fake guest, then every engine file loaded against a fake frida with no match. |

`scripts/vnbox/build.sh` copies `*.js` here into the site's `vn/vnbox/hooks/engines/`, and
`hook-index.mjs` indexes each file (engine names, LunaHook order, file checks) for the Windows game dialog,
which suggests the first engine whose file checks the imported folder passes when no 0xDC00 script matches.

## Workflow for one engine

1. Read `<Name>.h` (the check) and `<Name>.cpp`. Skip `#if 0` blocks; comments can hide code after
   `//*` and `/*`, so read the raw file where a line looks cut.
2. Write `<Name>.js` from the template, translating with the tables below. Keep function names, order,
   constants, patterns and comments that explain a pattern (a short `// mov eax, …` is fine).
3. `node order.mjs` (adds it to `PC_LunaEngines.js`; it fails when the class name is not in LunaHook's order).
4. `node engines.check.mjs` (must end with "… find no match on an empty guest"; an engine with no pattern that hooks an export goes in `ATTACH_ANY`).
5. `LUNA=… python3 -I scripts/vnbox/engines/check-port.py scripts/vnbox/engines <Name>`: every byte run,
   number and string of the C++ should be in the port. Fix real misses. Misses that are fine (dead code,
   skipped embed parts, the checker misreading `R"(…)"` raw strings or `//*` in comments) go in the
   "Checker misses" column of the status table with the reason.
6. Add the engine to the status table at the end of this file.

## Template

```js
// <Name>.js: LunaHook's <Name> engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/<Name>.cpp and <Name>.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L; // only the ones used

// helpers from the .cpp: plain functions, same names
function InsertFooHook() { … }

const E = L.engine({
    name: '<Class>',            // the C++ class name (it is what LunaHook's order lists)
    check: { FILE: 'x.dat' },   // from the .h, see "Engine checks"
    certain: false,             // only when the .h sets is_engine_certain = false
    attach() { return InsertFooHook(); }, // attach_function()
});

module.exports = E;             // or [E1, E2] for several classes in one .h
if (!module.parent) L.run(E);
```

`name:` must directly follow `L.engine({` (order.mjs reads it). `require()` paths must be literal
`'./x.js'` strings: VNBox preloads them by scanning the text, so never write a `require('./…')` for a
file that does not exist, not even in a comment.

## Engine checks (the .h constructor)

| C++ (`.h`) | JS |
| --- | --- |
| `check_by = CHECK_BY::FILE; check_by_target = L"a.pak";` | `check: { FILE: 'a.pak' }` |
| `CHECK_BY::FILE_ALL; check_by_list{L"a", L"b"}` | `check: { FILE_ALL: ['a', 'b'] }` |
| `CHECK_BY::FILE_ANY; check_by_list{…}` | `check: { FILE_ANY: [...] }` |
| `CHECK_BY::RESOURCE_STR; L"xyz"` | `check: { RESOURCE_STR: 'xyz' }` |
| `CHECK_BY::StringFileInfo; L"xyz"` | `check: { StringFileInfo: 'xyz' }` |
| `CHECK_BY::CUSTOM; []() { return …; }` | `check: () => …` plus `files: [...]` (below) |
| no `check_by` (ALL_TRUE) | leave `check` out (the engine matches and is not certain) |
| `is_engine_certain = false;` | `certain: false` |
| `Util::CheckFile(L"*.xp3")` | `L.CheckFile('*.xp3')` (`\\` in names may stay or become `/`) |
| `Util::CheckFileAll({…})` / `CheckFileAny({…})` | `L.CheckFileAll([...])` / `L.CheckFileAny([...])` |
| `Util::SearchResourceString(L"…")` | `L.SearchResourceString('…')` |
| `GetModuleHandleW(L"x.dll")` in a check | `L.GetModuleHandleW('x.dll')` |
| `processName_lower`, `wcscmp(processName, …)` | `L.processName_lower`, `L.processName` |

`files`: for a CUSTOM check, the file names whose presence alone makes the check true (the `CheckFile`
names in an `||` chain at the top level). The page only knows the game's files; it uses `files` to suggest
the engine. KiriKiri: `check: () => L.CheckFile('*.xp3') || L.SearchResourceString('TVP(KIRIKIRI)'), files: ['*.xp3']`.
Leave it out when no file alone passes the check.

File checks run against the game folder (listed from the browser's private file system, relative to the
exe's folder): `*` and `?` wildcards, case-insensitive, folders match too.

## Values and memory

LunaHook code works on `DWORD`/`uintptr_t` numbers; so does the port. Addresses are plain numbers
(unsigned 32-bit). Write `>>> 0` where C++ arithmetic wraps or a result is compared with `===`.

| C++ | JS |
| --- | --- |
| `processStartAddress`, `processStopAddress` | `L.processStartAddress`, `L.processStopAddress` (the exe image) |
| `*(BYTE *)a`, `*(WORD *)a`, `*(DWORD *)a`, `*(int *)a` | `L.u8(a)`, `L.u16(a)`, `L.u32(a)`, `L.i32(a)` (also `L.i8`, `L.i16`) |
| the same inside a `text_fun`/`filter_fun` | the same (`L.live.u32` etc. are aliases; every read is live) |
| `(char *)p` as a C string | `L.readA(p)` (a byte string) / `L.strlen(p)` |
| `(wchar_t *)p` as a C string | `L.readW(p)` (text) / `L.wcslen(p)` |
| `std::string(p, n)` / `std::wstring(p, n)` | `L.readA(p, n)` / `L.readW(p, n)` (n in characters) |
| `IsBadReadPtr(p, n)` / `Engine::isAddressReadable(p)` | `L.IsBadReadPtr(p, n)` / `L.isAddressReadable(p)` |
| `memcmp(p, bytes, n) == 0`, `MatchPattern(p, sig, sizeof sig)` | `L.MatchPattern(p, bytesArray)` (XX matches any byte) |
| a struct read: `((Foo *)p)->field` | `L.u32(p + offsetOfField)`: work the offset out from the struct (mind `#pragma pack`), and leave a comment naming the struct |
| `sizeof(bytes)` | `bytes.length` |
| `(DWORD)::TextOutA`, `(DWORD)GetGlyphOutlineW` | `L.FindFunction('TextOutA')` (the export's address) |
| `GetModuleHandle(W/A)(L"x.dll")`, `GetModuleHandle(nullptr)` | `L.GetModuleHandle('x.dll')` (base or 0), `L.GetModuleHandle(null)` (the exe) |
| `GetProcAddress(hmod, "Fn")` | `L.GetProcAddress(hmod, 'Fn')` (0 when missing) |
| `Util::QueryModuleLimits(hmod, 0, PAGE_READONLY)` / `(hmod)` | `L.QueryModuleLimits(hmod, 0, L.PAGE_READONLY)` / `L.QueryModuleLimits(hmod)` → `[start, stop]` |
| `auto [s, e] = …;` | `const [s, e] = …;` |
| `Util::GetCodeRange(hmod, &low, &high)` | `const [low, high] = L.GetCodeRange(hmod)` |
| `min(a, b)`, `max(a, b)` | `Math.min`, `Math.max` |
| `MAX_REL_ADDR`, `MemDbg::MaximumFunctionSize` | `0x00300000`, `L.MaximumFunctionSize` |
| `static int x;` in a function / lambda | a `let` next to the function (module level) or in the closure that makes the hook |

## Byte patterns

Copy C++ arrays verbatim into JS arrays. `XX` (0x11) is a wildcard byte in LunaHook's searches and in
libLuna's; spread the multi-byte forms.

| C++ | JS |
| --- | --- |
| `BYTE bytes[] = {0x55, 0x8b, XX, XX4, 0xe8};` | `const bytes = [0x55, 0x8b, XX, ...XX4, 0xe8];` (`XX2`, `XX8` too) |
| `bytes[2] = 0x0f;` then search again | the same on the JS array |
| `char s[] = "abc";` searched with `sizeof(s)` | `L.aToBytes('abc\0')` (sizeof counts the NUL) |
| `const char *s = "abc";` searched with `strlen(s)` | `L.aToBytes('abc')` |
| `wchar_t s[] = L"abc";` with `sizeof(s)` | `L.wToBytes('abc\0')` |
| `L"abc"` with `wcslen(s) * 2` | `L.wToBytes('abc')` |
| `&addr, sizeof(addr)` (a DWORD's bytes) | `L.le32(addr)` |
| `find_pattern("55 8b ?? 4?", s, e)` | `L.find_pattern('55 8b ?? 4?', s, e)` (nibble wildcards) |

A string pattern `'55 8b ?? 4?'` also works anywhere a pattern is taken, but arrays keep the port
identical to the C++ and visible to the checker; use strings only for `find_pattern`.

## Searches (MemDbg, Util, util.cc)

All take and return numbers; 0 or `[]` when not found. Each is a port of the C++ function of the same name.

| C++ | JS |
| --- | --- |
| `MemDbg::findBytes(bytes, sizeof(bytes), lo, hi)` | `L.findBytes(bytes, lo, hi)` |
| `MemDbg::findBytesAll(…)`, `MemDbg::iterFindBytes(fun, …)` | `L.findBytesAll(bytes, lo, hi)`, `L.iterFindBytes(fun, bytes, lo, hi)` |
| `reverseFindBytes(bytes, sizeof, lo, hi, off, align)` | `L.reverseFindBytes(bytes, lo, hi, off, align)` |
| `Util::SearchMemory(bytes, sizeof, prot, min, max)` | `L.SearchMemory(bytes, prot, min, max)` (array) |
| `MemDbg::findEnclosingAlignedFunction(a[, size])` / `_strict` | `L.findEnclosingAlignedFunction(a[, size])` / `L.findEnclosingAlignedFunction_strict` |
| `findfuncstart(a, range, align)` | `L.findfuncstart(a, range, align)` |
| `MemDbg::findEnclosingFunctionAfterInt3/AfterNop/BeforeDword/AfterDword` | same names on `L` |
| `MemDbg::findCallerAddress(fn, sig, lo, hi[, size, off])` (+ `AfterInt3`, `Last…`, `findMultiCallerAddress(fn, sigs, n, lo, hi)`) | same names and arguments on `L` |
| `MemDbg::findNearCallAddress / findFarCallAddress / findCallAddress / findLongJumpAddress / findShortJumpAddress` (+ `Last…`) | same names on `L` |
| `MemDbg::iterNearCallAddress(fun, fn, lo, hi)`, `iterCallerAddress(fun, fn, sig, lo, hi)`, `iterUniqueCallerAddress…`, `iterAlignedNearCallerAddress` | same; `fun` returns `true` to go on, as in C++ |
| `MemDbg::findAlignedNearCallerAddress / findLastAlignedNearCallerAddress` | same names |
| `MemDbg::findPushAddress(v, lo, hi)`, `find_leaorpush_addr(_all)`, `findPushByteAddress` | same names |
| `findiatcallormov(fn, hmod, lo, hi[, reverse, movreg])`, `findiatcallormov_all(fn, hmod, lo, hi, prot[, movreg])` | same; the C++ often passes `processStartAddress` as `hmod` |
| `findxref_reverse(a, from, to)`, `findxref_reverse_checkcallop(a, from, to, 0xe8)` | same names (last match first, as in C++) |
| `findrelativecall(bytes, len, callAddr, lo, hi)` | `L.findrelativecall(bytes, len, callAddr, lo, hi)` |
| `Util::FindCallAndEntryAbs/Rel/Both(fn, size, pt, sig)`, `FindCallOrJmpRel/Abs`, `FindCallBoth`, `FindImportEntry` | same names |
| a hand-written loop over code bytes (`for (addr = s; addr < e; addr++) if (*(BYTE*)addr == …)`) | `const { bytes: b, base } = L.region(s, e);` then index `b[a - base]` (fast; see KiriKiri's `attachPrivate`) |

A search whose upper bound is below the lower one runs on to the module's end, as LunaHook's unsigned
size wraps; keep such calls as they are.

## Hooks

`HookParam hp; hp.x = …; NewHook(hp, "name")` becomes one object literal:

```js
return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT }, 'Name');
```

| HookParam field | JS |
| --- | --- |
| `address` | absolute address, or with `MODULE_OFFSET` (+`FUNCTION_OFFSET`) relative to `module` (`function`) |
| `offset`, `split` | `L.stackoffset(i)` (`GETARG(i)` → `L.GETARG(i)`), `L.regoffset('eax')`…`'edi'`. Raw numbers ≥ 0 are stack offsets and stay (`hp.offset = 8`) |
| `index`, `split_index`, `padding`, `length_offset`, `codepage`, `user_value` | same names, same values |
| `type` | the same flags on `L` (`L.CODEC_UTF16`, `L.USING_STRING`, `L.DATA_INDIRECT`, `L.USING_SPLIT`, `L.SPLIT_INDIRECT`, `L.FIXING_SPLIT`, `L.NO_CONTEXT`, `L.FULL_STRING`, `L.CODEC_ANSI_BE`, `L.CODEC_UTF8`, `L.CODEC_UTF32`, `L.USING_CHAR`, `L.MODULE_OFFSET`, `L.FUNCTION_OFFSET`, `L.KNOWN_UNSTABLE`, `L.HOOK_EMPTY`, `L.BREAK_POINT`). Drop every `EMBED_*` flag. |
| `module`, `function` (`wcscpy_s(hp.module, …)`) | `module: 'x.dll'`, `function: 'Fn'` |
| `lineSeparator = L"\\n"` | `lineSeparator: '\\n'` (the two characters backslash and n, as in C++) |
| `text_fun`, `filter_fun` | below |
| `embed_fun`, `embed_hook_font`, `hook_font`, `newlineseperator` for embedding | drop |
| `NewHook(hp, "name")` returns bool | `L.NewHook(hp, 'name')` returns bool; `succ \|= NewHook(…)` → `succ = L.NewHook(…) \|\| succ` (keep the call first so it always runs) |

Without `text_fun` the runtime does what TextHook::Send does: reads the data at `offset` (then `index`
when DATA_INDIRECT, plus `padding`), a string (USING_STRING; `length_offset` or strlen) or one character
(the low 16 bits, byte-swapped with CODEC_ANSI_BE), splits threads by `split` (USING_SPLIT,
SPLIT_INDIRECT) and decodes with the codec (cp932 unless `codepage`).

### text_fun

```cpp
hp.text_fun = [](hook_context *context, HookParam *hp, TextBuffer *buffer, uintptr_t *split) {
  auto s = (char *)context->stack[2];
  *split = context->ecx;
  buffer->from(s, strlen(s));
};
```
```js
text_fun(context, hp, buffer, split) {
    const s = context.stack[2];
    split.value = context.ecx;
    buffer.from(s, L.strlen(s));
},
```

| C++ | JS |
| --- | --- |
| `context->eax` … `context->edi`, `context->esp` | `context.eax` … (numbers) |
| `context->stack[i]`, `context->argof(i)`, `context->retaddr` | `context.stack[i]`, `context.argof(i)`, `context.retaddr` (`stack[0]`) |
| `context->argof_thiscall(i)`, `context->base` | `context.argof_thiscall(i)` (0 → ecx), `context.base` (= esp) |
| `*split = v` / `*split` | `split.value = v` / `split.value` |
| `hp->text_fun = nullptr; hp->type = HOOK_EMPTY;` (one-shot hooks) | `hp.text_fun = null; hp.type = L.HOOK_EMPTY;` |
| `hp->user_value`, `hp->type & …` | `hp.user_value`, `hp.type & …` |
| `return NewHook(…)` from inside a text_fun (dynamic hooks) | the same: `L.NewHook(…)` works at any time |
| a text_fun without USING_CHAR | the runtime adds USING_STRING, as LunaHook does |

### TextBuffer (`buffer`)

The buffer holds bytes, as in LunaHook: a byte string (one char per byte) for `char` data, UTF-16
code units for `wchar_t` data.

| C++ | JS |
| --- | --- |
| `buffer->from(ptr, nbytes)` | `buffer.from(ptr, nbytes)` |
| `buffer->from((char *)p)` / `buffer->from((wchar_t *)p)` (C strings at an address) | `buffer.fromCharPtr(p)` / `buffer.fromWCharPtr(p)` |
| `buffer->from(std::string)` / `buffer->from(std::wstring)` | `buffer.fromA(byteString)` / `buffer.fromW(text)` |
| `buffer->from_t(x)` (a `WORD`/`wchar_t`/`char`/`DWORD`) | `buffer.from_t(x, 2)` / `(x, 2)` / `(x, 1)` / `(x, 4)` |
| `buffer->fromWA(ws[, cp])` | `buffer.fromWA(text[, cp])` |
| `buffer->strA()`, `viewA()` / `strW()`, `viewW()` / `strAW([cp])` / `strU()` | the same names (byte string / text / decoded text / UTF-32 text) |
| `buffer->size`, `buffer->size = n`, `buffer->clear()` | `buffer.size`, `buffer.size = n` (truncates), `buffer.clear()` |
| `buffer->data` | `buffer.data` (Uint8Array) |
| `return buffer->clear();` | `return buffer.clear();` |

### filter_fun and strings

`filter_fun(TextBuffer *buffer, HookParam *hp)` → `filter_fun(buffer, hp) { … }`. A named filter
function stays a named JS function; `static` locals become a `let` captured by it.

Strings: `std::string`/`char` literals are byte strings; `std::wstring`/`L"…"` are JS strings. Keep
Japanese literals as they are; `\uXXXX` escapes mean the same in JS; `u8"…"` literals compared with a byte
string: `L.utf8A('…')`.

| C++ | JS |
| --- | --- |
| `StringFilter(buffer, TEXTANDLEN("x"))` / `TEXTANDLEN(L"x")` | `L.StringFilterA(buffer, 'x')` / `L.StringFilterW(buffer, 'x')` |
| `StringFilterBetween`, `StringReplacer`, `StringCharReplacer`, `CharReplacer`, `CharFilter`, `CharsFilter` | the same name with `A` (`"…"`/`'c'` literal) or `W` (`L"…"`/`L'c'`), arguments without the lengths |
| `NewLineCharFilterA/W`, `NewLineCharToSpaceA/W`, `all_ascii_Filter(W)`, `Utf8TypeChecker` (as `hp.filter_fun = …`) | `filter_fun: L.NewLineCharFilterA` etc. |
| `all_ascii(s)` | `L.all_ascii(s)` |
| `strReplace(s, L"a"[, L"b"])` (in place) | `s = L.strReplace(s, 'a'[, 'b'])` |
| `startWith(s, x)`, `endWith(s, x)` | `s.startsWith(x)`, `s.endsWith(x)` |
| `s.find(x) != npos`, `strstr`, `wcsstr` | `s.includes(x)` |
| `s.substr(a, n)`, `s.size()`, `s[i]`, `s.back()` | `s.substr(a, n)`, `s.length`, `s[i]`, `s[s.length - 1]` |
| `re::sub(s, LR"(…)"[, L"$1"])`, `std::regex_replace` | `L.re.sub(s, String.raw\`…\`[, '$1'])` (replaces all, ECMAScript syntax as std::regex) |
| `re::search(s, pat)` → `mc.value()[1].str()` | `const mc = L.re.search(s, pat)` → `mc[1]` (null when no match) |
| `re::match(s, pat)` (whole string) | `L.re.match(s, pat)` |
| `StringToWideString(s, cp).value()`, `WideStringToString(ws, cp)` | `L.StringToWideString(s, cp)`, `L.WideStringToString(ws, cp)` (932, 936, 949, 950, 65001) |
| `IsDBCSLeadByteEx(932, c)`, `IsShiftjisLeadByte`, `IsShiftjisWord` | same names on `L` |
| `remapkatakana(ws)` | `ws = L.remapkatakana(ws)` |

### Other calls

| C++ | JS |
| --- | --- |
| `PcHooks::hookGDIFunctions()` / `(ptr)` | `L.hookGDIFunctions()` / `(ptr)` |
| `Msg::Log`, `ConsoleOutput` | `console.log('[luna] …')` or drop |
| `RegisterEngineType(…)` | drop |
| `trigger_fun = …` | not supported: skip that hook (see below) |

## Skip rules

Port everything that reads text. Leave out, with a one-line comment saying what was left out:

- Embedding (translation written back into the game): `embed_fun`, `hp.embed_hook_font`, `EMBED_*`
  flags, `Engine::…Role` assignments, `dynamiccodec`, writes such as `wcscpy(gameBuffer, …)`. Keep the
  hook itself and its `text_fun`/`filter_fun`.
- Hooks that only work through a skipped feature: `hook_after`/`HOOK_RETURN` (no onLeave in VNBox),
  `hook_before` that rewrites the game's text, `DIRECT_READ` read codes, `CSHARP_STRING`/mono,
  `jittype` (emulator) hooks, `trigger_fun`, `patch_fun`, `ReplaceFunction`/detours, `INLINE_HOOK`
  replacements, `veh` breakpoints that change registers. Skip that hook only (comment it), keep the rest
  of the engine. `NewHook` refuses HOOK_RETURN, DIRECT_READ, CSHARP_STRING and `hook_after`/`hook_before`
  with a console note, so a missed one fails safe.
- Whole engines that are a JIT or emulator bridge (V8, cef, Unity, PPSSPP, godot, lua51, Renpy,
  RPGMaker MV/MZ's browser, AdobeAir/Flash bytecode): list them as skipped.
- `#if 0` code and code behind a `return` that cannot run.

## Known limits of the runtime (say so in a port that hits them)

- `L.SearchMemory` and `findiatcallormov_all` search the loaded modules only (no VirtualQuery in VNBox),
  not JIT or heap code: .NET/Flash engines that search generated code find nothing.
- `QueryModuleLimits` uses section flags for page protection; `SearchStringFileInfo` searches the whole
  resource section.
- VNBox attaches about 2 s after the exe starts: DLLs loaded later (plugins) are not there yet when
  `attach()` runs. An engine whose hook lives in such a DLL may need a retry (`setTimeout`) later.
- `CheckFile` sees the folder the game runs from, not files it opened (LunaHook's CheckFileViaHelper).
- Lines: each LunaHook thread (hook, return address, split) collects characters until 500 ms pass,
  `FULL_STRING` sends each string at once, and every thread goes out through `trans.send` (one stream).

## Worked examples

### 1. A file check, an import scan, a cross reference (A98SYS)

```cpp
// A98SYS.h
check_by = CHECK_BY::FILE;
check_by_target = L"A98SYS.PAK";
// A98SYS.cpp
auto addrs = findiatcallormov_all((DWORD)::ExtTextOutA, processStartAddress, processStartAddress, processStopAddress, PAGE_EXECUTE);
if (addrs.size() != 2) return false;
auto addr = addrs[1];
addr = MemDbg::findEnclosingAlignedFunction(addr);
if (!addr) return false;
auto addrs1 = findxref_reverse_checkcallop(addr, processStartAddress, processStopAddress, 0xe8);
if (!addrs1.size()) return false;
addr = MemDbg::findEnclosingAlignedFunction(addrs1[0]);
if (!addr) return false;
HookParam hp;
hp.address = addr;
hp.offset = stackoffset(1);
hp.type = USING_STRING | EMBED_ABLE | EMBED_AFTER_NEW | EMBED_DYNA_SJIS;
hp.embed_hook_font = F_ExtTextOutA;
return NewHook(hp, "A98SYS");
```
```js
const E = L.engine({
    name: 'A98SYS',
    check: { FILE: 'A98SYS.PAK' },
    attach() {
        const addrs = L.findiatcallormov_all(L.FindFunction('ExtTextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE);
        if (addrs.length !== 2) return false;
        let addr = L.findEnclosingAlignedFunction(addrs[1]);
        if (!addr) return false;
        const addrs1 = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
        if (!addrs1.length) return false;
        addr = L.findEnclosingAlignedFunction(addrs1[0]);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'A98SYS');
    },
});
```
The EMBED flags and `embed_hook_font` are gone; everything else is the same call with `L.` in front.

### 2. A char[] string, XX4 runs, a filter, an offset from sizeof (Broccoli)

```cpp
char check[] = "KaraokeMesPutCt %d, MojiCt %d";
if (!MemDbg::findBytes(check, sizeof(check), processStartAddress, processStopAddress)) return false;
const BYTE bytes[] = {
    0x8b, 0x0d, XX4,
    0x89, 0x44, 0x24, XX,
    0xa1, XX4,
    0x89, 0x4c, 0x24, XX,
    0x89, 0x44, 0x24, XX};
ULONG addr = MemDbg::findBytes(bytes, sizeof(bytes), processStartAddress, processStopAddress);
if (!addr) return false;
HookParam hp;
hp.address = addr + sizeof(bytes) - 8;
hp.offset = regoffset(ecx);
hp.filter_fun = [](TextBuffer *buffer, HookParam *hp) {
    if (buffer->viewA() == "\\") return buffer->clear();
};
return NewHook(hp, "Broccoli");
```
```js
if (!L.findBytes(L.aToBytes('KaraokeMesPutCt %d, MojiCt %d\0'), L.processStartAddress, L.processStopAddress)) return false;
const bytes = [
    0x8b, 0x0d, ...XX4,
    0x89, 0x44, 0x24, XX,
    0xa1, ...XX4,
    0x89, 0x4c, 0x24, XX,
    0x89, 0x44, 0x24, XX];
const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
if (!addr) return false;
return L.NewHook({
    address: addr + bytes.length - 8,
    offset: L.regoffset('ecx'),
    filter_fun(buffer) { if (buffer.viewA() === '\\') buffer.clear(); },
}, 'Broccoli');
```
No `type` means CODEC_ANSI_LE and one character, as in C++.

### 3. A custom check, a struct read in a text_fun, a filter with state, a one-shot hook (KiriKiri)

```cpp
// KiriKiri.h
check_by = CHECK_BY::CUSTOM;
check_by_target = []() { return Util::CheckFile(L"*.xp3") || Util::SearchResourceString(L"TVP(KIRIKIRI)"); };
// KiriKiri.cpp: struct tTJSVariantString_S { int RefCount; wchar_t *LongString; wchar_t ShortString[21 + 1]; int Length; … } (pack 4)
hp.text_fun = [](hook_context *context, HookParam *hp, TextBuffer *buffer, uintptr_t *split) {
    auto text = (kirikiri::ttstr *)context->stack[9];
    *split = context->ecx;
    buffer->from(text->Ptr->LongString ? text->Ptr->LongString : text->Ptr->ShortString, text->Ptr->Length * 2);
};
…
hp.filter_fun = [](TextBuffer *buffer, HookParam *) {
    static std::wstring last;
    auto ws = buffer->strW();
    if (ws == last) return buffer->clear();
    last = ws;
    buffer->from(filterkrkrz(ws));
};
…
hp.text_fun = [](hook_context *context, HookParam *hp, TextBuffer *buffer, uintptr_t *split) {
    hp->text_fun = nullptr;
    hp->type = HOOK_EMPTY;
    DWORD addr = MemDbg::findEnclosingAlignedFunction(context->stack[0], 0x400);
    if (!addr) return;
    NewKiriKiriZHook(addr);
};
```
```js
check: () => L.CheckFile('*.xp3') || L.SearchResourceString('TVP(KIRIKIRI)'),
files: ['*.xp3'], // for the page: any of these alone passes the check

// kirikiri::tTJSVariantString (pack 4): RefCount, LongString, ShortString[21 + 1], Length
const ttstrText = (ttstr) => {
    const p = L.u32(ttstr);
    const long = L.u32(p + 4);
    const TJS_VS_SHORT_LEN = 21;
    return { at: long ? long : p + 8, length: L.i32(p + 8 + (TJS_VS_SHORT_LEN + 1) * 2) };
};
text_fun(context, hp, buffer, split) {
    const text = ttstrText(context.stack[9]);
    split.value = context.ecx;
    buffer.from(text.at, text.length * 2);
},
…
let last = null; // static std::wstring last
… filter_fun(buffer) {
    const ws = buffer.strW();
    if (ws === last) return buffer.clear();
    last = ws;
    buffer.fromW(filterkrkrz(ws));
},
…
text_fun(context, hp) {
    hp.text_fun = null;
    hp.type = L.HOOK_EMPTY;
    const a = L.findEnclosingAlignedFunction(context.stack[0], 0x400);
    if (a) NewKiriKiriZHook(a);
},
```

## Checking

```sh
cd scripts/vnbox/engines
node order.mjs                      # after adding or renaming an engine
node engines.check.mjs              # libLuna tests + every engine on an empty fake guest
LUNA=… python3 -I check-port.py . [Name …]   # C++ patterns/numbers/strings carried over
```
`engines.check.mjs` proves a port loads and runs its checks and searches without throwing; it cannot
prove the hook finds text. Only a real game does that (the owner tests those).

## Status

Engines are named by C++ file (`engine32/<Name>.cpp`); a file can hold several engine classes.

### Ported

217 of engine32's 225 files.

| File | Engines | PR |
| --- | --- | --- |
| 5pb | _5pb, _5pb_2 | #299 |
| A98SYS | A98SYS | #291 |
| AB2Try | AB2Try | #291 |
| Abalone | Abalone | #291 |
| Abel | Abel | #299 |
| AbogadoPowers | AbogadoPowers | #291 |
| ACTGS | ACTGS | #296 |
| ADVSystem | ADVSystem | #296 |
| AGE_System | AGE_System | #296 |
| Ages3ResT | Ages3ResT | #296 |
| AGS | AGS | #296 |
| AIL | AIL | #296 |
| akatombo | akatombo | #291 |
| Aksys | Aksys | #296 |
| AksysGames | AksysGames | #296 |
| Alice | Alice | #296 |
| Anex86 | Anex86 | #296 |
| Anim | Anim | #296 |
| AniSeed | AniSeed | #296 |
| Anisetta | Anisetta | #291 |
| ANOS | ANOS | #291 |
| antique | antique | #296 |
| AOS | AOS | #299 |
| ApricoT | ApRicoT, ApRicoTlast, ApRicoTOld | #299 |
| ArcSystemWorks | ArcSystemWorks | #296 |
| Arcturus | Arcturus | #296 |
| Aromarie | Aromarie | #296 |
| Artemis | Artemis | #299 |
| Atelier | Atelier, Atelier2 | #299 |
| AXL | AXL | #296 |
| AZScript | AZScript | #291 |
| AZSystem | AZSystem | #291 |
| Azurite | Azurite | #291 |
| BGI | BGI | #299 |
| Bishop | Bishop, Bishop2 | #296 |
| BKEngine | BKEngine | #296 |
| Bootup | Bootup | #299 |
| Broccoli | Broccoli | #291 |
| Bruns | Bruns | #296 |
| BunBun | BunBun | #296 |
| C4 | C4 | #296 |
| Cage | Cage | #296 |
| Candy | Candy, WillowSoft | #299 |
| CaramelBox | CaramelBox, CaramelBoxMilkAji, CaramelBox2 | #299 |
| CatSystem | CatSystem | #299 |
| Ciel | Ciel | #296 |
| Circus | Circus | #299 |
| CisLugI | CisLugI | #296 |
| CMVS | CMVS | #299 |
| CodeX | CodeX | #299 |
| CoffeeMaker | CoffeeMaker | #296 |
| Cotopha | Cotopha | #299 |
| DAC | DAC | #296 |
| Debonosu | Debonosu | #296 |
| DISCOVERY | DISCOVERY | #296 |
| Diskdream | Diskdream | #296 |
| DxLib | DxLib | #296 |
| e_Erekiteru | e_Erekiteru | #296 |
| Eagls | Eagls | this PR |
| Elf | Elf, ElfFunClubFinal | #299 |
| EME | EME | #296 |
| EntisGLS | EntisGLS | #296 |
| Erogos | Erogos | this PR |
| Escude | Escude | #299 |
| Eushully | Eushully | #299 |
| Exp | Exp | #299 |
| Fizz | Fizz | #296 |
| FocasLens | FocasLens | #296 |
| Footy2 | Footy2 | #296 |
| For | For | #296 |
| FrontWing | FrontWing, FrontWing2 | #296 |
| Furaiki | Furaiki | #296 |
| FVP | FVP | #299 |
| GameMaker | GameMaker | #296 |
| GASTRO | GASTRO | #296 |
| Giga | Giga | #296 |
| GJ | GJ | #296 |
| GLuer | GLuer | #296 |
| GROOVER | GROOVER | #298 |
| GSX | GSX | #298 |
| GXP | GXP | #298 |
| H_do_C | H_do_C | #298 |
| hibiki | hibiki | #298 |
| HorkEye | HorkEye | #298 |
| Hug | Hug | #298 |
| HXP | HXP | #298 |
| InteractiveNovelEngine | InteractiveNovelEngine | #298 |
| Interheart | Interheart | #298 |
| Interlude | Interlude | #298 |
| IronGameSystem | IronGameSystem | this PR |
| ivory | ivory | #298 |
| Jellyfish | Jellyfish | #298 |
| Jisatu101 | Jisatu101 | #298 |
| jukujojidai | jukujojidai | #298 |
| KiriKiri | KiriKiri | #291 |
| KISS | KISS | #298 |
| LCScript | LCScript | #298 |
| Leaf | Leaf | #298 |
| Lightvn | Lightvn | #298 |
| littlecheese | littlecheese | #298 |
| Live | Live | #298 |
| LizardFactory | LizardFactory | #298 |
| LovaGame | LovaGame | #298 |
| LucaSystem | LucaSystem | #298 |
| lucifen | Lucifen | #298 |
| LunaSoft | LunaSoft | #298 |
| Majiro | Majiro | #298 |
| Malie | Malie | #298 |
| MarineHeart | MarineHeart | #298 |
| MBLMED | MBLMED | #298 |
| MBSTRUTH | MBSTRUTH | #298 |
| MerRouge | MerRouge | this PR |
| Milk | Milk | #298 |
| Mink | Mink, Mink2, Mink3 | #298 |
| Minori | Minori | #298 |
| mirage | mirage | #298 |
| MixwillSoft | MixwillSoft | #298 |
| Monochrome | Monochrome | #298 |
| Moonstone | Moonstone | #298 |
| morning | morning | #298 |
| Nekopack | Nekopack | #298 |
| Nekotaro | Nekotaro | #298 |
| NeXAS | NeXAS | #298 |
| Nexton | Nexton, Nexton1 | #298 |
| Nijyuei | Nijyuei | #298 |
| Nitroplus | Nitroplus, Nitroplusplus | #298 |
| Nitroplus2 | Nitroplus2 | #298 |
| NNNConfig | NNNConfig, gazelle | #298 |
| NUGSystem | NUGSystem | #298 |
| Ohgetsu | Ohgetsu | #298 |
| Onscripter | Onscripter | #298 |
| ONScripterru | ONScripterru | #297 |
| OVERDRIVE | OVERDRIVE | #297 |
| Overflow | Overflow | #297 |
| Pal | Pal | #297 |
| Palette | Palette | #297 |
| Pensil | Pensil | #297 |
| PinkQuestion | PinkQuestion | #297 |
| Pinpai | Pinpai | #297 |
| PixelGameMakerMVplayer | PixelGameMakerMVplayer | #297 |
| PONScripter | PONScripter | #297 |
| Purple | Purple, Purple2 | #297 |
| QLIE | QLIE | #297 |
| R11 | R11 | #297 |
| ransel | ransel | #297 |
| Reallive | Reallive, Reallive_old, avg3216d, RealliveX | #297 |
| Regista | Regista | #297 |
| Rejet | Rejet | #297 |
| Retouch | Retouch | #297 |
| RibbonMagic | RibbonMagic | #295 |
| RPGMaker | RPGMaker | #295 |
| RPGMakerRGSS3 | RPGMakerRGSS3, RPGMakerRGSS300 | #300 |
| RpgmXP | RpgmXP | #295 |
| RRE | RRE | #295 |
| RScript | RScript | #295 |
| RUGP | RUGP | #295 |
| RUNE | RUNE | #295 |
| Ryokucha | Ryokucha, Ryokucha2, ScenarioPlayer_last, Ryokuchaold | #300 |
| sakanagl | sakanagl | #295 |
| Sakuradog | Sakuradog | #295 |
| sakusesu | sakusesu | #295 |
| ScrPlayer | ScrPlayer | #295 |
| Seraphim | Seraphim | #295 |
| ShinyDaysGame | ShinyDaysGame | #295 |
| shyakunage | shyakunage | #295 |
| SideB | SideB | #295 |
| Siglus | Siglus | #300 |
| Silkys | Silkys, SilkysOld, Siglusold, Silkyssakura, Silkysveryveryold, Aisystem6 | #300 |
| SmartAdv | SmartAdv | #295 |
| solfasys | solfasys | #295 |
| Speed | Speed | #295 |
| splushwave | splushwave | #295 |
| Sprite | Sprite | #295 |
| SRPGStudio | SRPGStudio | #295 |
| Stronger | Stronger | #295 |
| Suika2 | Suika2 | #295 |
| SYSD | SYSD | #295 |
| System4x | System4x | #300 |
| SystemAoi | SystemAoi | #300 |
| Syuntada | Syuntada | #295 |
| T2U | T2U | #295 |
| TACTICS | TACTICS | #295 |
| TAKUYO | TAKUYO | #295 |
| Tamamo | Tamamo | #300 |
| TamaokaSoft | TamaokaSoft | #295 |
| tamasoft | TamaSoft | #295 |
| Tanuki | Tanuki, Tanuki_last | #295 |
| Tarte | Tarte | #295 |
| Taskforce2 | Taskforce2 | #300 |
| TEANAM | TEANAM | #295 |
| TeethingRing | TeethingRing | #295 |
| Tenco | Tenco | #295 |
| TERIOS | TERIOS | #295 |
| TerraLunar | TerraLunar | #295 |
| TinkerBell | TinkerBell, TinkerBellold | #300 |
| Tomato | Tomato | #295 |
| Triangle | Triangle, Triangle2, TriangleM | #300 |
| Troy | Troy | #295 |
| TSSystem | TSSystem | #295 |
| TYPEMOON | TYPEMOON | #295 |
| Unicorn | Unicorn, Unicorn_Anesen | #300 |
| UnisonShift | UnisonShift, UnisonShift2 | #295 |
| UnknownEngine | UnknownEngine | #295 |
| utawarerumono | utawarerumono | #295 |
| VALKYRIA | VALKYRIA | #295 |
| VanillawareGC | VanillawareGC | #300 |
| VitaminSoft | VitaminSoft | #295 |
| Waffle | Waffle | #300 |
| WillPlus | WillPlusETERNAL, WillPlus, Willold | #301 |
| Winters | Winters | #295 |
| Wolf | Wolf | #301 |
| Xbangbang | Xbangbang | #295 |
| XUSE | XUSE | #300 |
| Yatagarasu | Yatagarasu | #295 |
| YukaSystem2 | YukaSystem2 | #300 |
| Yuris | Yuris | #300 |
| ZeroEscape | ZeroEscape | #295 |

### Parts left out (the rest of the file is ported)

Checker misses for every file are in its PR's table; the ones that matter, where a hook or class does not run:

| File | Left out, and why |
| --- | --- |
| Alice | `SP_TextDraw` hook: needs LunaHook's length disassembler (`::disasm`) |
| CaramelBox | `CaramelBox2`: its only hook comes from `trigger_fun` (returns false) |
| Cotopha | `eslHeapFree` hook (`Cotopha2`): calls the guest's `eslHeapGetLength` |
| Debonosu | izumo4 branch: needs `PcHooks::hookOtherPcFunctions` |
| EME | `egoto` (hooks a LunaHook-internal function) and `takeout` (`trigger_fun`) |
| GXP | `InsertGXP1Hook`: needs `::disasm` |
| Ohgetsu | `_5`: DIRECT_READ |
| Reallive | `veryold()` and the dynamic hook (`trigger_fun`) |
| RPGMakerRGSS3 | RGSS300's `trigger_fun` hook |
| Ryokucha, SystemAoi, Triangle, Waffle | the dynamic `trigger_fun` hook (GDI hooks stay the fallback) |
| Seraphim | `Seraphimattach_function2` (School Captain 2): `trigger_fun` |
| TACTICS | `TACTICS_R`: DIRECT_READ |
| TeethingRing | `TeethingRing_attach_function`: calls a guest virtual function from `text_fun` |
| TinkerBell | the `tkbl2` hook on a native function, `hookOtherPcFunctions(GetStringTypeExW)` |
| UnisonShift | `InsertUnisonShift3Hook`: DIRECT_READ |
| WillPlus | `InsertOldWillPlusHook`/`SpecialHookWillPlus` (WillPlus1): needs `::disasm` (never ran in LunaHook either) |
| Wolf | the GuruGuruSMF4 `trigger_fun` hook (its static `h1` hook is ported) |
| Yatagarasu | never attaches: LunaHook's `attach_function` returns false unconditionally |

Engines with no pattern search (`ATTACH_ANY` in `engines.check.mjs`) hook an exported API, as LunaHook does, so
they attach on any guest that has it: T2U, TamaokaSoft, Reallive (+ Reallive_old, RealliveX), TinkerBellold, Eagls,
Erogos, IronGameSystem, MerRouge. Their file checks decide whether they run.

### Skipped (whole files)

| File | Why |
| --- | --- |
| AdobeAir, AdobeFlash10, cef, godot, V8 | JIT / bytecode bridges (skip rules) |
| PiAS | needs `LoadResCharSet(L"PiAS")`, a character table in LunaHook's resources |
| Sceplay | its only hook comes from a `trigger_fun` on GetGlyphOutlineA |
| ShinaRio | chooses its hooks from RIO.INI's contents; libLuna lists file names only |

Out of scope from the start (not in engine32, or bridges to a JIT, script runtime or emulator): PPSSPPWindows, Unity,
Patisserie, Renpy, lua51 and the other `LunaHook/engines/` entries of LunaHook's order. `order.mjs` keeps their names
so the order stays LunaHook's.
