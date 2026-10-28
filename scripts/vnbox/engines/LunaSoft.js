// LunaSoft.js: LunaHook's LunaSoft engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/LunaSoft.cpp and LunaSoft.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: hookafter1 (embed_fun) and the lru_cache it fills, the EMBED flags, Engine::...Role assignments.
'use strict';
const L = require('./libLuna.js');

/** jichi 12/27/2014 LunaSoft */
function InsertLunaSoftHook() {
    const bytes = [
        0xcc,             // 0046c57e   cc               int3
        0xcc,             // 0046c57f   cc               int3
        0x55,             // 0046c580   55               push ebp       ; jichi: text in arg1
        0x8b, 0xec,       // 0046c581   8bec             mov ebp,esp
        0x83, 0xec, 0x08, // 0046c583   83ec 08          sub esp,0x8
        0x89, 0x4d, 0xf8, // 0046c586   894d f8          mov dword ptr ss:[ebp-0x8],ecx
        0x8b, 0x4d, 0xf8, // 0046c589   8b4d f8          mov ecx,dword ptr ss:[ebp-0x8]
        0x83, 0xc1, 0x1c, // 0046c58c   83c1 1c          add ecx,0x1c
        0xe8              // 0046c58f   e8 2cebf9ff      call .0040b0c0
    ];
    const addr_offset = 2;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.stackoffset(1), type: L.USING_STRING }, 'LunaSoft');
}

function InsertXXkata() {
    const addr = L.GetProcAddress(L.GetModuleHandleW('user32.dll'), 'wsprintfA');
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING | L.NO_CONTEXT, offset: L.stackoffset(3), filter_fun: L.all_ascii_Filter }, 'XXkata');
}

// ScenarioHook (Sample game: 悪堕ラビリンス). hookBefore is the text hook of the embed pair.
function hookBefore(context, hp, buffer, role) {
    const text = context.stack[1]; // arg1
    if (!text || !L.u8(text)) return; // || Util::allAscii(text))
    // role (scenario when the return address holds 0x5010458b): not used by VNBox
    buffer.fromCharPtr(text);
}
function attachScenario(startAddress, stopAddress) { // attach scenario
    let addr1, addr2;
    {
        const bytes1 = [
            0x89, 0x88, 0xac, 0x02, 0x00, 0x00, // 00487c1d   8988 ac020000    mov dword ptr ds:[eax+0x2ac],ecx
            0x8b, 0x55, 0xfc,                   // 00487c23   8b55 fc          mov edx,dword ptr ss:[ebp-0x4]
            0xd9, 0xee                          // 00487c26   d9ee             fldz
        ];
        addr1 = L.findBytes(bytes1, startAddress, stopAddress);
        if (!addr1) return false;
        addr1 = L.findEnclosingAlignedFunction(addr1);
        if (!addr1) return false;
    }
    {
        const bytes2 = [
            0x83, 0xe0, 0x0c, // 0042b266   83e0 0c          and eax,0xc
            0x83, 0xf8, 0x04, // 0042b269   83f8 04          cmp eax,0x4
            0x75, 0x07,       // 0042b26c   75 07            jnz short lus004.0042b275
            0xd9, 0xee        // 0042b26e   d9ee             fldz
        ];
        addr2 = L.findBytes(bytes2, startAddress, stopAddress);
        if (!addr2) return false;
        addr2 = L.findEnclosingAlignedFunction(addr2);
        if (!addr2) return false;
    }
    const hp = { address: addr1, text_fun: hookBefore, type: L.NO_CONTEXT };
    let succ = L.NewHook(hp, 'EMBEDLUNA');
    succ = L.NewHook({ ...hp, address: addr2 }, 'EMBEDLUNA') || succ;
    return succ;
}

function PrincessSoft() {
    if (!L.CheckFileAll(['pac/voice.hed', 'pac/voice.pac',
        'pac/se.hed', 'pac/se.pac',
        'pac/snd.hed', 'pac/snd.pac',
        'pac/vis.hed', 'pac/vis.pac',
        'pac/tak.hed', 'pac/tak.pac'])) return false;
    L.hookGDIFunctions(L.FindFunction('GetGlyphOutlineA'));
    return true;
}

const E = L.engine({
    name: 'LunaSoft',
    check: { FILE: 'Pac\\*.pac' },
    attach() {
        if (PrincessSoft()) return true;
        const b1 = InsertLunaSoftHook();
        const b2 = InsertXXkata();
        const embed = attachScenario(L.processStartAddress, L.processStopAddress);
        return b1 || b2 || embed;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
