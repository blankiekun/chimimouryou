// Ciel.js: LunaHook's Ciel engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Ciel.cpp and Ciel.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertCielHook() {
    /*
     * Sample games:
     * https://vndb.org/r26480
     * https://vndb.org/v1648
     * https://vndb.org/v10392
     */
    const bytes = [
        0x50, // push eax               << hook here
        0xE8, ...XX4, // call FaultA.exe+81032
        0x83, 0xC4, 0x04, // add esp,04
        0x85, 0xC0, // test eax,eax
        0x74, 0x32, // je FaultA.exe+41FA6
        0x81, 0x7C, 0x24, 0x10, ...XX4, // cmp [esp+10],000003FE
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edi'),
        type: L.DATA_INDIRECT | L.NO_CONTEXT,
        filter_fun(buffer) {
            if (buffer.size === 1) buffer.clear();
        },
    }, 'Ciel');
}

const E = L.engine({
    name: 'Ciel',
    check: { FILE: 'sys/kidoku.dat' },
    attach() { return InsertCielHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
