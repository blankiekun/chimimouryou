// Self-check of the LunaHook engine ports: libLuna's HookParam, pattern and search helpers over a
// fake guest (a small PE image), then every engine file and the automatic script loaded against a fake
// frida-compat with no match (syntax, checks run, nothing throws). Run: node scripts/vnbox/engines/engines.check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const GLOBALS = ['Process', 'Memory', 'Module', 'Interceptor', 'ptr', 'trans'];

// ---- a fake guest: game.exe at 0x400000 (PE header, one executable section), gdi32.dll with exports --
class P {
    constructor(v) { this.v = v >>> 0; }
    toUInt32() { return this.v; }
    add(x) { return new P(this.v + (x instanceof P ? x.v : x)); }
    equals(x) { return this.v === (x instanceof P ? x.v : x); }
    toString() { return '0x' + this.v.toString(16); }
}
function fakeGuest() {
    const regions = [];
    const map = (base, size) => { const r = { base, bytes: new Uint8Array(size) }; regions.push(r); return r; };
    const exe = map(0x400000, 0x10000), gdi = map(0x7000000, 0x1000), heap = map(0x10000000, 0x10000);
    const w32 = (r, at, v) => new DataView(r.bytes.buffer).setUint32(at - r.base, v >>> 0, true);
    const w16 = (r, at, v) => new DataView(r.bytes.buffer).setUint16(at - r.base, v, true);
    const put = (r, at, bytes) => r.bytes.set(bytes, at - r.base);
    // PE: e_lfanew 0x80, 1 section (.text at RVA 0x1000, 0x8000 bytes, code|execute), IAT dir at RVA 0x9000
    put(exe, 0x400000, [0x4d, 0x5a]); w32(exe, 0x40003c, 0x80); w32(exe, 0x400080, 0x4550);
    w16(exe, 0x400086, 1); w16(exe, 0x400094, 0xe0);
    w32(exe, 0x400080 + 0x78 + 8 * 12, 0x9000); w32(exe, 0x400080 + 0x7c + 8 * 12, 0x10);
    const sec = 0x400080 + 0x18 + 0xe0;
    put(exe, sec, [0x2e, 0x74, 0x65, 0x78, 0x74]); w32(exe, sec + 8, 0x8000); w32(exe, sec + 0x0c, 0x1000); w32(exe, sec + 0x24, 0x60000020);
    const exports = { ExtTextOutA: 0x7000100, TextOutA: 0x7000200, GetGlyphOutlineA: 0x7000300 };
    const mod = (name, r) => ({
        name, base: new P(r.base), size: r.bytes.length, path: 'C:\\' + name,
        findExportByName: (n) => (name === 'gdi32.dll' && exports[n] ? new P(exports[n]) : null),
    });
    const modules = [mod('game.exe', exe), mod('gdi32.dll', gdi)];
    const find = (a, n) => regions.find((r) => a >= r.base && a + n <= r.base + r.bytes.length);
    const hooks = [], lines = [];
    const g = {
        ptr: (v) => new P(typeof v === 'string' ? parseInt(v) : v),
        Memory: {
            readByteArray(p, n) {
                const a = p.toUInt32(), r = find(a, n);
                if (!r) throw new Error('access violation accessing 0x' + a.toString(16));
                return r.bytes.slice(a - r.base, a - r.base + n).buffer;
            },
        },
        Process: {
            enumerateModules: () => modules,
            findModuleByName: (n) => modules.find((m) => m.name.toLowerCase() === String(n).toLowerCase()) || null,
            findModuleByAddress: (a) => modules.find((m) => a.toUInt32() >= m.base.v && a.toUInt32() < m.base.v + m.size) || null,
        },
        Module: { findExportByName: (m, n) => modules[1].findExportByName(n) },
        Interceptor: { attach: (at, fn) => hooks.push({ at: at.toUInt32(), fn }) },
        trans: { send: (s) => lines.push(s) },
    };
    return { g, exe, heap, put, w32, hooks, lines, exports };
}
function load(file, g, cache = new Map()) {
    const full = path.resolve(dir, file);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {}, parent: cache.size ? {} : null, id: full };
    cache.set(full, module);
    const require = (name) => load(name, g, cache);
    new Function('require', 'module', 'exports', ...GLOBALS, fs.readFileSync(full, 'utf8') + '\n//# sourceURL=' + full)(
        require, module, module.exports, ...GLOBALS.map((k) => g[k]));
    return module.exports;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- libLuna ----------------------------------------------------------------------------------------
{
    const G = fakeGuest();
    const L = load('libLuna.js', G.g);
    L._test.setGameFiles(['Data.xp3', 'plugin/', 'plugin/krmovie.dll', 'Game.exe']);
    L.initRanges();
    assert.equal(L.processStartAddress, 0x400000);
    assert.equal(L.processStopAddress, 0x410000);
    assert.deepEqual(L.QueryModuleLimits(0x400000), [0x401000, 0x409000]);
    assert.deepEqual(L.GetCodeRange(0x400000), [0x401000, 0x40a000]); // LunaHook rounds: + (size & ~0xfff) + 0x1000
    // patterns: strings (?? and nibbles), arrays with XX
    assert.deepEqual([...L.pattern('55 8b ?? 4?').masks], [0xff, 0xff, 0, 0xf0]);
    assert.deepEqual([...L.pattern([0x55, L.XX, 0xec]).masks], [0xff, 0, 0xff]);
    assert.throws(() => L.pattern('55 8bx'), /bad byte/);
    // code: int3 padding, a function at 0x401010 (push ebp; mov ebp,esp), a call to it at 0x401100,
    // a call [IAT] to ExtTextOutA at 0x401200 (IAT slot 0x409000)
    G.put(G.exe, 0x401000, new Array(16).fill(0xcc));
    G.put(G.exe, 0x401010, [0x55, 0x8b, 0xec, 0x83, 0xec, 0x10, 0x8b, 0x45, 0x08]);
    G.put(G.exe, 0x401100, [0xe8, ...le(0x401010 - 0x401105)]);
    G.w32(G.exe, 0x409000, G.exports.ExtTextOutA);
    G.put(G.exe, 0x401200, [0xff, 0x15, ...le(0x409000)]);
    assert.equal(L.findBytes('55 8b ec 83 ?? 10', 0x401000, 0x409000), 0x401010);
    assert.equal(L.findBytes([0x55, 0x8b, 0xec, 0x83, L.XX, 0x10], 0x401000, 0x409000), 0x401010);
    assert.equal(L.findBytes('55 8b ec 84', 0x401000, 0x409000), 0);
    assert.equal(L.reverseFindBytes([0x55, 0x8b, 0xec], 0x401000, 0x401100), 0x401010);
    assert.equal(L.find_pattern('55 8b e? // push ebp\n 83', 0x401000, 0x409000), 0x401010);
    assert.equal(L.findEnclosingAlignedFunction(0x401018), 0x401010);
    assert.equal(L.findfuncstart(0x401018), 0x401010);
    assert.deepEqual(L.findxref_reverse_checkcallop(0x401010, 0x401000, 0x409000, 0xe8), [0x401100]);
    assert.equal(L.findNearCallAddress(0x401010, 0x400000, 0x410000), 0x401100);
    assert.equal(L.FindImportEntry(0x400000, G.exports.ExtTextOutA), 0x409000);
    assert.equal(L.FindFunction('ExtTextOutA'), G.exports.ExtTextOutA);
    assert.deepEqual(L.findiatcallormov_all(G.exports.ExtTextOutA, 0x400000, 0x400000, 0x410000, L.PAGE_EXECUTE), [0x401200]);
    assert.equal(L.findCallerAddress(G.exports.ExtTextOutA, 0xec8b55, 0x400000, 0x410000, L.MaximumFunctionSize, 0), 0x401010);
    // checks
    assert.ok(L.CheckFile('*.xp3') && L.CheckFile('plugin\\krmovie.dll') && L.CheckFile('plugin') && !L.CheckFile('*.arc'));
    assert.ok(L.CheckFileAny(['x.dat', 'data.XP3']) && !L.CheckFileAll(['x.dat', 'data.xp3']));
    // codecs and filters
    assert.equal(L.StringToWideString('\x93\xfa\x96\x7b'), '日本');
    assert.equal(L.WideStringToString('日本a'), '\x93\xfa\x96\x7ba');
    const b = new L.TextBuffer();
    b.fromW('a\nb[c]d'); L.StringFilterBetweenW(b, '[', ']'); L.NewLineCharFilterW(b);
    assert.equal(b.strW(), 'abd');
    b.fromA('\x81\x40x\x81\x40'); L.StringFilterA(b, '\x81\x40');
    assert.equal(b.strA(), 'x');
    assert.equal(L.re.sub('<r>漢<h>かん</r>', '<h>.*?</r>|<r>'), '漢');

    // NewHook → send: strings (cp932, DATA_INDIRECT, length_offset), chars (ANSI_BE), UTF-16, text_fun, split threads
    const sent = [];
    L._test.setSendLine((s) => sent.push(s));
    const stack = 0x10000000, text = 0x10001000;
    G.put(G.heap, text, [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0]); // 日本語
    G.put(G.heap, text + 0x100, [0x42, 0x30, 0x44, 0x30, 0, 0]); // あい (UTF-16)
    G.w32(G.heap, text + 0x200, text); // pointer to the cp932 string
    const regs = { eax: text, ecx: text + 0x200, edx: 0x82a0, ebx: 0, esp: stack, ebp: 0, esi: text + 0x100, edi: 0 };
    const hit = (h) => h.fn.call({ context: Object.fromEntries(Object.entries(regs).map(([k, v]) => [k, new P(v)])) });
    G.w32(G.heap, stack, 0x401105); G.w32(G.heap, stack + 4, text); G.w32(G.heap, stack + 8, 4);
    const n0 = G.hooks.length;
    assert.ok(L.NewHook({ address: 0x401010, offset: L.stackoffset(1), type: L.USING_STRING | L.FULL_STRING }, 'str'));
    assert.ok(L.NewHook({ address: 0x401011, offset: L.regoffset('ecx'), index: 0, type: L.USING_STRING | L.DATA_INDIRECT | L.FULL_STRING, length_offset: 2 }, 'ind'));
    assert.ok(L.NewHook({ address: 0x401012, offset: L.regoffset('edx'), type: L.CODEC_ANSI_BE | L.FULL_STRING }, 'char'));
    assert.ok(L.NewHook({ address: 0x401013, offset: L.regoffset('esi'), type: L.CODEC_UTF16 | L.USING_STRING | L.FULL_STRING }, 'wide'));
    assert.ok(L.NewHook({
        address: 0x401014, type: L.CODEC_UTF16 | L.FULL_STRING,
        text_fun: (context, hp, buffer, split) => { buffer.fromWCharPtr(context.esi); split.value = context.argof(2); },
        filter_fun: (buffer) => L.CharFilterW(buffer, 'い'),
    }, 'fun'));
    assert.equal(G.hooks.length, n0 + 5);
    G.hooks.slice(n0).forEach(hit);
    assert.deepEqual(sent, ['日本語', '日本', 'あ', 'あい', 'あ']);
    // without FULL_STRING: characters of one thread join until 500 ms pass
    sent.length = 0;
    L.NewHook({ address: 0x401015, offset: L.regoffset('edx'), type: L.CODEC_ANSI_BE }, 'chars');
    const h = G.hooks[G.hooks.length - 1];
    hit(h); regs.edx = 0x82a2; hit(h);
    await wait(600);
    assert.deepEqual(sent, ['あい']);
    // GDI fallback hooks the exports that exist
    const n1 = G.hooks.length;
    L.hookGDIFunctions();
    assert.equal(G.hooks.length - n1, 3);
    console.log('libLuna self-check ok');
}

