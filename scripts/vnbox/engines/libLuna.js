// libLuna.js: the runtime of the LunaHook engine ports (scripts/vnbox/engines/*.js) for VNBox's
// frida-compat.js. It maps LunaHook's HookParam, MemDbg/Util byte searches, string filters and
// engine checks onto Interceptor.attach (onEnter only), guest memory reads and trans.send.
// PORTING.md says how each C++ idiom maps onto the calls here.
//
// Ported from LunaTranslator (HIllya51), commit be625f4: LunaHook/texthook.cc (TextHook::Send),
// LunaHook/util/util.cc, LunaHook/util/memdbg/memsearch.cc, LunaHook/util/stringfilters.cpp,
// LunaHook/enginecontrol.cpp, LunaHook/engines/pchooks/pchooks.cpp, include/types.h.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
//
// Not ported (we only read text): embedding/translation injection (embed_fun, EMBED_* flags,
// embed_hook_font), hook_after/HOOK_RETURN (no onLeave), DIRECT_READ codes, JIT engines, memory writes.
'use strict';

// ---- HookParam type flags (include/types.h, same bits) ----------------------------------------
const T = {};
['CODEC_ANSI_BE', 'CODEC_UTF8', 'CODEC_UTF16', 'CODEC_UTF32', 'USING_CHAR', 'USING_STRING', 'CSHARP_STRING',
    'FULL_STRING', 'DATA_INDIRECT', 'USING_SPLIT', 'SPLIT_INDIRECT', 'FIXING_SPLIT', 'NO_CONTEXT', 'MODULE_OFFSET',
    'FUNCTION_OFFSET', 'KNOWN_UNSTABLE', 'EMBED_ABLE', 'EMBED_DYNA_SJIS', 'EMBED_AFTER_NEW', 'EMBED_AFTER_OVERWRITE',
    'EMBED_INSERT_SPACE_ALWAYS', 'EMBED_INSERT_SPACE_AFTER_UNENCODABLE', 'INLINE_HOOK', 'BREAK_POINT', 'DIRECT_READ',
    'HOOK_RETURN', 'HOOK_EMPTY'].forEach((name, i) => { T[name] = 2 ** i; });
T.CODEC_ANSI_LE = 0;
const XX = 0x11; // WildcardByte: a pattern byte 0x11 matches any byte (as in LunaHook's searches)
const XX2 = [XX, XX], XX4 = [XX, XX, XX, XX], XX8 = [...XX4, ...XX4]; // spread them: [0x8b, ...XX4]
const FIXED_SPLIT_VALUE = 0x10001;
const TEXT_BUFFER_SIZE = 50000 - 64;
const MaximumFunctionSize = 0x800, MemoryPaddingOffset = 0x1000;
const PAGE_EXECUTE = 0x10, PAGE_EXECUTE_READ = 0x20, PAGE_EXECUTE_READWRITE = 0x40, PAGE_READONLY = 0x02;
const CP_UTF8 = 65001, CP_ACP = 0;

// hook_context layout (32-bit): offsets from `base` (the stack at the hook, [base] = return address).
const REG_OFFSET = { edi: -0x24, esi: -0x20, ebp: -0x1c, esp: -0x18, ebx: -0x14, edx: -0x10, ecx: -0x0c, eax: -0x08 };
const OFFSET_REG = Object.fromEntries(Object.entries(REG_OFFSET).map(([r, o]) => [o, r]));
const regoffset = (reg) => { if (!(reg in REG_OFFSET)) throw new Error('regoffset: ' + reg); return REG_OFFSET[reg]; };
const stackoffset = (i) => 4 * i;
const GETARG = stackoffset;

const u32 = (v) => v >>> 0;
const hex = (v) => '0x' + u32(v).toString(16);

// ---- guest memory -------------------------------------------------------------------------------
// The exe image is read once (bulk) and searched in JS: LunaHook's searches touch every byte.
const images = new Map(); // module base → { base, end, bytes }
function main() { return Process.enumerateModules()[0]; }
function readLive(addr, n) {
    return new Uint8Array(Memory.readByteArray(ptr(u32(addr)), n));
}
function moduleOf(addr) {
    const m = Process.findModuleByAddress(ptr(u32(addr)));
    return m ? { base: m.base.toUInt32(), size: m.size, name: m.name } : null;
}
function image(m) {
    let img = images.get(m.base);
    if (img) return img;
    const bytes = new Uint8Array(m.size);
    for (let at = 0; at < m.size; at += 0x10000) { // unreadable pages stay zero
        const n = Math.min(0x10000, m.size - at);
        try { bytes.set(readLive(m.base + at, n), at); } catch (e) { /* page not readable */ }
    }
    img = { base: m.base, end: m.base + m.size, bytes };
    images.set(m.base, img);
    return img;
}
// n bytes at addr, read now (data changes; only the searches below use the image snapshot).
const rd = (addr, n) => readLive(u32(addr), n);
const dv = (addr, n) => { const b = rd(addr, n); return new DataView(b.buffer, b.byteOffset, n); };
const u8 = (a) => rd(a, 1)[0];
const i8 = (a) => dv(a, 1).getInt8(0);
const u16 = (a) => dv(a, 2).getUint16(0, true);
const i16 = (a) => dv(a, 2).getInt16(0, true);
const rdU32 = (a) => dv(a, 4).getUint32(0, true);
const i32 = (a) => dv(a, 4).getInt32(0, true);
// Live reads for data that changes (text, game objects): never from the image snapshot.
const live = {
    u8: (a) => readLive(a, 1)[0],
    u16: (a) => new DataView(readLive(a, 2).buffer).getUint16(0, true),
    u32: (a) => new DataView(readLive(a, 4).buffer).getUint32(0, true),
    i32: (a) => new DataView(readLive(a, 4).buffer).getInt32(0, true),
    bytes: readLive,
};
function readable(addr, n = 4) { // IsBadReadPtr / Engine::isAddressReadable
    if (!u32(addr)) return false;
    try { readLive(addr, n); return true; } catch (e) { return false; }
}
// A search range [lo, hi) as { base, bytes }: the module image when inside one, else read now.
function region(lo, hi) {
    lo = u32(lo); hi = u32(hi);
    const m = moduleOf(lo);
    // hi <= lo: LunaHook's unsigned size wraps and the search runs on until memory ends (some engines
    // rely on it): here, to the end of lo's module.
    if (hi <= lo) {
        if (!m) return { base: lo, bytes: new Uint8Array(0) };
        hi = m.base + m.size;
    }
    if (m) {
        const img = image(m);
        const end = Math.min(hi, img.end);
        return { base: lo, bytes: img.bytes.subarray(lo - img.base, end - img.base) };
    }
    const bytes = new Uint8Array(hi - lo);
    for (let at = 0; at < bytes.length; at += 0x10000) {
        try { bytes.set(readLive(lo + at, Math.min(0x10000, bytes.length - at)), at); } catch (e) { /* unreadable */ }
    }
    return { base: lo, bytes };
}
// Reads a C string at addr: unit 1 (char) or 2 (wchar_t). Returns the bytes without the terminator.
function cstr(addr, unit = 1, max = TEXT_BUFFER_SIZE) {
    addr = u32(addr);
    if (!addr) return new Uint8Array(0);
    const out = [];
    for (let total = 0; total < max;) {
        const want = Math.min(256, max - total);
        let chunk;
        try { chunk = readLive(addr + total, want); } catch (e) {
            chunk = new Uint8Array(0);
            for (let k = 0; k < want; k += unit) { try { const c = readLive(addr + total + k, unit); chunk = concat([chunk, c]); } catch (_) { break; } }
        }
        let end = 0;
        while (end + unit <= chunk.length && !(chunk[end] === 0 && (unit === 1 || chunk[end + 1] === 0))) end += unit;
        out.push(chunk.subarray(0, end));
        total += end;
        if (end < chunk.length || chunk.length < want) break;
    }
    return concat(out);
}
function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

