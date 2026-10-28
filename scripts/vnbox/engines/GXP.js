// GXP.js: LunaHook's GXP engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GXP.cpp and GXP.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: InsertGXP1Hook (it walks code with LunaHook's disasm() instruction-length decoder, which libLuna lacks);
// the embed parts of ScenarioHook1/2 (hook2a, hookAfter and the second NewHook at addr + 5, which only restores
// the text hook2a overwrote); the commented-out PopupHook1/OtherHook.
'use strict';
const L = require('./libLuna.js');

/**
 *  jichi 5/11/2014: Executable description shows "AVGEngineV2"
 *
 *  Old logic of InsertGXP1Hook: find 66 83 3c 70 00 (CMP WORD PTR DS:[EAX+ESI*2],0x0), take the first push
 *  after it, then the first long call after the push: the text is in arg1, character by character.
 */

// InsertGXP1Hook: needs disasm(), not ported.
function InsertGXP1Hook() {
    return false;
}

function InsertGXP2Hook() {
    const bytes = [
        0x0f, 0x5b,                         // 00A78845   0F5B             ???                                      ; Unknown command
        0xc9,                               // 00A78847   C9               LEAVE
        0xf3, 0x0f, 0x11, 0x44, 0x24, 0x44, // 00A78848   F3:0F114424 44   MOVSS DWORD PTR SS:[ESP+0x44],XMM0
        0xf3, 0x0f, 0x11, 0x4c, 0x24, 0x48, // 00A7884E   F3:0F114C24 48   MOVSS DWORD PTR SS:[ESP+0x48],XMM1
        0xe8,                               // 00A78854   E8 37040000      CALL .00A78C90  ; jichi: here's the target function to hook to, text char on the stack[0]
    ];
    const addr_offset = bytes.length - 1; // 0x00a78854 - 0x00a78845
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        type: L.CODEC_UTF16 | L.NO_CONTEXT | L.DATA_INDIRECT | L.FIXING_SPLIT | L.USING_STRING,
    }, 'GXP2');
}

function InsertGXPHook() {
    let ok = InsertGXP1Hook();
    ok = InsertGXP2Hook() || ok;
    return ok;
}

// TextUnionW (util/textunion.h, wchar_t): chars[8] or text pointer at 0x0, size at 0x10, capacity at 0x14
function textUnionW(arg) {
    const size = L.u32(arg + 0x10), capacity = L.u32(arg + 0x14);
    const text = capacity < 8 ? arg : L.u32(arg);
    if (size <= 0 || size > capacity) return null; // isValid(): also the text must be writable and of length size
    if (!L.isAddressReadable(text, size * 2) || L.wcslen(text) !== size) return null;
    return L.readW(text, size);
}

function isBadText(text) {
    return text.charCodeAt(0) <= 127 || text.charCodeAt(text.length - 1) <= 127 // skip ascii text
        || text.includes('＿'); // Skip system text containing: ＿
}

// ScenarioHook1 (old GXP1) reads the text at arg1 + 0x4, ScenarioHook2 (new GXP2) at arg1
function scenarioText(delta) {
    return (context, hp, buffer) => {
        const text = textUnionW(context.stack[0] + delta);
        if (text === null) return;
        if (isBadText(text)) return;
        buffer.fromW(text);
    };
}

function scenarioAttach(bytes, retcheck, name, delta, startAddress, stopAddress) {
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    let count = 0;
    const fun = (addr) => {
        const retaddr = addr + 5;
        if (retcheck(retaddr)) return true;
        const succ = L.NewHook({
            address: addr,
            text_fun: scenarioText(delta),
            type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT,
            lineSeparator: '%r',
        }, name);
        count += 1;
        return succ; // replace all functions
    };
    L.iterNearCallAddress(fun, addr, startAddress, stopAddress);
    return count > 0;
}

/**
 *  ScenarioHook1. Sample game: 塔の下のエクセルキトゥス体験版
 *  Scenario caller, text in the struct of arg1 + 0x4.
 */
function scenarioHook1(startAddress, stopAddress) {
    const bytes = [
        0xeb, 0x02,             // 01313bb6   eb 02            jmp short trial.01313bba
        0x8b, 0xc5,             // 01313bb8   8bc5             mov eax,ebp
        0x8b, 0x54, 0x24, 0x18, // 01313bba   8b5424 18        mov edx,dword ptr ss:[esp+0x18]
        0x8d, 0x0c, 0x51,       // 01313bbe   8d0c51           lea ecx,dword ptr ds:[ecx+edx*2]
        0x8d, 0x1c, 0x3f,       // 01313bc1   8d1c3f           lea ebx,dword ptr ds:[edi+edi]
    ];
    return scenarioAttach(bytes, (retaddr) => {
        if (L.u32(retaddr) !== 0x0c244c8a) return true;
        if (L.u8(retaddr) === 0x4f ||
            (L.u32(retaddr) & 0x00ff00ff) === 0x0024008b) // skip truncated texts
            return true;
        return false;
    }, 'EmbedGXP', 4, startAddress, stopAddress);
}

// ScenarioHook2 (new GXP2)
function scenarioHook2(startAddress, stopAddress) {
    const bytes = [
        0x8d, 0x04, 0x3f, // 08159fd  |. 8d043f         lea eax,dword ptr ds:[edi+edi]	; jichi: edi *= 2 for wchar_t
        0x50,             // 0815a00  |. 50             push eax	; jichi: size
        0x8d, 0x04, 0x4b, // 0815a01  |. 8d044b         lea eax,dword ptr ds:[ebx+ecx*2]
        0x50,             // 0815a04  |. 50             push eax	; jichi: source text
        0x52,             // 0815a05  |. 52             push edx	; jichi: target text
    ];
    return scenarioAttach(bytes, (retaddr) => {
        if (L.u16(retaddr) !== 0x458a) return true;
        if (L.u8(retaddr) === 0xa1) return true;
        return false;
    }, 'EmbedGXP2', 0, startAddress, stopAddress);
}

function attach() {
    const startAddress = L.processStartAddress, stopAddress = L.processStopAddress;
    if (scenarioHook2(startAddress, stopAddress)) {
    } else if (scenarioHook1(startAddress, stopAddress)) {
    } else {
        return false;
    }
    return true;
}

const E = L.engine({
    name: 'GXP',
    check: { FILE: '*.gxp' },
    attach() {
        const _ = InsertGXPHook();
        return attach() || _;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
