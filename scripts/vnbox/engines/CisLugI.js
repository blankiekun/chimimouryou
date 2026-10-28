// CisLugI.js: LunaHook's CisLugI engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/CisLugI.cpp and CisLugI.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'CisLugI',
    check: { FILE_ALL: ['chara.rvk5', 'back.rvk5', 'bgm.rvk5', 'container*.rvk5', 'script/*.rvk5', 'Sgr/*.rvk5'] },
    attach() {
        // int __cdecl common_tcsncpy_s<char>(_BYTE *a1, int a2, int a3, int a4)
        //  errno_t __cdecl strncpy_s(char *Destination, rsize_t SizeInBytes, const char *Source, rsize_t MaxCount)
        const sig = [
            0x8b, 0xff, 0x55, 0x8b, 0xec, 0x51, 0x8b, XX, 0x14, 0x8b, XX, 0x08, 0x56, 0x85, XX,
            0x75, XX, 0x85, XX, 0x75, XX, 0x39, XX, 0x0c, 0x75, XX, 0x33, 0xc0, 0xeb, XX, 0x85, XX,
            0x74, XX, 0x8b, XX, 0x0c, 0x85, XX, 0x74, XX, 0x85, XX, 0x75, XX,
        ];
        const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(3) }, 'CisLugI');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