// ---- codecs: byte strings (one char per byte, like std::string) and wide strings (std::wstring) ---
const decoders = {};
const CODEPAGES = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1252: 'windows-1252', 65001: 'utf-8', 0: 'shift_jis' };
function decoder(cp) {
    const name = CODEPAGES[cp] || 'shift_jis';
    return decoders[name] || (decoders[name] = new TextDecoder(name));
}
const bytesToA = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
const aToBytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const bytesToW = (b) => { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8)); return s; };
const wToBytes = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) & 0xff; b[2 * i + 1] = s.charCodeAt(i) >> 8; } return b; };
// StringToWideString(byteString, cp): bytes → text
function StringToWideString(a, cp = 932) { return decoder(cp).decode(typeof a === 'string' ? aToBytes(a) : a); }
// WideStringToString(text, cp) → byte string. cp932/936/949/950 tables are built once from TextDecoder.
const encoders = {};
function WideStringToString(w, cp = 932) {
    if (cp === CP_UTF8) return bytesToA(new TextEncoder().encode(w));
    let table = encoders[cp];
    if (!table) {
        table = encoders[cp] = new Map();
        const dec = decoder(cp);
        for (let b = 0; b < 0x80; b++) table.set(String.fromCharCode(b), String.fromCharCode(b));
        for (let b = 0xa1; b <= 0xdf && cp === 932; b++) table.set(dec.decode(Uint8Array.of(b)), String.fromCharCode(b));
        for (let l = 0x81; l <= 0xfe; l++) for (let t = 0x40; t <= 0xfe; t++) {
            const c = dec.decode(Uint8Array.of(l, t));
            if (c.length === 1 && c !== '�' && !table.has(c)) table.set(c, String.fromCharCode(l, t));
        }
    }
    let out = '';
    for (const c of w) out += table.has(c) ? table.get(c) : '?';
    return out;
}
const wcasta = (w) => WideStringToString(w, 1252);
const acastw = (a) => a;
function IsDBCSLeadByteEx(cp, b) {
    b &= 0xff;
    if (cp === 932 || cp === 0) return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
    if (cp === 936 || cp === 949 || cp === 950) return b >= 0x81 && b <= 0xfe;
    return false;
}
const IsDBCSLeadByte = (b) => IsDBCSLeadByteEx(932, b);
function IsShiftjisWord(w) {
    const l = w & 0xff, h = (w >> 8) & 0xff;
    if (!((l <= 0x9f && l >= 0x81) || (l <= 0xef && l >= 0xe0))) return false;
    return (h >= 0x40 && h <= 0x7e) || (h >= 0x80 && h <= 0xfc);
}
const IsShiftjisLeadByte = (l) => (l <= 0x9f && l >= 0x81) || (l <= 0xfc && l >= 0xe0);
function utf8charlen(b0) {
    b0 &= 0xff;
    return b0 < 0x80 ? 1 : (b0 & 0xe0) === 0xc0 ? 2 : (b0 & 0xf0) === 0xe0 ? 3 : (b0 & 0xf8) === 0xf0 ? 4 : 1;
}
const all_ascii = (s) => { for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false; return true; };
const strReplace = (s, from, to = '') => (from ? s.split(from).join(to) : s);
const startWith = (s, p) => s.startsWith(p);
const endWith = (s, p) => s.endsWith(p);
function strSplit(s, sep) { return s.split(sep); }
// re::sub / re::match / re::search (std::regex, ECMAScript grammar: as JS RegExp)
const re = {
    sub: (s, pattern, as = '') => s.replace(new RegExp(pattern, 'g'), as),
    match: (s, pattern) => { const m = s.match(new RegExp('^(?:' + pattern + ')$')); return m || null; },
    search: (s, pattern) => s.match(new RegExp(pattern)) || null,
    split: (s, pattern) => s.split(new RegExp(pattern)),
};
const katakanaMap = new Map([...'｢｣ｧｨｩｪｫｬｭｮｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｰｯ､?｡!○･ﾟﾞ'].map((c, i) =>
    [c, [...'「」ぁぃぅぇぉゃゅょあいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんーっ、？。！〇…？！'][i]]));
const remapkatakana = (w) => [...w].map((c) => katakanaMap.get(c) || c).join('');

// ---- TextBuffer (include/types.h): raw bytes, as LunaHook's ------------------------------------
class TextBuffer {
    constructor() { this.data = new Uint8Array(0); }
    get size() { return this.data.length; }
    set size(n) { this.data = this.data.subarray(0, Math.max(0, Math.min(n, this.data.length))); }
    clear() { this.data = new Uint8Array(0); }
    // from(addr, sizeInBytes): bytes at a guest address. from(byteString) / fromW(text) for std::string / std::wstring.
    from(a, n) {
        if (typeof a === 'string') return this.fromA(a);
        if (n === undefined) throw new Error('TextBuffer.from(address) needs a size: use fromCharPtr / fromWCharPtr for C strings');
        n = Math.min(TEXT_BUFFER_SIZE, n);
        this.data = n > 0 && u32(a) ? readLive(a, n).slice() : new Uint8Array(0);
    }
    fromA(s) { this.data = aToBytes(s.slice(0, TEXT_BUFFER_SIZE)); }
    fromW(w) { this.data = wToBytes(w.slice(0, TEXT_BUFFER_SIZE / 2)); }
    fromCharPtr(addr) { this.data = cstr(addr, 1).slice(); } // from(const char *)
    fromWCharPtr(addr) { this.data = cstr(addr, 2).slice(); } // from(const wchar_t *)
    fromBytes(b) { this.data = Uint8Array.from(b); }
    from_t(v, size = 4) { const b = new Uint8Array(size); for (let i = 0; i < size; i++) b[i] = (v >>> (8 * i)) & 0xff; this.data = b; }
    fromWA(w, cp = 932) { this.fromA(WideStringToString(w, cp)); }
    strA() { return bytesToA(this.data); }
    viewA() { return this.strA(); }
    strW() { return bytesToW(this.data); }
    viewW() { return this.strW(); }
    strAW(cp = 932) { return StringToWideString(this.data, cp); }
    strU() { const d = new DataView(this.data.buffer, this.data.byteOffset, this.data.length); let s = ''; for (let i = 0; i + 3 < this.data.length; i += 4) s += String.fromCodePoint(d.getUint32(i, true)); return s; }
}

// ---- string filters (util/stringfilters.cpp). A: byte strings ("..."), W: text (L"...") -----------
const A = (buffer, fn) => buffer.fromA(fn(buffer.strA()));
const W = (buffer, fn) => buffer.fromW(fn(buffer.strW()));
const between = (s, fr, to) => {
    for (let at = s.indexOf(fr); at >= 0; at = s.indexOf(fr, at)) {
        const end = s.indexOf(to, at + fr.length);
        if (end < 0) break;
        s = s.slice(0, at) + s.slice(end + to.length);
    }
    return s;
};
const filters = {
    CharReplacerA: (b, fr, to) => A(b, (s) => strReplace(s, fr, to)),
    CharReplacerW: (b, fr, to) => W(b, (s) => strReplace(s, fr, to)),
    CharFilterA: (b, ch) => A(b, (s) => strReplace(s, ch)),
    CharFilterW: (b, ch) => W(b, (s) => strReplace(s, ch)),
    CharsFilterA: (b, chars) => A(b, (s) => [...s].filter((c) => !chars.includes(c)).join('')),
    CharsFilterW: (b, chars) => W(b, (s) => [...s].filter((c) => !chars.includes(c)).join('')),
    StringFilterA: (b, remove) => A(b, (s) => strReplace(s, remove)),
    StringFilterW: (b, remove) => W(b, (s) => strReplace(s, remove)),
    StringFilterBetweenA: (b, fr, to) => A(b, (s) => between(s, fr, to)),
    StringFilterBetweenW: (b, fr, to) => W(b, (s) => between(s, fr, to)),
    StringCharReplacerA: (b, src, ch) => A(b, (s) => strReplace(s, src, ch)),
    StringCharReplacerW: (b, src, ch) => W(b, (s) => strReplace(s, src, ch)),
    StringReplacerA: (b, src, dst) => A(b, (s) => strReplace(s, src, dst)),
    StringReplacerW: (b, src, dst) => W(b, (s) => strReplace(s, src, dst)),
    NewLineCharFilterA: (b) => A(b, (s) => strReplace(s, '\n')),
    NewLineCharFilterW: (b) => W(b, (s) => strReplace(s, '\n')),
    NewLineCharToSpaceA: (b) => A(b, (s) => strReplace(s, '\n', ' ')),
    NewLineCharToSpaceW: (b) => W(b, (s) => strReplace(s, '\n', ' ')),
    all_ascii_Filter: (b) => { if (all_ascii(b.strA())) b.clear(); },
    all_ascii_FilterW: (b) => { if (all_ascii(b.strW())) b.clear(); },
    Utf8TypeChecker: (b, hp) => {
        let ok = true;
        try { new TextDecoder('utf-8', { fatal: true }).decode(b.data); } catch (e) { ok = false; }
        hp.type = ok ? hp.type | T.CODEC_UTF8 : hp.type & ~T.CODEC_UTF8;
    },
};

