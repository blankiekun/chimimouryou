// ACTGS.js: LunaHook's ACTGS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ACTGS.cpp and ACTGS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function hook2() {
    // きつね色の子守唄
    const bytes = [
        0x57,
        0xe8, ...XX4, // strlen
        0x59,
        0x89, 0x45, 0xfc,
        0x8b, 0x4d, 0xfc,
        0x41,
        0x51,
        0xe8, ...XX4, // new
        0x59,
        0x8b, 0xf0,
        0x89, 0x73, 0x08,
        0x85, 0xf6];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'ACTGS2');
}

const E = L.engine({
    name: 'ACTGS',
    check: { RESOURCE_STR: 'ACTRESS Game System' },
    attach() {
        if (hook2()) return true;
        const bytes = [
            0x0F, 0xBE, 0xD0,
            0x83, 0xFA, 0x20,
            0x74, XX,
            0x83, 0xfa, 0x09,
            0x75, XX];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING, filter_fun: L.all_ascii_Filter }, 'ACTGS');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
