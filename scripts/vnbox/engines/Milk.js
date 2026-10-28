// Milk.js: LunaHook's Milk engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Milk.cpp and Milk.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

// The C++ keeps the decompiled sub_40C750 (Shift-JIS code to glyph cell) in a comment; only its tail is searched.
const E = L.engine({
    name: 'Milk',
    check: { FILE_ALL: ['bcg.rsa', 'demo.rsa', 'font.rsa', 'mask.rsa', 'parts.rsa', 'script.rsa', 'se.rsa', 'voice.rsa'] },
    attach() {
        const pattern = [
            0x66, 0x3d, 0x40, 0x87,
            0x72, XX,
            0x66, 0x3d, 0x9f, 0x87,
            0x77, XX,
            0x25, 0xf0, 0x00, 0x00, 0x00,
            0x5f,
            0x83, 0xe8, 0x40,
            0xc1, 0xf8, 0x04,
            0x83, 0xc0, 0x38,
            0x8d, 0x0c, 0x40,
            0xb8, 0x02, 0x00, 0x00, 0x00,
            0xc1, 0xe1, 0x03,
            0x89, 0x4e, 0x04,
            0x5e,
            0x5d,
            0xc3];
        let addr = L.findBytes(pattern, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x80);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_CHAR | L.DATA_INDIRECT }, 'Milk');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
