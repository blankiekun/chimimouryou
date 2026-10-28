// OVERDRIVE.js: LunaHook's OVERDRIVE engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/OVERDRIVE.cpp and OVERDRIVE.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

const E = L.engine({
    name: 'OVERDRIVE',
    check: { FILE_ALL: ['DATA\\bgm.vfa', 'DATA\\grp.vfa', 'DATA\\SCR.arc', 'DATA\\snd.vfa'] },
    certain: false,
    attach() {
        // エーデルワイス
        const bytes = [
            0x56,
            0x57,
            0x8b, 0x7c, 0x24, 0x0c,
            0x32, 0xc0,
            0x85, 0xff,
            0x8b, 0xf1,
            0x0f, 0x84, XX, 0x00, 0x00, 0x00];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.stackoffset(1),
            type: L.USING_STRING,
            filter_fun(buffer) { L.StringFilterA(buffer, '\\p\\l'); },
        }, 'OVERDRIVE');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
