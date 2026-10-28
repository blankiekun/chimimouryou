// Troy.js: LunaHook's Troy engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Troy.cpp and Troy.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX2 } = L;

const E = L.engine({
    name: 'Troy',
    check: { FILE_ALL: ['*.mma', 'sfe.dll'] },
    certain: false,
    attach() {
        // Reverse desire～裏返る欲望～
        const dll = L.GetModuleHandleW('sfe.dll');
        if (dll === 0) return false;
        const [minaddr, maxaddr] = L.QueryModuleLimits(dll);
        const bytes = [
            0x3C, 0x82,
            ...XX2,
            0x80, 0xFB, 0x9F,
            ...XX2,
            0x80, 0xFB, 0xF1];
        let addr = L.findBytes(bytes, minaddr, maxaddr);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.CODEC_ANSI_BE }, 'Troy');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
