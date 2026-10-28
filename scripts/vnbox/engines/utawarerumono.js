// utawarerumono.js: LunaHook's utawarerumono engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/utawarerumono.cpp and utawarerumono.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function utawarerumonoh() {
    const bytes = [
        0x80, XX, 0x5C,
        0x75,
        //*a2 != 92 || a2[1] != 107
    ];
    const bytes2 = [
        0x80, XX, XX, XX, 0x5C,
        0x75];
    const addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    const addr2 = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (let addr of [addr1, addr2]) {
        if (!addr) continue;
        const funcstart = [0x51, 0x53];
        addr = L.reverseFindBytes(funcstart, addr - 0x100, addr);
        if (!addr) return false;
        succ = L.NewHook({
            address: addr,
            lineSeparator: '\\n',
            offset: L.stackoffset(1),
            type: L.CODEC_UTF8 | L.USING_STRING | L.NO_CONTEXT,
        }, 'utawarerumono') || succ;
    }
    return succ;
}

function utawarerumonoh2() {
    const bytes2 = [
        0x8b, 0xca,
        0xc1, 0xe9, 0x02,
        0xf3, 0xa5];
    const addr2 = L.SearchMemory(bytes2, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (const addr of addr2) {
        succ = L.NewHook({
            address: addr + 2,
            offset: L.regoffset('esi'),
            type: L.CODEC_UTF8 | L.USING_STRING | L.NO_CONTEXT,
            lineSeparator: '\\n',
        }, 'utawarerumono') || succ;
    }
    return succ;
}

const E = L.engine({
    name: 'utawarerumono',
    check: { FILE: 'Data/*.sdat' },
    certain: false,
    attach() {
        const b1 = utawarerumonoh();
        const b2 = utawarerumonoh2();
        return b1 || b2;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
