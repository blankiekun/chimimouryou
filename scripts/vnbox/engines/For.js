// For.js: LunaHook's For engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/For.cpp and For.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// void *__cdecl sub_40D1F3(LPCSTR lpString, int a2, int a3): renders each glyph with TextOutA
const E = L.engine({
    name: 'For',
    check: { FILE_ALL: ['se', 'info', 'Grphic', 'Data0*', 'mid/M*.MID'] },
    certain: false,
    attach() {
        const bytes = [
            0X8B, 0X55, 0X08,
            0X33, 0XC0,
            0X66, 0X8B, 0X02,
            0X3D, 0X5C, 0X6E, 0X00, 0X00,
            0X75, 0X0B,
            0X8B, 0X4D, 0X08,
            0X83, 0XC1, 0X02,
            0X89, 0X4D, 0X08,
            0XEB, XX];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr, 0x200);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.FULL_STRING | L.USING_STRING }, 'For');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
