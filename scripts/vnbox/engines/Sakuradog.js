// Sakuradog.js: LunaHook's Sakuradog engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Sakuradog.cpp and Sakuradog.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Sakuradog',
    check: { FILE_ALL: ['SE.dat', 'GRP.dat', 'SNR.dat', 'VOICE.dat', 'BGM.dat', 'DATA.dat', 'ADV.inf', 'ADV.exe'] },
    certain: false,
    attach() {
        // 綾瀬家のオンナ～淫華の血脈～
        const entry = L.FindImportEntry(L.processStartAddress, L.FindFunction('GetGlyphOutlineA'));
        if (entry === 0) return false;
        const bytes2 = [
            0x57,
            0x50,
            0x6a, 0x06,
            0x56,
            0x53,
            0xff, 0x15, ...L.le32(entry)]; // XX4 filled with the IAT slot
        const addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr + 6,
            offset: L.regoffset('esi'),
            split: 0xe4,
            type: L.CODEC_ANSI_BE | L.USING_SPLIT | L.NO_CONTEXT,
        }, 'Sakuradog');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
