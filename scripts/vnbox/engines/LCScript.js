// LCScript.js: LunaHook's LCScript engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/LCScript.cpp and LCScript.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: hookafter and hook2 (the second "EmbedLCSE" hook that swaps in the translation), the EMBED flags,
// dynamiccodec / patch_fun_ptrs, and the `data_` buffer they share; the dyna address from patchEncoding only fed those.
'use strict';
const L = require('./libLuna.js');

const LCSE_0 = '[0]'; // pseudo separator

// Skip trailing 0203
// text is a byte string; returns [offset of the first kept byte, trimmed size]
function trim(text, size) {
    let start = 0;
    let length = size;
    while (length && text.charCodeAt(start) <= 127) { // remove all leading ASCII characters including zeros
        start++;
        length--;
    }
    while (length && text.charCodeAt(start + length - 1) === 0) // remove all trailing zeros
        length--;
    // remove all trailing illegal double-characters
    const MinimumByte = 0x6; // the same as dynamicEncodingMinimumByte
    while (length >= 2 && text.charCodeAt(start + length - 1) < MinimumByte && text.charCodeAt(start + length - 2) < MinimumByte)
        length -= 2;
    return [start, length];
}

/**
 *  Sample game: 春恋＊乙女～乙女の園でごきげんよう。～
 *  Name/scenario splitter: 01 ()
 *  New line splitter: 0203 ()
 */
let textBaseAddress_ = 0, // 0042FC03   8B15 E8234A00    MOV EDX,DWORD PTR DS:[0x4A23E8]
    textOffset_ = 0;      // 0042FC14   8B92 44290000    MOV EDX,DWORD PTR DS:[EDX+0x2944]

const isalpha = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

function hook1(context, hp, buffer, role) {
    const size = (context.eax | 0) - 1;
    if (size <= 0) return;

    let edx, esi;
    {
        edx = L.u32(textBaseAddress_);    // 0042FC03   8B15 E8234A00    MOV EDX,DWORD PTR DS:[0x4A23E8]
        edx = L.u32(edx + textOffset_);   // 0042FC14   8B92 44290000    MOV EDX,DWORD PTR DS:[EDX+0x2944]
        esi = L.u32(context.esi + 0x4);   // 0042FC0D   8B76 04          MOV ESI,DWORD PTR DS:[ESI+0x4]
        esi = (edx + esi + 0x4) >>> 0;    // 0042FC21   8D7432 04        LEA ESI,DWORD PTR DS:[EDX+ESI+0x4]
    }

    const text = L.readA(esi, size + 1);
    if (!text.charCodeAt(0)
        || text.charCodeAt(size)                                        // text length not verified since there could be trailing zeros
        || (isalpha(text.charCodeAt(0)) && isalpha(text.charCodeAt(1))) // Sample system text in 恋姫無双: bcg_剣道場a
        || L.all_ascii(L.readA(esi)))
        return;

    const [start, trimmedSize] = trim(text, size);
    if (trimmedSize <= 0) return;

    // role = scenario when stack[8 + 3] === 0x400 (Engine::ScenarioRole): not used by VNBox
    buffer.fromA(L.strReplace(text.substr(start, trimmedSize), '\0', LCSE_0));
}

function attach(startAddress, stopAddress) {
    const bytes = [
        0x8d, 0x74, 0x32, 0x04, // 0042fc21   8d7432 04        lea esi,dword ptr ds:[edx+esi+0x4]
        0xc1, 0xe9, 0x02,       // 0042fc25   c1e9 02          shr ecx,0x2
        0xf3, 0xa5              // 0042fc28   f3:a5            rep movs dword ptr es:[edi],dword ptr ds[esi]
    ];
    const addr2 = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr2) return false;

    const addr1 = addr2 + 0x0042fbf9 - 0x0042fc21;
    if (L.u8(addr1) !== 0x50) return false; // push_eax

    {
        let addr = addr2 + 0x0042fc03 - 0x0042fc21;
        if (L.u16(addr) !== 0x158b) return false; // 0042FC03   8B15 E8234A00    MOV EDX,DWORD PTR DS:[0x4A23E8]
        addr += 2;
        textBaseAddress_ = L.u32(addr);
    }
    {
        let addr = addr2 + 0x0042fc14 - 0x0042fc21;
        if (L.u16(addr) !== 0x928b) return false; // 0042FC14   8B92 44290000    MOV EDX,DWORD PTR DS:[EDX+0x2944]
        addr += 2;
        textOffset_ = L.u32(addr);
    }
    return L.NewHook({
        address: addr1,
        text_fun: hook1,
        type: L.NO_CONTEXT,
        lineSeparator: '\x01',
    }, 'EmbedLCSE');
}

// patchEncoding only found the isLeadByteChar function for patch_fun (skipped)

const E = L.engine({
    name: 'LCScript',
    // jichi 3/19/2014: LC-ScriptEngine, GetGlyphOutlineA
    check: () => L.processName.includes('lcsebody') || L.processName.startsWith('lcsebo~') || L.CheckFile('lcsebody*'),
    files: ['lcsebody*'],
    attach() {
        if (!attach(L.processStartAddress, L.processStopAddress)) return false;
        return true;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