// ---- PE helpers ----------------------------------------------------------------------------------
function GetModuleHandle(name) { // null: the exe. Returns the base (number) or 0.
    if (name === null || name === undefined) return main().base.toUInt32();
    const m = Process.findModuleByName(name) || Process.findModuleByName(name + '.dll');
    return m ? m.base.toUInt32() : 0;
}
const GetModuleHandleW = GetModuleHandle, GetModuleHandleA = GetModuleHandle;
function moduleByBase(base) { return Process.enumerateModules().find((m) => m.base.toUInt32() === u32(base)) || null; }
function GetProcAddress(hmodule, name) {
    const m = typeof hmodule === 'string' ? Process.findModuleByName(hmodule) : moduleByBase(hmodule);
    const p = m ? m.findExportByName(name) : null;
    return p ? p.toUInt32() : 0;
}
// Util::FindFunction / the address of a Windows API (`(DWORD)::TextOutA` in the C++).
function FindFunction(name) { const p = Module.findExportByName(null, name); return p ? p.toUInt32() : 0; }
function peHeader(base) { return base + rdU32(base + 0x3c); }
function sections(base) {
    const pe = peHeader(base), count = u16(pe + 6), optSize = u16(pe + 0x14), out = [];
    for (let i = 0, s = pe + 0x18 + optSize; i < count; i++, s += 0x28) {
        out.push({ name: bytesToA(rd(s, 8)).replace(/\0.*$/, ''), va: base + rdU32(s + 0x0c), size: rdU32(s + 8), flags: rdU32(s + 0x24) });
    }
    return out;
}
function dataDirectory(base, index) {
    const pe = peHeader(base);
    return { va: rdU32(pe + 0x78 + 8 * index), size: rdU32(pe + 0x7c + 8 * index) };
}
// Util::GetCodeRange: the first code section, size rounded as LunaHook does. Returns [low, high].
function GetCodeRange(hmodule) {
    const s = sections(u32(hmodule)).find((x) => x.flags & 0x20);
    if (!s) return [0, 0];
    return [s.va, s.va + (s.size & 0xfffff000) + 0x1000];
}
// Util::QueryModuleLimits(module, addition = 0x1000, protect = PAGE_EXECUTE) → [start, stop].
// shortcut: no VirtualQuery, so the run of executable sections stands in for the run of executable
// pages (protect >= PAGE_EXECUTE), and anything below that (readable) for the whole image.
function QueryModuleLimits(hmodule, addition = 0x1000, protect = PAGE_EXECUTE) {
    const base = u32(hmodule), m = moduleByBase(base);
    const start = base + addition;
    if (!m) return [start, start];
    if (protect < PAGE_EXECUTE) return [start, base + m.size];
    let stop = start;
    for (const s of sections(base)) {
        if (s.va + Math.max(s.size, 1) <= start) continue;
        if (!(s.flags & 0x20000000)) break; // IMAGE_SCN_MEM_EXECUTE
        stop = s.va + ((s.size + 0xfff) & ~0xfff);
    }
    return [start, stop];
}
// Util::FindImportEntry: the IAT slot holding fun.
function FindImportEntry(hmodule, fun) {
    const base = u32(hmodule), iat = dataDirectory(base, 12);
    if (!iat.va) return 0;
    for (let p = base + iat.va; p < base + iat.va + iat.size; p += 4) if (rdU32(p) === u32(fun)) return p;
    return 0;
}
// Util::SearchResourceString: the UTF-16 text in the exe's resource section.
function SearchResourceString(str, hmodule) {
    const base = hmodule ? u32(hmodule) : GetModuleHandle(null);
    const dir = dataDirectory(base, 2);
    if (!dir.va) return false;
    const rsrc = base + dir.va;
    const sec = sections(base).find((s) => rsrc >= s.va && rsrc < s.va + Math.max(s.size, 1));
    const end = sec ? sec.va + sec.size : rsrc + dir.size;
    return findBytes(wToBytes(str), rsrc, end, false) !== 0;
}
// Util::SearchStringFileInfo. shortcut: searches the whole resource section, not only the
// VS_VERSIONINFO strings; a version string elsewhere in the resources matches too.
const SearchStringFileInfo = SearchResourceString;

// ---- byte searches (util.cc, memsearch.cc) -----------------------------------------------------
// A pattern: a string "55 8b ec ?? 4?" (?? any byte, nibble wildcards allowed) or an array of bytes
// (0x11 = XX matches any byte, as in LunaHook's arrays). Returns { bytes, masks }.
function pattern(p) {
    if (p && p.bytes && p.masks) return p;
    if (typeof p === 'string') {
        const toks = p.trim().split(/\s+/).filter(Boolean);
        const bytes = new Uint8Array(toks.length), masks = new Uint8Array(toks.length);
        toks.forEach((t, i) => {
            if (!/^[0-9a-fA-F?]{2}$/.test(t)) throw new Error('pattern: bad byte ' + JSON.stringify(t) + ' in ' + JSON.stringify(p));
            let b = 0, m = 0;
            for (const c of t) { b <<= 4; m <<= 4; if (c !== '?') { b |= parseInt(c, 16); m |= 0xf; } }
            bytes[i] = b & m; masks[i] = m;
        });
        return { bytes, masks };
    }
    const arr = Array.from(p);
    return { bytes: Uint8Array.from(arr, (b) => (b === XX ? 0 : b)), masks: Uint8Array.from(arr, (b) => (b === XX ? 0 : 0xff)) };
}
// Offsets of matches of pat in buf from `from`, ascending; stops after `limit`.
function matchAll(buf, pat, from = 0, limit = Infinity, step = 1) {
    const { bytes, masks } = pat, n = bytes.length, out = [];
    let first = masks.findIndex((m) => m === 0xff);
    for (let i = from; i + n <= buf.length && out.length < limit;) {
        if (first >= 0) {
            const j = buf.indexOf(bytes[first], i + first);
            if (j < 0) break;
            i = j - first;
            if (i + n > buf.length) break;
        }
        let k = 0;
        while (k < n && (buf[i + k] & masks[k]) === bytes[k]) k++;
        if (k === n) { out.push(i); i += step; } else i++;
    }
    return out;
}
// MatchPattern(addr, pattern): the bytes at addr match (XX any byte); false when unreadable.
function MatchPattern(addr, p) {
    const pat = pattern(p);
    let b;
    try { b = readLive(u32(addr), pat.bytes.length); } catch (e) { return false; }
    return pat.bytes.every((x, i) => (b[i] & pat.masks[i]) === x);
}
// MemDbg::findBytes(pattern, lo, hi) → address or 0.
function findBytes(p, lo, hi, _unused) {
    const r = region(lo, hi), m = matchAll(r.bytes, pattern(p), 0, 1);
    return m.length ? r.base + m[0] : 0;
}
// MemDbg::findBytesAll (non-overlapping, as LunaHook steps past each match).
function findBytesAll(p, lo, hi) {
    const r = region(lo, hi), pat = pattern(p);
    return matchAll(r.bytes, pat, 0, Infinity, pat.bytes.length).map((o) => r.base + o);
}
// MemDbg::iterFindBytes(fun, pattern, lo, hi): fun(addr) → false stops.
function iterFindBytes(fun, p, lo, hi) {
    for (const a of findBytesAll(p, lo, hi)) if (!fun(a)) return false;
    return true;
}
const iterMatchBytes = iterFindBytes;
// reverseFindBytes(pattern, start, end, offset = 0, checkalign = false): the last match.
function reverseFindBytes(p, start, end, offset = 0, checkalign = false) {
    const r = region(start, end), pat = pattern(p), n = pat.bytes.length;
    for (let i = r.bytes.length - n; i >= 0; i--) {
        let k = 0;
        while (k < n && (r.bytes[i + k] & pat.masks[k]) === pat.bytes[k]) k++;
        if (k === n) {
            const ret = r.base + i + offset;
            if (checkalign && (ret & 0xf)) continue;
            return ret;
        }
    }
    return 0;
}
// find_pattern("55 8b ?? 4?", start, end): nibble wildcards; "/" starts a comment to the line end.
function find_pattern(text, start, end) {
    const clean = text.split('\n').map((l) => l.replace(/\/.*$/, '')).join('').replace(/\s+/g, '');
    if (!/^[0-9a-fA-F?]*$/.test(clean) || clean.length % 2) return 0;
    return findBytes(clean.match(/../g).join(' '), start, end);
}
// Util::SearchMemory(pattern, protect, minAddr, maxAddr) → every match.
// shortcut: no VirtualQuery here, so it searches the loaded modules' images only (the exe and DLLs),
// not JIT or heap code; engines that find code generated at run time (.NET, Flash) miss it.
function SearchMemory(p, protect = PAGE_EXECUTE, minAddr = 0, maxAddr = 0xffffffff) {
    const pat = pattern(p), out = [];
    for (const m of Process.enumerateModules()) {
        const base = m.base.toUInt32(), end = base + m.size;
        if (end <= minAddr || base >= maxAddr) continue;
        const lo = Math.max(base, minAddr), hi = Math.min(end, maxAddr);
        const r = region(lo, hi);
        for (const o of matchAll(r.bytes, pat, 0, Infinity)) out.push(r.base + o);
    }
    return out;
}
function SigMask(sig) {
    let count = 0;
    for (let s = u32(sig); s; s >>>= 8) ++count;
    return count >= 4 ? 0xffffffff : u32(0xffffffff >>> ((4 - count) << 3));
}
// __findEnclosingAlignedFunction: walk back in 16-byte steps to a function start after int3/nop/ret.
function findEnclosingAlignedFunction(start, back = MaximumFunctionSize) {
    try {
        start = u32(start) & ~0xf;
        for (let i = start, j = start - back; i > j; i -= 0x10) {
            let k = rdU32(i - 4);
            if (k === 0xcccccccc || k === 0x90909090 || k === 0xccccccc3 || k === 0x909090c3) return u32(i);
            let t = u32(k & 0xff0000ff);
            if (t === 0xcc0000c2 || t === 0x900000c2) return u32(i);
            k >>>= 8;
            if (k === 0xccccc3 || k === 0x9090c3) return u32(i);
            if ((k & 0xff) === 0xc2) return u32(i);
            k >>>= 8;
            if (k === 0xccc3 || k === 0x90c3) return u32(i);
            k >>>= 8;
            if (k === 0xc3) return u32(i);
        }
    } catch (e) { /* unreadable: 0, as LunaHook's SEH */ }
    return 0;
}
function findEnclosingAlignedFunction_strict(start, back = MaximumFunctionSize) {
    try {
        start = u32(start) & ~0xf;
        for (let i = start, j = start - back; i > j; i -= 0x10) {
            const k = rdU32(i - 4);
            if (k === 0xcccccccc || k === 0x90909090 || k === 0xccccccc3 || k === 0x909090c3) return u32(i);
        }
    } catch (e) { /* unreadable */ }
    return 0;
}
function findEnclosingFunctionAfterDword(sig, start, back = MaximumFunctionSize, step = 0x10) {
    start = u32(start) & ~0xf;
    try {
        for (let i = start, j = start - back; i > j; i -= step) if (rdU32(i - 4) === u32(sig)) return u32(i);
    } catch (e) { /* unreadable */ }
    return 0;
}
const findEnclosingFunctionBeforeDword = (sig, start, back, step) => { const a = findEnclosingFunctionAfterDword(sig, start, back, step); return a ? a - 4 : 0; };
const findEnclosingFunctionAfterInt3 = (start, back, step) => findEnclosingFunctionAfterDword(0xcccccccc, start, back, step);
const findEnclosingFunctionAfterNop = (start, back, step) => findEnclosingFunctionAfterDword(0x90909090, start, back, step);
// findfuncstart(addr, range = 0x100, checkalign = false): back to `push ebp; mov ebp, esp`.
function findfuncstart(start, range = 0x100, checkalign = false) {
    if (!start) return 0;
    if (checkalign) {
        start = u32(start) & ~0xf;
        try {
            for (let i = start, j = start - range; i >= j; i -= 0x10) {
                const b = rd(i, 3);
                if (b[0] === 0x55 && b[1] === 0x8b && b[2] === 0xec) return u32(i);
            }
        } catch (e) { /* unreadable */ }
        return 0;
    }
    return reverseFindBytes([0x55, 0x8b, 0xec], u32(start) - range, u32(start));
}
// `call/jmp rel32` sites in [lo, hi) whose target is funcAddr (findByteCall).
function byteCalls(op, funcAddr, lo, offset, range) {
    const r = region(lo + offset, lo + offset + range), out = [], b = r.bytes;
    const d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let i = b.indexOf(op); i >= 0 && i + 5 <= b.length; i = b.indexOf(op, i + 1)) {
        if (u32(d.getUint32(i + 1, true) + r.base + i + 5) === u32(funcAddr)) out.push(r.base + i);
    }
    return out;
}
// `ff 15/25 [abs]` sites in [lo, hi) whose slot (inside [lo, hi)) holds funcAddr (findWordCall).
function wordCalls(op, funcAddr, lo, hi, offset, range) {
    const r = region(lo + offset, lo + offset + range), out = [], b = r.bytes;
    const d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let i = b.indexOf(0xff); i >= 0 && i + 6 <= b.length; i = b.indexOf(0xff, i + 1)) {
        if (b[i + 1] !== op) continue;
        const t = d.getUint32(i + 2, true);
        if (t > lo && t < hi) { try { if (rdU32(t) === u32(funcAddr)) out.push(r.base + i); } catch (e) { /* unreadable slot */ } }
    }
    return out;
}
const rangeOf = (lo, hi, offset, range) => (range ? range : u32(hi) - u32(lo) - offset);
const findNearCallAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => byteCalls(0xe8, f, u32(lo), offset, rangeOf(lo, hi, offset, range))[0] || 0;
const findShortJumpAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => byteCalls(0xe9, f, u32(lo), offset, rangeOf(lo, hi, offset, range))[0] || 0;
const findFarCallAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => wordCalls(0x15, f, u32(lo), u32(hi), offset, rangeOf(lo, hi, offset, range))[0] || 0;
const findLongJumpAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => wordCalls(0x25, f, u32(lo), u32(hi), offset, rangeOf(lo, hi, offset, range))[0] || 0;
const last = (a) => (a.length ? a[a.length - 1] : 0);
const findLastNearCallAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => last(byteCalls(0xe8, f, u32(lo), offset, rangeOf(lo, hi, offset, range)));
const findLastShortJumpAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => last(byteCalls(0xe9, f, u32(lo), offset, rangeOf(lo, hi, offset, range)));
const findLastFarCallAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => last(wordCalls(0x15, f, u32(lo), u32(hi), offset, rangeOf(lo, hi, offset, range)));
const findLastLongJumpAddress = (f, lo, hi, offset = MemoryPaddingOffset, range = 0) => last(wordCalls(0x25, f, u32(lo), u32(hi), offset, rangeOf(lo, hi, offset, range)));
const findCallAddress = findFarCallAddress, findLastCallAddress = findLastFarCallAddress, findJumpAddress = findLongJumpAddress;
const iterList = (list, fun) => { for (const a of list) if (!fun(a)) return false; return true; };
const iterNearCallAddress = (fun, f, lo, hi, offset = MemoryPaddingOffset, range = 0) => iterList(byteCalls(0xe8, f, u32(lo), offset, rangeOf(lo, hi, offset, range)), fun);
const iterShortJumpAddress = (fun, f, lo, hi, offset = MemoryPaddingOffset, range = 0) => iterList(byteCalls(0xe9, f, u32(lo), offset, rangeOf(lo, hi, offset, range)), fun);
const iterFarCallAddress = (fun, f, lo, hi, offset = MemoryPaddingOffset, range = 0) => iterList(wordCalls(0x15, f, u32(lo), u32(hi), offset, rangeOf(lo, hi, offset, range)), fun);
const iterLongJumpAddress = (fun, f, lo, hi, offset = MemoryPaddingOffset, range = 0) => iterList(wordCalls(0x25, f, u32(lo), u32(hi), offset, rangeOf(lo, hi, offset, range)), fun);
function iterAlignedNearCallerAddress(fun, f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    let prev = 0;
    return iterNearCallAddress((a) => {
        a = findEnclosingAlignedFunction(a, size);
        if (a && a !== prev) { prev = a; return fun(a); }
        return true;
    }, f, lo, hi, offset);
}
// iterCallerAddress: for each `call [slot]` with *slot == funcAddr, the nearest dword back (within
// reverseLength) matching sig under SigMask(sig): callback(funcStart, callSite), false stops.
// LunaHook's loop skips 6 bytes past a call whose slot lies outside [lo, hi); kept.
function callerSites(funcAddr, sigs, lo, hi, reverseLength, offset, ops = [0x15]) {
    lo = u32(lo); hi = u32(hi);
    const r = region(lo, hi), b = r.bytes, d = new DataView(b.buffer, b.byteOffset, b.length);
    const size = hi - lo - 4, out = [];
    const masks = sigs.map(SigMask);
    for (let i = offset; i < size && i + 6 <= b.length; i++) {
        if (!(b[i] === 0xff && b[i + 1] === 0x15) && !(ops.includes(0x3d) && b[i] === 0x8b && b[i + 1] === 0x3d)) continue;
        const t = d.getUint32(i + 2, true);
        if (t >= lo && t <= hi - 4) {
            let v;
            try { v = rdU32(t); } catch (e) { continue; }
            if (v !== u32(funcAddr)) continue;
            for (let j = i; j > i - reverseLength && j >= 0; j--) {
                if (j + 4 > b.length) continue;
                const inst = d.getUint32(j, true);
                const k = sigs.findIndex((sig, n) => u32(inst & masks[n]) === u32(sig));
                if (k >= 0) { out.push([lo + j, lo + i]); break; }
            }
        } else i += 6;
    }
    return out;
}
const skipInt3 = (a) => { while (u8(++a) === 0xcc); return a; };
function iterCallerAddress(fun, funcAddr, sig, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    for (const [a, c] of callerSites(funcAddr, [sig], lo, hi, size, offset)) if (!fun(a, c)) return false;
    return true;
}
const iterCallerAddressAfterInt3 = (fun, f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) =>
    iterCallerAddress((a, c) => fun(skipInt3(a), c), f, 0xcccc, lo, hi, size, offset);
