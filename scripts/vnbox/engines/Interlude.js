// Interlude.js: LunaHook's Interlude engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Interlude.cpp and Interlude.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Interlude',
    check: { FILE_ALL: ['script.pak', 'system.pak', 'title.pak'] },
    certain: false,
    attach() {
        // インタールード
        // https://vndb.org/v3195
        const bytes = [
            0x83, 0xEC, 0x10,
            0x8B, 0x44, 0x24, 0x24,
            0x3D, 0x20, 0x80, 0x00, 0x00,
            0xC7, 0x04, 0x24, 0xE0, 0xE0, 0xE0, 0x00,
            0xC7, 0x44, 0x24, 0x04, 0xE0, 0xE0, 0xE0, 0x20,
            0xC7, 0x44, 0x24, 0x08, 0xE0, 0xE0, 0xE0, 0x40,
            0xC7, 0x44, 0x24, 0x0C, 0xE0, 0xE0, 0xE0, 0x80];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(5), type: L.CODEC_ANSI_BE }, 'Interlude');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
