// InteractiveNovelEngine.js: LunaHook's InteractiveNovelEngine engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/InteractiveNovelEngine.cpp and InteractiveNovelEngine.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

// COMString::StringInitSBytPtrPartialEx (mscorwks.dll, .NET 2): the text is the UTF-8 string built there
const cache = []; // static lru_cache<std::string> cache(5)
function cacheTouch(s) {
    const i = cache.indexOf(s);
    if (i >= 0) { cache.splice(i, 1); cache.unshift(s); return true; }
    cache.unshift(s);
    if (cache.length > 5) cache.pop();
    return false;
}

const E = L.engine({
    name: 'InteractiveNovelEngine',
    check: () => L.GetModuleHandle('mscorwks.dll') && L.SearchResourceString('Interactive Novel Engine'),
    attach() {
        const [s, e] = L.QueryModuleLimits(L.GetModuleHandleW('mscorwks.dll'));
        const bytes = [
            0x68, 0x68, 0x01, 0x00, 0x00,
            0xb8, ...XX4,
            0xe8, ...XX4,
            0x89, 0x95, ...XX4,
            0x8b, 0x45, 0x08,
            0x89, 0x85, ...XX4,
            0x33, 0xdb,
            0x8d, 0x8d, ...XX4,
            0xe8, ...XX4,
            0x85, 0xc0,
            0x0f, 0x85, ...XX4,
            0x8d, 0x85, ...XX4,
            0x50,
            0x53,
            0x8d, 0x85, ...XX4,
            0x50,
            0xb8, ...XX4,
            0x50,
            0x8d, 0x8d, ...XX4,
            0xe8, ...XX4,
            0xff, 0x15, ...XX4,
            0x8b, 0xf8,
            0x8b, 0x47, 0x04,
            0xa8, 0x01];
        const addr = L.findBytes(bytes, s, e);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.regoffset('edx'),
            type: L.USING_STRING | L.CODEC_UTF8 | L.FULL_STRING,
            filter_fun(buffer) {
                let s = buffer.strA();
                if (L.all_ascii(s)) return buffer.clear();
                if (cacheTouch(s)) return buffer.clear();
                s = L.re.sub(s, 'owner = .*');
                s = L.re.sub(s, String.raw`.*[+-]\d+`);
                buffer.fromA(L.strReplace(s, '@'));
            },
        }, 'InteractiveNovelEngine');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