function iterUniqueCallerAddress(fun, f, sig, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    let prev = 0;
    return iterCallerAddress((a) => { if (a === prev) return true; prev = a; return fun(a); }, f, sig, lo, hi, size, offset);
}
const iterUniqueCallerAddressAfterInt3 = (fun, f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) =>
    iterUniqueCallerAddress((a) => fun(skipInt3(a)), f, 0xcccc, lo, hi, size, offset);
const findCallerAddress = (f, sig, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) => (callerSites(f, [sig], lo, hi, size, offset)[0] || [0])[0];
const findLastCallerAddress = (f, sig, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) => (last(callerSites(f, [sig], lo, hi, size, offset)) || [0])[0];
function findCallerAddressAfterInt3(f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    const a = findCallerAddress(f, 0xcccc, lo, hi, size, offset);
    return a ? skipInt3(a) : 0;
}
function findLastCallerAddressAfterInt3(f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    const a = findLastCallerAddress(f, 0xcccc, lo, hi, size, offset);
    return a ? skipInt3(a) : 0;
}
// findMultiCallerAddress: also `mov edi, [slot]` (8b 3d) calls, and any of several sigs.
const findMultiCallerAddress = (f, sigs, count, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) =>
    (callerSites(f, sigs.slice(0, count), lo, hi, size, offset, [0x15, 0x3d])[0] || [0])[0];
function findAlignedNearCallerAddress(f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    const a = findNearCallAddress(f, lo, hi, offset);
    return a ? findEnclosingAlignedFunction(a, size) : 0;
}
function findLastAlignedNearCallerAddress(f, lo, hi, size = MaximumFunctionSize, offset = MemoryPaddingOffset) {
    const a = findLastCallerAddressAfterInt3(f, lo, hi, size, offset);
    return a ? findEnclosingAlignedFunction(a, size) : 0;
}
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const findPushDwordAddress = (value, lo, hi) => findBytes([0x68, ...le32(u32(value))], lo, hi);
const findPushAddress = findPushDwordAddress;
const findPushByteAddress = (value, lo, hi) => findBytes([0x6a, value & 0xff], lo, hi);
const find_leaorpush_addr = findPushAddress;
function find_leaorpush_addr_all(addr, start, end) {
    const out = [];
    for (let a; (a = find_leaorpush_addr(addr, start, end)); start = a + 1) out.push(a);
    return out;
}
// Util::FindCallOrJmpRel(fun, size, pt, jmp) / FindCallOrJmpAbs / FindCallBoth / FindCallAndEntry*.
function FindCallOrJmpRel(fun, size, pt, jmp) {
    const sig = jmp ? 0xe9 : 0xe8, r = region(pt, pt + size), b = r.bytes, d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let i = 0x1000; i < size - 4 && i + 5 <= b.length; i++) {
        if (b[i] !== sig) continue;
        if (u32(d.getUint32(i + 1, true) + pt + i + 5) === u32(fun)) return u32(pt + i);
        i += 5;
    }
    return 0;
}
function FindCallOrJmpAbs(fun, size, pt, jmp) {
    const op = jmp ? 0x25 : 0x15, r = region(pt, pt + size), b = r.bytes, d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let i = 0x1000; i < size - 4 && i + 6 <= b.length; i++) {
        if (b[i] !== 0xff || b[i + 1] !== op) continue;
        const t = d.getUint32(i + 2, true);
        if (t > pt && t < pt + size) {
            try { if (rdU32(t) === u32(fun)) return u32(pt + i); } catch (e) { /* unreadable */ }
            i += 5;
        }
    }
    return 0;
}
function FindCallBoth(fun, size, pt) {
    const r = region(pt, pt + size), b = r.bytes, d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let i = 0x1000; i < size - 4 && i + 6 <= b.length; i++) {
        if (b[i] === 0xe8 && u32(d.getUint32(i + 1, true) + pt + i + 5) === u32(fun)) return i;
        if (b[i] === 0xff && b[i + 1] === 0x15) {
            const t = d.getUint32(i + 2, true);
            if (t >= pt && t <= pt + size - 4) {
                try { if (rdU32(t) === u32(fun)) return i; } catch (e) { /* unreadable */ }
                i += 6;
            }
        }
    }
    return 0;
}
function FindCallAndEntryAbs(fun, size, pt, sig) {
    const a = callerSites(fun, [sig], pt, pt + size, 0x800, 0x1000)[0];
    return a ? a[0] : 0;
}
function FindCallAndEntryRel(fun, size, pt, sig) {
    const i = FindCallOrJmpRel(fun, size, pt, false);
    if (!i) return 0;
    const mask = SigMask(sig);
    for (let j = i; j > i - 0x800; j--) { try { if (u32(rdU32(j) & mask) === u32(sig)) return u32(j); } catch (e) { return 0; } }
    return 0;
}
// FindCallAndEntryBoth: LunaHook compares a WORD at each candidate with sig & mask; kept.
function FindCallAndEntryBoth(fun, size, pt, sig) {
    const mask = SigMask(sig), r = region(pt, pt + size), b = r.bytes, d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let i = 0x1000; i < size - 4 && i + 6 <= b.length; i++) {
        let hit = false, l = 0;
        if (b[i] === 0xe8) { hit = u32(pt + i + 5 + d.getUint32(i + 1, true)) === u32(fun); l = 5; }
        else if (b[i] === 0xff && b[i + 1] === 0x15) {
            const t = d.getUint32(i + 2, true);
            if (t >= pt && t <= pt + size - 4) { try { hit = rdU32(t) === u32(fun); } catch (e) { hit = false; } l = 6; }
        }
        if (hit) {
            for (let j = i; j > i - 0x800 && j >= 0; j--) {
                if (j + 2 <= b.length && d.getUint16(j, true) === u32(sig & mask)) return u32(pt + j);
                i += l;
            }
        }
    }
    return 0;
}
// findiatcallormov(fun, hmodule, start, end, reverse = false, movreg = 0): `call [IAT slot]`
// (ff 15) or `mov reg, [IAT slot]` (8b movreg) for an imported function.
function iatPattern(fun, hmodule, movreg) {
    const entry = FindImportEntry(hmodule, fun);
    if (!entry) return null;
    return { bytes: Uint8Array.from([movreg ? 0x8b : 0xff, movreg ? movreg : 0x15, ...le32(entry)]), masks: new Uint8Array(6).fill(0xff) };
}
function findiatcallormov(fun, hmodule, start, end, reverse = false, movreg = 0) {
    const pat = iatPattern(fun, hmodule, movreg);
    if (!pat) return 0;
    return reverse ? reverseFindBytes(pat, start, end) : findBytes(pat, start, end);
}
function findiatcallormov_all(fun, hmodule, start, end, protect = PAGE_EXECUTE, movreg = 0) {
    const pat = iatPattern(fun, hmodule, movreg);
    return pat ? SearchMemory(pat, protect, start, end) : [];
}
// findxref_reverse(addr, from, to): every `xx rel32` in (from, to] that reaches addr, last first.
function xrefs(addr, from, to, op) {
    const out = [];
    if (!addr) return out;
    from = u32(from); to = u32(to);
    const r = region(from - 5 > 0 ? from - 5 : 0, to), b = r.bytes, d = new DataView(b.buffer, b.byteOffset, b.length);
    for (let now = to; now > from; now--) {
        const at = now - 5 - r.base;
        if (at < 0 || at + 5 > b.length) continue;
        if (u32(now + d.getInt32(at + 1, true)) === u32(addr) && (op === undefined || b[at] === op)) out.push(now - 5);
    }
    return out;
}
const findxref_reverse = (addr, from, to) => xrefs(addr, from, to);
const findxref_reverse_checkcallop = (addr, from, to, op) => xrefs(addr, from, to, op);
// findrelativecall(pattern, length, calladdress, start, end): pattern followed by `call calladdress`.
function findrelativecall(p, _length, calladdress, start, end) {
    const pat = pattern(p), n = pat.bytes.length, save = [];
    for (const a of findBytesAll(pat, start, end)) {
        try { if (u8(a + n) === 0xe8 && u32(rdU32(a + n + 1) + a + n + 5) === u32(calladdress)) save.push(a); } catch (e) { /* unreadable */ }
    }
    return save;
}

