// Syuntada.js: LunaHook's Syuntada engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Syuntada.cpp and Syuntada.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

/** jichi 2/6/2015 Syuntada
 *  Sample game: [140816] [平安亭] カノジョのお母さんは好きですか-- /HA-18@6944C:kanojo.exe
 *  (off -0x1c, length_offset 1, type 0x44; the hook is at the `test edi,edi` of the drawing function,
 *  where ebp holds the Shift-JIS character)
 */
function InsertSyuntadaHook() {
    const bytes = [
        0x4a,                               // 0046943d   4a               dec edx
        0x23, 0xd1,                         // 0046943e   23d1             and edx,ecx
        0x69, 0xd2, 0x00, 0x0f, 0x00, 0x00, // 00469440   69d2 000f0000    imul edx,edx,0xf00
        0x8b, 0xca,                         // 00469446   8bca             mov ecx,edx
        0x89, 0x4c, 0x24, 0x24,             // 00469448   894c24 24        mov dword ptr ss:[esp+0x24],ecx
        0x85, 0xff,                         // 0046944c   85ff             test edi,edi    ; jichi: hook here
        0x74, 0x3a,                         // 0046944e   74 3a            je short .0046948a
    ];
    const addr_offset = 0x0046944c - 0x0046943d;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.regoffset('ebp'), type: L.CODEC_ANSI_BE }, 'Syuntada'); // 0x4
}

function __() {
    // 平凡な奥さんは好きですか～真面目な主婦をエッチ漬けにしちゃおう!～
    // 奪母姦
    // 友達のお母さんは好きですか？～息子の友人にハマったオバちゃん妻～
    const bytes = [
        0x81, 0xFD, 0x41, 0x81, 0x00, 0x00,
        0x7C, XX,
        0x81, 0xFD, 0x9A, 0x82, 0x00, 0x00,
        0x7E];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x1000);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.USING_STRING }, 'Syuntada');
}

// jichi 2/6/2015 平安亭: dPi.dat, dPih.dat, dSc.dat, dSch.dat, dSo.dat, dSoh.dat, dSy.dat
const E = L.engine({
    name: 'Syuntada',
    check: { FILE: 'dSch.dat' },
    attach() { return InsertSyuntadaHook() || __(); },
});

module.exports = E;
if (!module.parent) L.run(E);
