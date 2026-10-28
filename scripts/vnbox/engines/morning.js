// morning.js: LunaHook's morning engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/morning.cpp and morning.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function mov_xl_exx(reg) {
    let off = -1;
    reg = reg & 7;
    switch (reg) {
    case 3:
        off = L.regoffset('ebx');
        break;
    case 0:
        off = L.regoffset('eax');
        break;
    case 1:
        off = L.regoffset('ecx');
        break;
    case 2:
        off = L.regoffset('edx');
        break;
    case 6:
        off = L.regoffset('esi');
        break;
    case 7:
        off = L.regoffset('edi');
        break;
    }
    return off;
}

function shiftjis81() {
    // morning
    /* if (((unsigned __int8)*a7 < 0x81u || (unsigned __int8)*a7 > 0x9Fu)
        && ((unsigned __int8)*a7 < 0xE0u || (unsigned __int8)*a7 > 0xFCu)) */
    const bytes81 = [
        0x8A, XX,
        0x81, XX, 0x81, 0x00, 0x00, 0x00];
    const bytes81eax = [
        0x8A, XX,
        XX, 0x81, 0x00, 0x00, 0x00];

    let idx = 0;
    let succ = false;
    for (const bs of [bytes81, bytes81eax]) {
        for (const addr of L.SearchMemory(bs, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
            const jumpxxop = L.u8(addr + (idx ? 7 : 8));
            if (jumpxxop < 0x7c || jumpxxop > 0x7f) continue;
            const off = mov_xl_exx(L.u8(addr + 1));
            if (off !== -1) continue; // as in the C++ (regoffset is never -1, so no hook is made)
            succ = L.NewHook({ address: addr, offset: off, type: L.USING_STRING | L.NO_CONTEXT }, 'shiftjis819fefc') || succ;
        }
        idx += 1;
    }

    return succ;
}

const E = L.engine({
    name: 'morning',
    check: { FILE: '*.ttd' },
    certain: false,
    attach() { return shiftjis81(); },
});

module.exports = E;
if (!module.parent) L.run(E);