// ---- engine checks: the game folder's files (Util::CheckFile) -----------------------------------
// The files are the folder VNBox runs the game from: the frame's lazy=opfs:<dir> (chimimouryou's
// /v), listed from this origin's private file system, as paths relative to the exe's folder.
// globalThis.lunaGameFiles (an array of paths) overrides it (tests, other hosts).
let gameFiles = null;
async function listGameFiles() {
    if (gameFiles) return gameFiles;
    if (Array.isArray(globalThis.lunaGameFiles)) return (gameFiles = globalThis.lunaGameFiles.slice());
    try {
        const params = new URLSearchParams(globalThis.location ? globalThis.location.search : '');
        const lazy = params.get('lazy') || '', exe = (params.get('p') || '').replace(/\\/g, '/');
        if (!lazy.startsWith('opfs:') || !globalThis.navigator || !navigator.storage) return (gameFiles = []);
        let dir = await navigator.storage.getDirectory();
        const exeDir = exe.includes('/') ? exe.slice(0, exe.lastIndexOf('/')) : '';
        for (const part of [...lazy.slice(5).split('/'), ...exeDir.split('/')].filter(Boolean)) dir = await dir.getDirectoryHandle(part);
        const out = [];
        const walk = async (d, prefix, depth) => {
            for await (const [name, h] of d.entries()) {
                if (out.length >= 20000) return;
                out.push(prefix + name + (h.kind === 'directory' ? '/' : ''));
                if (h.kind === 'directory' && depth < 3) await walk(h, prefix + name + '/', depth + 1);
            }
        };
        await walk(dir, '', 0);
        gameFiles = out;
    } catch (e) {
        console.warn('[luna] could not list the game folder: ' + e);
        gameFiles = [];
    }
    return gameFiles;
}
// PathMatchSpec-style match of one CheckFile name against a list of relative paths (dirs end in /).
function fileMatches(name, files) {
    const spec = String(name).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    const rx = new RegExp('^' + spec.split('').map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('') + '/?$');
    return files.some((f) => rx.test(f.toLowerCase()));
}
const CheckFile = (name) => (gameFiles ? fileMatches(name, gameFiles) : false);
const CheckFileAll = (names) => names.every(CheckFile);
const CheckFileAny = (names) => names.some(CheckFile);

// ---- hooks: HookParam → Interceptor.attach (TextHook::Send) -----------------------------------
function HookParam(init) {
    return Object.assign({
        address: 0, offset: 0, index: 0, split: 0, split_index: 0, module: '', function: '', type: 0, codepage: 0,
        length_offset: 0, padding: 0, user_value: 0, text_fun: null, filter_fun: null, lineSeparator: null, name: '',
    }, init || {});
}
// The hook_context a text_fun sees: values are numbers (uintptr_t), as in the C++.
function makeContext(ctx) {
    const esp = ctx.esp.toUInt32();
    const reg = (r) => ctx[r].toUInt32();
    const c = {
        get eax() { return reg('eax'); }, get ecx() { return reg('ecx'); }, get edx() { return reg('edx'); }, get ebx() { return reg('ebx'); },
        get esp() { return esp; }, get ebp() { return reg('ebp'); }, get esi() { return reg('esi'); }, get edi() { return reg('edi'); },
        base: esp,
        get retaddr() { return live.u32(esp); },
        stack: new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^\d+$/.test(k) ? live.u32(esp + 4 * k) : undefined) }),
        argof: (i) => live.u32(esp + 4 * i),
        argof_thiscall: (i = 0) => (i === 0 ? reg('ecx') : live.u32(esp + 4 * i)),
        last_ret_val: () => reg('eax'),
        // context->offset(off): the value at base + off (registers at negative offsets).
        offset: (off) => (off < 0 ? (OFFSET_REG[off] === 'esp' ? esp : reg(OFFSET_REG[off] || fail('offset ' + off))) : live.u32(esp + off)),
    };
    return c;
}
const fail = (m) => { throw new Error(m); };

