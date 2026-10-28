// BunBun.js: LunaHook's BunBun engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/BunBun.cpp and BunBun.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'BunBun',
    check: () => L.CheckFile('pac/*.bin') && L.SearchResourceString('BunBun'),
    attach() {
        // 保健室～マジカルピュアレッスン♪～
        // https://vndb.org/v351
        // int __cdecl sub_406AA0(__int16 a1): the Shift-JIS to JIS conversion of one character
        const bytes = [
            0x8b, 0x4c, 0x24, 0x04,
            0x33, 0xc0,
            0x8a, 0xc5,
            0x81, 0xe1, 0xff, 0x00, 0x00, 0x00,
            0x3d, 0x81, 0x00, 0x00, 0x00,
            0x72, XX,
            0x3d, 0x9f, 0x00, 0x00, 0x00,
            0x77, XX,
            0x2d, 0x81, 0x00, 0x00, 0x00,
            0xeb, XX,
            0x3d, 0xe0, 0x00, 0x00, 0x00,
            0x72, XX,
            0x3d, 0xef, 0x00, 0x00, 0x00,
            0x77, XX,
            0x2d, 0xc1, 0x00, 0x00, 0x00,
        ];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_CHAR | L.CODEC_ANSI_BE }, 'BunBun');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
