// Interheart.js: LunaHook's Interheart engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Interheart.cpp and Interheart.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'Interheart',
    check: { FILE: 'Pack\\*.fpk' },
    certain: false,
    attach() {
        // 人妻スイミング倶楽部
        // https://vndb.org/v18049
        const bytes = [
            0x50,
            0x8d, 0x4d, XX,
            // here
            0xe8, ...XX4,
            0x68, ...XX4, // push    offset asc_956B20               ; "$L"
            0x8d, 0x4d, XX,
            0xe8];
        let ok = false;
        for (const addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
            const asc_956B20_addr_addr = addr + 1 + 3 + 5 + 1;
            const asc_956B20_addr = L.i32(asc_956B20_addr_addr);
            if (L.u8(asc_956B20_addr) === 0x24 /* $ */ && L.u8(asc_956B20_addr + 1) === 0x4c /* L */) {
                ok = L.NewHook({ address: addr + 1 + 3, offset: L.regoffset('edx'), type: L.USING_STRING | L.NO_CONTEXT }, 'Interheart') || ok;
            }
        }
        return ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
