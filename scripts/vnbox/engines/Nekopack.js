// Nekopack.js: LunaHook's Nekopack engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Nekopack.cpp and Nekopack.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/**
 *  mireado 8/01/2016: Add NekoPack hook
 *
 *  See: http://sakuradite.com/topic/1470
 *  https://arallab.hided.net/board_codetalk/2605967
 *
 *  [Pure More] 少女アクティビティ_trial 1.01
 *
 *  base: 0x4000000
 *  binary pattern :: 558BEC81C4C4FDFFFFB8
 */
function InsertNekopackHook() {
    const bytes = [
        0x55,                               // 0069637C  /$  55            PUSH EBP
        0x8b, 0xec,                         // 0069637D  |.  8BEC          MOV EBP,ESP
        0x81, 0xc4, 0xC4, 0xFD, 0xFF, 0xFF, // 0069637F  |.  81C4 C4FDFFFF ADD ESP,-23C
        0xb8, ...XX4,                       // 00696385  |.  B8 A8FF7900   MOV EAX,OFFSET 0079FFA8
        0x53,                               // 0069638A  |.  53            PUSH EBX
        0x56,                               // 0069638B  |.  56            PUSH ESI
        0x57,                               // 0069638C  |.  57            PUSH EDI
        0x8b, 0x5d, 0x08,                   // 0069638D  |.  8B5D 08       MOV EBX,DWORD PTR SS:[ARG.1]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);

    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'NekoPack');
}

function LOVEMILF() {
    // LOVEMILF
    // https://vndb.org/v5259
    const bytes = [
        0x55, 0x8b, 0xec,
        0x83, 0xe4, 0xf8,
        0x83, 0xec, XX,
        0x56,
        0x8b, 0xf1,
        0x8b, 0x06,
        0x8b, 0x90, ...XX4,
        0xc7, 0x44, XX, XX, 0xf1, 0x00, 0x00, 0x00,
        0xff, 0xd2,
        0x8b, 0x4d, 0x14,
        0x51,
        0x8b, 0x4d, 0x10,
        0x8d, 0x54, XX, XX,
        0x52,
        0x8b, 0x55, 0x0c,
        0x51,
        0x8b, 0x4d, 0x08,
        0x52,
        0x89, 0x44, XX, XX,
        0x8b, 0x06];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);

    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.USING_STRING }, 'LOVEMILF');
}

const E = L.engine({
    name: 'Nekopack',
    check: { FILE: '*.dat' },
    certain: false,
    attach() { return InsertNekopackHook() || LOVEMILF(); },
});

module.exports = E;
if (!module.parent) L.run(E);
