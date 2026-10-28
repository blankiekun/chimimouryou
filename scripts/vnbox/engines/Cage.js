// Cage.js: LunaHook's Cage engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Cage.cpp and Cage.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'Cage',
    check: { FILE_ALL: ['script.msb', 'data*.ym'] },
    attach() {
        // https://vndb.org/v8381
        // 夢姿 ～ゆめのすがた～
        // size_t __cdecl _mbslen(const unsigned __int8 *String)
        const check = [
            0x8B, 0x44, 0x24, 0x0C,
            0x59,
            0x33, 0xF6,
            0x8A, 0x08,
            0x84, 0xC9,
            0x74, 0x16,
            0x0F, 0xB6, 0xC9,
            0xF6, 0x81, ...XX4, 0x04,
            0x74, 0x06,
            0x40,
            0x80, 0x38, 0x00,
            0x74, 0x04,
            0x46,
            0x40,
            0xEB, 0xE4];
        let addrx = L.findBytes(check, L.processStartAddress, L.processStopAddress);
        if (!addrx) return false;
        addrx = L.findEnclosingAlignedFunction(addrx);
        if (!addrx) return false;
        return L.NewHook({ address: addrx, type: L.USING_STRING, offset: L.stackoffset(1) }, 'Cage');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
