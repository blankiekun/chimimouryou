// Overflow.js: LunaHook's Overflow engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Overflow.cpp and Overflow.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const MAX_REL_ADDR = 0x00300000;

function InsertSekaiProject1Hook() {
    /*
     * Sample games:
     * https://vndb.org/v1193
     */
    const bytes = [
        0xCC, // int 3
        0x83, 0xEC, 0x10, // sub esp,10    << hook here
        0x8B, 0x44, 0x24, 0x14, // mov eax,[esp+14]
        0x53, // push ebx
        0x56, // push esi
        0x50, // push eax
        0x8B, 0xD9, // mov ebx,ecx
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr + 1, offset: L.stackoffset(1), type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT }, 'SekaiProject1');
}

function InsertSekaiProject2Hook() {
    /*
     * Sample games:
     * https://vndb.org/r21174
     */
    const bytes = [
        0xC7, 0x45, 0xDC, 0x00, 0x00, 0x00, 0x00, // mov [ebp-24],00000000        << hook here
        0xEB, 0x09, // jmp "SCHOOLDAYS HQ.exe"+4C821
        0x8B, 0x45, 0xDC, // mov eax,[ebp-24]
        0x83, 0xC0, 0x01, // add eax,01
        0x89, 0x45, 0xDC, // mov [ebp-24],eax
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(21), type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT }, 'SekaiProject2');
}

function InsertSekaiProject3Hook() {
    /*
     * Sample games:
     * https://vndb.org/r39989
     */
    const bytes = [
        0xCC, // int 3
        0x8B, 0x44, 0x24, 0x04, // mov eax,[esp+04]     << hook here
        0x83, 0xEC, 0x14, // sub esp,14
        0x55, // push ebp
        0x56, // push esi
        0x57, // push edi
        0x8B, 0xF9, // mov edi,ecx
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr + 1, offset: L.stackoffset(1), type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT }, 'SekaiProject3');
}

const E = L.engine({
    name: 'Overflow',
    check: { FILE_ALL: ['Packs/*.GPK'] },
    certain: false,
    attach() { return InsertSekaiProject1Hook() || InsertSekaiProject2Hook() || InsertSekaiProject3Hook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