// Lines: per LunaHook thread (hook, return address, split); characters join, strings start a new piece.
let sendLine = (text) => trans.send(text);
const threads = new Map();
function push(key, text, full) {
    if (!text) return;
    let t = threads.get(key);
    const flush = () => {
        const b = threads.get(key);
        if (!b || !b.text) return;
        clearTimeout(b.timer);
        const out = b.text;
        b.text = '';
        sendLine(out);
    };
    if (full) { flush(); sendLine(text); return; }
    if (!t) threads.set(key, t = { text: '', timer: 0, last: null });
    const single = [...text].length === 1;
    if (single || text !== t.last) {
        t.text += t.text && !single ? '\n' + text : text;
        if (!single) t.last = text;
    }
    clearTimeout(t.timer);
    t.timer = setTimeout(flush, 500);
    if (t.text.length > 3000) flush();
}
function decodeBuffer(buffer, hp) {
    if (hp.type & T.CODEC_UTF16) return buffer.strW();
    if (hp.type & T.CODEC_UTF32) return buffer.strU();
    if (hp.type & T.CODEC_UTF8) return StringToWideString(buffer.data, CP_UTF8);
    return StringToWideString(buffer.data, hp.codepage || 932);
}
function strlenBytes(addr, hp) {
    const unit = hp.type & T.CODEC_UTF16 ? 2 : hp.type & T.CODEC_UTF32 ? 4 : 1;
    if (unit === 4) { let n = 0; while (n < TEXT_BUFFER_SIZE && live.u32(addr + n)) n += 4; return n; }
    return cstr(addr, unit).length;
}
// TextHook::Send for one hit.
function send(hp, context, address) {
    if (hp.type & T.HOOK_EMPTY) return; // a dummy hook only for dynamic hooks
    const buffer = new TextBuffer();
    const split = { value: 0 };
    let lpRetn = context.retaddr;
    let lpDataIn = context.offset(hp.offset);
    const text_fun = hp.text_fun;
    if (text_fun) {
        text_fun(context, hp, buffer, split);
    } else {
        if (hp.type & T.FIXING_SPLIT) split.value = FIXED_SPLIT_VALUE;
        else if (hp.type & T.USING_SPLIT) {
            split.value = context.offset(hp.split);
            if (hp.type & T.SPLIT_INDIRECT) split.value = live.u32(split.value + hp.split_index);
        }
        if (hp.type & T.DATA_INDIRECT) lpDataIn = live.u32(lpDataIn + hp.index);
        lpDataIn = u32(lpDataIn + hp.padding);
        let len;
        if (hp.type & T.USING_STRING) {
            if (hp.length_offset) {
                len = live.i32(context.base + 4 * hp.length_offset);
                if (len >= 0) len *= hp.type & T.CODEC_UTF16 ? 2 : hp.type & T.CODEC_UTF32 ? 4 : 1;
                else if (len === -1) len = lpDataIn ? strlenBytes(lpDataIn, hp) : 0;
            } else len = lpDataIn ? strlenBytes(lpDataIn, hp) : 0;
        } else if (hp.type & T.CODEC_UTF16) len = 2;
        else if (hp.type & T.CODEC_UTF32) len = 4;
        else if (hp.type & T.CODEC_UTF8) len = utf8charlen(lpDataIn);
        else len = IsDBCSLeadByteEx(hp.codepage || 932, hp.type & T.CODEC_ANSI_BE ? lpDataIn >>> 8 : lpDataIn) ? 2 : 1;
        len = Math.max(0, len);
        if (len > 0) buffer.data = new Uint8Array(len); // filled below
    }
    if (buffer.size <= 0) return;
    if (buffer.size > TEXT_BUFFER_SIZE) buffer.size = TEXT_BUFFER_SIZE;
    if (hp.type & T.USING_CHAR || (!text_fun && !(hp.type & T.USING_STRING))) {
        let v = text_fun ? new DataView(Uint8Array.from([...buffer.data, 0, 0, 0, 0]).buffer).getUint32(0, true) : lpDataIn;
        if (hp.type & (T.CODEC_UTF32 | T.CODEC_UTF8)) {
            const n = buffer.size;
            buffer.from_t(u32(v), 4);
            buffer.size = n;
        } else {
            v &= 0xffff;
            if (hp.type & T.CODEC_ANSI_BE && v >> 8) v = ((v & 0xff) << 8) | (v >> 8);
            const n = buffer.size;
            if (n === 1) v &= 0xff;
            buffer.from_t(v, 2);
            buffer.size = n;
        }
    } else if (!text_fun) {
        if (!lpDataIn) return;
        buffer.data = readLive(lpDataIn, buffer.size).slice();
    }
    if (!(hp.type & (T.CODEC_UTF16 | T.CODEC_UTF32 | T.CODEC_UTF8)) && buffer.size === 2) { // commonfilter
        filters.StringFilterA(buffer, '\x81\xa4');
        filters.StringFilterA(buffer, '\x81\xa5');
    }
    if (buffer.size <= 0) return;
    if (hp.filter_fun) {
        hp.filter_fun(buffer, hp);
        if (buffer.size <= 0) return;
    }
    if (buffer.data.every((b) => b === 0)) return;
    if (hp.type & (T.NO_CONTEXT | T.FIXING_SPLIT)) lpRetn = 0;
    if (hp.lineSeparator) {
        if (hp.type & T.CODEC_UTF16) filters.StringCharReplacerW(buffer, hp.lineSeparator, '\n');
        else if (!(hp.type & T.CODEC_UTF32)) filters.StringCharReplacerA(buffer, hp.lineSeparator, '\n');
    }
    const text = decodeBuffer(buffer, hp);
    push(hp.name + '@' + hex(address) + ':' + hex(lpRetn) + ':' + hex(split.value), text, !!(hp.type & T.FULL_STRING));
}
// getasbaddr: module/function relative addresses.
function absoluteAddress(hp) {
    let address = u32(hp.address);
    if (hp.type & T.MODULE_OFFSET) {
        const base = GetModuleHandle(hp.module || null);
        if (!base) { console.log('[luna] ' + hp.name + ': module not loaded: ' + hp.module); return 0; }
        if (hp.type & T.FUNCTION_OFFSET) {
            const f = GetProcAddress(base, hp.function);
            if (!f) { console.log('[luna] ' + hp.name + ': function missing: ' + hp.function); return 0; }
            address = u32(address + f);
        } else address = u32(address + base);
    }
    return address;
}
const hooked = new Set();
let anyHook = false;
// NewHook(hp, name) → true when attached. Unsupported kinds are refused with a console note.
function NewHook(hpIn, name) {
    const hp = HookParam(hpIn);
    hp.name = name || hp.name || 'hook';
    for (const flag of ['HOOK_RETURN', 'DIRECT_READ', 'CSHARP_STRING']) {
        if (hp.type & T[flag]) { console.log('[luna] ' + hp.name + ': ' + flag + ' hooks are not supported'); return false; }
    }
    if (hp.hook_after || hp.hook_before) { console.log('[luna] ' + hp.name + ': hook_after/hook_before are not supported'); return false; }
    // jichi: a text_fun or filter-only hook defaults to USING_STRING unless USING_CHAR is set (types.h note)
    if (hp.text_fun && !(hp.type & (T.USING_CHAR | T.USING_STRING))) hp.type |= T.USING_STRING;
    const address = absoluteAddress(hp);
    if (!address) return false;
    if (hp.type & T.HOOK_EMPTY) return true;
    const key = address + ':' + hp.name;
    if (hooked.has(key)) return true;
    hooked.add(key);
    console.log('[luna] hook ' + hp.name + ' at ' + hex(address));
    let reported = false;
    Interceptor.attach(ptr(address), function () {
        try {
            send(hp, makeContext(this.context), address);
        } catch (e) {
            if (!reported && !(hp.type & T.KNOWN_UNSTABLE)) console.log('[luna] ' + hp.name + ': ' + (e && e.message || e));
            reported = true;
        }
    });
    anyHook = true;
    return true;
}
// PcHooks::hookGDIFunctions (pchooks.cpp NEW_HOOK table): data arg, split arg, type, length arg.
const GDI = [
    ['gdi32.dll', 'GetTextExtentPoint32A', 2, T.USING_STRING, 3], ['gdi32.dll', 'GetTextExtentExPointA', 2, T.USING_STRING, 3],
    ['gdi32.dll', 'GetCharacterPlacementA', 2, T.USING_STRING, 3], ['gdi32.dll', 'GetGlyphIndicesA', 2, T.USING_STRING, 3],
    ['gdi32.dll', 'GetGlyphOutlineA', 2, T.CODEC_ANSI_BE, 0], ['gdi32.dll', 'ExtTextOutA', 6, T.USING_STRING, 7],
    ['gdi32.dll', 'TextOutA', 4, T.USING_STRING, 5], ['gdi32.dll', 'GetCharABCWidthsA', 2, T.CODEC_ANSI_BE, 0],
    ['gdi32.dll', 'GetCharABCWidthsFloatA', 2, T.CODEC_ANSI_BE, 0], ['gdi32.dll', 'GetCharWidth32A', 2, T.CODEC_ANSI_BE, 0],
    ['gdi32.dll', 'GetCharWidthFloatA', 2, T.CODEC_ANSI_BE, 0],
    ['gdi32.dll', 'GetTextExtentPoint32W', 2, T.CODEC_UTF16 | T.USING_STRING, 3], ['gdi32.dll', 'GetTextExtentExPointW', 2, T.CODEC_UTF16 | T.USING_STRING, 3],
    ['gdi32.dll', 'GetCharacterPlacementW', 2, T.CODEC_UTF16 | T.USING_STRING, 3], ['gdi32.dll', 'GetGlyphIndicesW', 2, T.CODEC_UTF16 | T.USING_STRING, 3],
    ['gdi32.dll', 'GetGlyphOutlineW', 2, T.CODEC_UTF16, 0], ['gdi32.dll', 'TextOutW', 4, T.CODEC_UTF16 | T.USING_STRING, 5],
    ['gdi32.dll', 'GetCharABCWidthsW', 2, T.CODEC_UTF16, 0], ['gdi32.dll', 'GetCharABCWidthsFloatW', 2, T.CODEC_UTF16, 0],
    ['gdi32.dll', 'GetCharWidth32W', 2, T.CODEC_UTF16, 0], ['gdi32.dll', 'GetCharWidthFloatW', 2, T.CODEC_UTF16, 0],
    ['user32.dll', 'DrawTextA', 2, T.USING_STRING, 3], ['user32.dll', 'DrawTextExA', 2, T.USING_STRING, 3],
    ['user32.dll', 'TabbedTextOutA', 4, T.USING_STRING, 5], ['user32.dll', 'GetTabbedTextExtentA', 2, T.USING_STRING, 3],
    ['user32.dll', 'DrawTextW', 2, T.CODEC_UTF16 | T.USING_STRING, 3], ['user32.dll', 'DrawTextExW', 2, T.CODEC_UTF16 | T.USING_STRING, 3],
    ['user32.dll', 'TabbedTextOutW', 4, T.CODEC_UTF16 | T.USING_STRING, 5], ['user32.dll', 'GetTabbedTextExtentW', 2, T.CODEC_UTF16 | T.USING_STRING, 3],
];
const gdiDone = new Set();
// hookGDIFunctions(ptr = 0): every GDI/USER text export, or only the one at ptr.
function hookGDIFunctions(only = 0) {
    for (const [dll, fn, data, type, lenArg] of GDI) {
        const at = GetProcAddress(dll, fn);
        if (!at || (only ? at !== u32(only) : gdiDone.has(at))) continue;
        gdiDone.add(at);
        NewHook({ address: 0, module: dll, function: fn, offset: GETARG(data), index: 0, split: GETARG(1), split_index: 0,
            type: type | T.MODULE_OFFSET | T.FUNCTION_OFFSET, length_offset: lenArg }, fn);
    }
}

