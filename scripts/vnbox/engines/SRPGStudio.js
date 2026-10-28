// SRPGStudio.js: LunaHook's SRPGStudio engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/SRPGStudio.cpp and SRPGStudio.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'SRPGStudio',
    check: { FILE: 'runtime.rts' },
    attach() {
        // NAGINATA SOFT
        // HERO'S PARTY R
        // https://store.steampowered.com/app/1804020/HEROS_PARTY_R/
        const dll = L.GetModuleHandleW('OLEAUT32.dll');
        if (dll === 0) return false;
        const addr = L.GetProcAddress(dll, 'SysAllocString');
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.CODEC_UTF16 }, 'SRPGStudio');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
