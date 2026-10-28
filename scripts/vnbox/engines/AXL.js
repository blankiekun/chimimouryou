// AXL.js: LunaHook's AXL engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AXL.cpp and AXL.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertAXLHook() {
    // キミの声がきこえる
    const bytes = [0x0f, 0x95, 0xc2, 0x33, 0xc0, 0xB9, 0x41, 0x00, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x1000);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(4), type: L.USING_STRING }, 'AXL');
}

function hook2() {
    // 剣乙女ノア
    // Maria～天使のキスと悪魔の花嫁～
    const bytes = [
        0x55, 0x8b, 0xec,
        0x56,
        0x8b, 0xf0,
        0x3b, 0x9e, 0x8c, 0xf8, 0x00, 0x00,
        0x57];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), split: L.regoffset('eax'), type: L.USING_SPLIT }, 'TAILWIND');
}

const E = L.engine({
    name: 'AXL',
    check: { FILE: 'script.arc' },
    certain: false,
    attach() { return InsertAXLHook() || hook2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