// ---- engines ----------------------------------------------------------------------------------
// engine({ name, check, certain, attach }): check is one of
//   { FILE: 'x' } | { FILE_ALL: [...] } | { FILE_ANY: [...] } | { RESOURCE_STR: 'x' } | { StringFileInfo: 'x' }
//   | a function (CHECK_BY::CUSTOM) | undefined (ALL_TRUE: matches, not certain).
function engine(spec) {
    if (!spec.name || typeof spec.attach !== 'function') throw new Error('engine: name and attach() are required');
    return Object.assign({ certain: spec.check !== undefined }, spec);
}
function check_function(e) {
    const c = e.check;
    if (c === undefined) return true;
    if (typeof c === 'function') return !!c();
    if ('FILE' in c) return CheckFile(c.FILE);
    if ('FILE_ALL' in c) return CheckFileAll(c.FILE_ALL);
    if ('FILE_ANY' in c) return CheckFileAny(c.FILE_ANY);
    if ('RESOURCE_STR' in c) return SearchResourceString(c.RESOURCE_STR);
    if ('StringFileInfo' in c) return SearchStringFileInfo(c.StringFileInfo);
    throw new Error(e.name + ': unknown check');
}
function safe(what, e, fn) {
    try { return !!fn(); } catch (err) { console.log('[luna] ' + e.name + ' ' + what + ' error: ' + (err && err.stack || err)); return false; }
}
// checkengine (enginecontrol.cpp): first matching engine in order; stop at a certain match or an attach.
// With no engine attached: PcHooks::hookGDIFunctions, as HIJACK() does.
async function auto(engines) {
    await listGameFiles();
    initRanges();
    for (const e of engines) {
        if (!safe('match', e, () => check_function(e))) continue;
        console.log('[luna] matched engine ' + e.name);
        const attached = safe('attach', e, () => e.attach());
        if (attached) console.log('[luna] attached ' + e.name);
        if (e.certain || attached) return attached ? e.name : null;
    }
    console.log('[luna] no engine attached: hooking the GDI text functions');
    hookGDIFunctions();
    return null;
}
// An engine file picked by hand (run as the frida= script): its engines in order, the matching ones
// first; when none matches, each is attached anyway until one attaches.
async function run(list) {
    list = [].concat(list);
    await listGameFiles();
    initRanges();
    const matched = list.filter((e) => safe('match', e, () => check_function(e)));
    if (!matched.length) console.log('[luna] ' + list.map((e) => e.name).join(', ') + ': the engine check failed; attaching anyway');
    for (const e of matched.length ? matched : list) {
        if (safe('attach', e, () => e.attach())) { console.log('[luna] ' + e.name + ' attached'); return true; }
        console.log('[luna] ' + e.name + ' did not attach (no hook site found)');
    }
    return false;
}
const L = {
    // process range (HIJACK): the exe's image
    processStartAddress: 0, processStopAddress: 0, processName: '', processName_lower: '',
};
function initRanges() {
    const m = main();
    L.processStartAddress = m.base.toUInt32();
    [, L.processStopAddress] = QueryModuleLimits(L.processStartAddress, 0, PAGE_READONLY);
    L.processName = m.name;
    L.processName_lower = m.name.toLowerCase();
}

Object.assign(L, T, filters, {
    XX, XX2, XX4, XX8, FIXED_SPLIT_VALUE, TEXT_BUFFER_SIZE, MaximumFunctionSize, MemoryPaddingOffset,
    PAGE_EXECUTE, PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_READONLY, CP_UTF8, CP_ACP,
    regoffset, stackoffset, GETARG, hex,
    // memory
    u8, i8, u16, i16, u32: rdU32, i32, rd, readable, live, cstr, image, region,
    isAddressReadable: readable, IsBadReadPtr: (a, n) => !readable(a, n),
    readA: (addr, n) => bytesToA(n === undefined ? cstr(addr, 1) : readLive(addr, n)), // (char *) as a byte string
    readW: (addr, n) => bytesToW(n === undefined ? cstr(addr, 2) : readLive(addr, 2 * n)), // (wchar_t *) as text
    strlen: (addr) => cstr(addr, 1).length, wcslen: (addr) => cstr(addr, 2).length / 2,
    // codecs and strings
    StringToWideString, WideStringToString, utf8A: (w) => WideStringToString(w, CP_UTF8), wcasta, acastw, IsDBCSLeadByte, IsDBCSLeadByteEx, IsShiftjisWord,
    IsShiftjisLeadByte, utf8charlen, all_ascii, strReplace, startWith, endWith, strSplit, re, katakanaMap, remapkatakana,
    bytesToA, aToBytes, bytesToW, wToBytes, TextBuffer,
    // modules
    GetModuleHandle, GetModuleHandleW, GetModuleHandleA, GetProcAddress, FindFunction, sections, GetCodeRange, QueryModuleLimits,
    FindImportEntry, SearchResourceString, SearchStringFileInfo,
    // searches
    pattern, MatchPattern, le32, findBytes, findBytesAll, iterFindBytes, iterMatchBytes, reverseFindBytes, find_pattern, SearchMemory,
    findEnclosingAlignedFunction, findEnclosingAlignedFunction_strict, findEnclosingFunctionAfterDword,
    findEnclosingFunctionBeforeDword, findEnclosingFunctionAfterInt3, findEnclosingFunctionAfterNop, findfuncstart,
    findNearCallAddress, findShortJumpAddress, findFarCallAddress, findLongJumpAddress, findLastNearCallAddress,
    findLastShortJumpAddress, findLastFarCallAddress, findLastLongJumpAddress, findCallAddress, findLastCallAddress,
    findJumpAddress, iterNearCallAddress, iterShortJumpAddress, iterFarCallAddress, iterLongJumpAddress,
    iterAlignedNearCallerAddress, iterCallerAddress, iterCallerAddressAfterInt3, iterUniqueCallerAddress,
    iterUniqueCallerAddressAfterInt3, findCallerAddress, findLastCallerAddress, findCallerAddressAfterInt3,
    findLastCallerAddressAfterInt3, findMultiCallerAddress, findAlignedNearCallerAddress, findLastAlignedNearCallerAddress,
    findPushDwordAddress, findPushAddress, findPushByteAddress, find_leaorpush_addr, find_leaorpush_addr_all,
    FindCallOrJmpRel, FindCallOrJmpAbs, FindCallBoth, FindCallAndEntryAbs, FindCallAndEntryRel, FindCallAndEntryBoth,
    findiatcallormov, findiatcallormov_all, findxref_reverse, findxref_reverse_checkcallop, findrelativecall,
    // checks, hooks, engines
    CheckFile, CheckFileAll, CheckFileAny, fileMatches, listGameFiles, HookParam, NewHook, hookGDIFunctions,
    engine, check_function, auto, run, initRanges,
    get anyHook() { return anyHook; },
    _test: { setSendLine: (fn) => { sendLine = fn; }, setGameFiles: (f) => { gameFiles = f; }, reset() { images.clear(); hooked.clear(); gdiDone.clear(); threads.clear(); anyHook = false; } },
});
module.exports = L;
