// Tanuki.js: LunaHook's Tanuki engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Tanuki.cpp and Tanuki.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** jichi 9/14/2013
 *  TanukiSoft (*.tac)
 *
 *  Seems to be broken for new games in 2012 such like となりの...
 *
 *  微少女: /HSN4@004983E0 (off 4, type 0x401)
 *  隣りの...: /HSN-8@200FE7:TONARINO.EXE (off -0xc, type 0x441)
 */
function InsertTanukiHook() {
    for (const i of L.findBytesAll(L.le32(0x8140), L.processStartAddress, L.processStopAddress - 4)) {
        const j = L.findEnclosingAlignedFunction(i, 0x400);
        if (j) { // jichi 9/14/2013: might crash the game without admin priv
            return L.NewHook({ address: j, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT }, 'TanukiSoft');
        }
    }
    return false;
}

function InsertTanukiHook2() {
    const bytes = [
        XX, 0x9F, 0x88, 0x00, 0x00,
        0x66];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x1000);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING, lineSeparator: '\\n' }, 'Tanuki');
}

// 現実が見えてきたので少女を愛するのを辞めました。
// 不打补丁Tanuki找不到，打了两者都可以。
function t3() {
    const bytes = [
        0x83, 0xfe, 0x0d,
        0x0f, 0x84, ...XX4,
        0x57,
        0xe8, ...XX4,
        0x83, 0xc4, 0x04,
        0x85, 0xc0,
        0x0f, 0x85, ...XX4,
        0x33, 0xff,
        0x39, 0x7d, XX,
        0x74, XX,
        0x8a, 0x55, XX,
        0xb9, 0x00, 0x02, 0x00, 0x00,
        0x84, 0xd2,
        0xb8, 0x00, 0x23, 0x00, 0x00,
        0x0f, 0x44, 0xc1,
        0x8b, 0x8d, ...XX4,
        0x8a, 0x31,
        0x8b, 0xc8,
        0x81, 0xc9, 0x00, 0x14, 0x00, 0x00,
        0x84, 0xf6,
        0x0f, 0x45, 0xc8,
        0x84, 0xd2,
        0x75, XX,
        0x84, 0xf6,
        0x74, XX,
        0x8b, 0xf9,
        0x81, 0xcf, 0x00, 0x30, 0x00, 0x00,
        0xe9, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x300);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING,
        filter_fun(buffer) { L.StringReplacerA(buffer, '\x98\x87', '\x81\x5c\x81\x5c'); },
    }, 'Tanuki3');
}

const E = L.engine({
    name: 'Tanuki',
    check: { FILE: '*.tac' },
    attach() {
        const b1 = InsertTanukiHook();
        const b2 = InsertTanukiHook2();
        const b3 = t3();
        return b1 || b2 || b3;
    },
});

const E_last = L.engine({
    name: 'Tanuki_last',
    check: { FILE: '*.g2' },
    attach() { return InsertTanukiHook(); },
});

module.exports = [E, E_last];
if (!module.parent) L.run(E);
