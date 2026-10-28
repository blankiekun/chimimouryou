// Suika2.js: LunaHook's Suika2 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Suika2.cpp and Suika2.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// 灰翼のロードピス
function Suika2_msvcrt() {
    const msvcrt = L.GetModuleHandle('msvcrt.dll');
    if (msvcrt === 0) return false;
    const _strdup = L.GetProcAddress(msvcrt, '_strdup');
    if (_strdup === 0) return false;
    return L.NewHook({ address: _strdup, type: L.USING_STRING | L.CODEC_UTF8, offset: L.stackoffset(1) }, 'Suika2_msvcrt');
}

function Suika2_06x() {
    const _s = L.aToBytes(String.raw`\#{%06x}%s\#{%06x}%s` + '\0');
    const a06xS06xS = L.findBytes(_s, L.processStartAddress, L.processStopAddress);
    if (a06xS06xS === 0) return false;
    const movoff = L.findBytes(L.le32(a06xS06xS), L.processStartAddress, L.processStopAddress);
    if (movoff === 0) return false;
    const funcstart = [0x55, 0x57, 0x56];
    const func = L.reverseFindBytes(funcstart, movoff - 0x200, movoff);
    if (func === 0) return false;
    return L.NewHook({ address: func, type: L.USING_STRING | L.CODEC_UTF8 | L.NO_CONTEXT, offset: L.stackoffset(2) }, 'Suika2_06x');
}

const E = L.engine({
    name: 'Suika2',
    check: () => {
        if (L.processName_lower === 'suika.exe') return true;
        const suika2copyright = L.aToBytes('Suika2: Copyright'); // sizeof - 1: without the NUL
        return 0 !== L.findBytes(suika2copyright, L.processStartAddress, Math.min(L.processStopAddress, L.processStartAddress + 0x200000));
    },
    certain: false,
    attach() {
        const _1 = Suika2_msvcrt();
        const _2 = Suika2_06x();
        return _1 || _2;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
