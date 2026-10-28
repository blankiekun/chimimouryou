// Exp.js: LunaHook's Exp engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Exp.cpp and Exp.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

const VNR_TEXT_CAPACITY = 1500;

let lasttext = 0; // static DWORD lasttext
function SpecialHookExp(context, hp, buffer, split) {
    const arg1 = context.stack[1]; // mov eax,dword ptr ss:[ebp+0x8]
    const arg3 = context.stack[3]; // size - 1
    if (arg1 && arg3) {
        const text = L.u32(arg1);
        if (text)
            if (!(text > lasttext && text < lasttext + VNR_TEXT_CAPACITY)) { // text is not a subtext of lastText
                lasttext = text; // mov edx,dword ptr ds:[eax]

                buffer.fromCharPtr(text);
                split.value = context.stack[7]; // reduce repetition, but still have sub-text repeat
            }
    }
}

function InsertExpHook() {
    const bytes = [
        0x55, // 00258020   55               push ebp  ; jichi: hook here, function starts, text in [arg1], size+1 in arg3
        0x8b, 0xec, // 00258021   8bec             mov ebp,esp
        0x8b, 0x45, 0x08, // 00258023   8b45 08          mov eax,dword ptr ss:[ebp+0x8]
        0x83, 0xec, 0x08, // 00258026   83ec 08          sub esp,0x8
        0x85, 0xc0, // 00258029   85c0             test eax,eax
        0x0f, 0x84, ...XX4, // 0025802b   0f84 d8000000    je .00258109
        0x83, 0x7d, 0x10, 0x00, // 00258031   837d 10 00       cmp dword ptr ss:[ebp+0x10],0x0
        0x0f, 0x84, ...XX4, // 00258035   0f84 ce000000    je .00258109
        0x8b, 0x10, // 0025803b   8b10             mov edx,dword ptr ds:[eax] ; jichi: edx is the text
        0x8b, 0x45, 0x0c, // 0025803d   8b45 0c          mov eax,dword ptr ss:[ebp+0xc]
        0x53, // 00258040   53               push ebx
        0x56, // 00258041   56               push esi
        0xc7, 0x45, 0xf8, 0x00, 0x00, 0x00, 0x00, // 00258042   c745 f8 00000000 mov dword ptr ss:[ebp-0x8],0x0
        0x89, 0x45, 0xfc, // 00258049   8945 fc          mov dword ptr ss:[ebp-0x4],eax
        0x57, // 0025804c   57               push edi
        0x8d, 0x49, 0x00, // 0025804d   8d49 00          lea ecx,dword ptr ds:[ecx]
        0x8a, 0x0a]; // 00258050   8a0a             mov cl,byte ptr ds:[edx]  ; jichi: text accessed in edx
    const addr_offset = 0;
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) {
        return false;
    }

    return L.NewHook({
        address: addr + addr_offset,
        type: L.NO_CONTEXT | L.USING_STRING, // NO_CONTEXT to get rid of floating address
        text_fun: SpecialHookExp,
    }, 'EXP'); // FIXME: text displayed line by line
}

const E = L.engine({
    name: 'Exp',
    check: { FILE: 'model\\*.hed' },
    attach() { return InsertExpHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