// ---- every engine file, and the automatic script, against a guest with no match -------------------
{
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'libLuna.js').sort();
    let engines = 0;
    for (const file of files) {
        const G = fakeGuest();
        const cache = new Map();
        cache.set(path.resolve(dir, '__entry'), { exports: {} }); // so the file loads as a library (module.parent set)
        const L = load('libLuna.js', G.g, cache);
        L._test.setGameFiles([]);
        L.initRanges();
        const exp = load(file, G.g, cache);
        if (file === 'PC_LunaEngines.js') continue;
        for (const e of [].concat(exp)) {
            assert.ok(e && e.name && typeof e.attach === 'function', file + ': exports an engine');
            assert.doesNotThrow(() => L.check_function(e), file + ': check');
            let attached;
            assert.doesNotThrow(() => { attached = e.attach(); }, file + ': attach');
            assert.ok(!attached, file + ': attached on a guest with no match');
            engines++;
        }
    }
    // the automatic script runs every check in order and falls back to the GDI hooks
    const G = fakeGuest();
    globalThis.lunaGameFiles = [];
    load('PC_LunaEngines.js', G.g);
    await wait(50);
    assert.ok(G.hooks.length === 3, 'auto: GDI fallback');
    console.log(engines + ' engines in ' + (files.length - 1) + ' files load, check and find no match on an empty guest');
}

function le(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }
