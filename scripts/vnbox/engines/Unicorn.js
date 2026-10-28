// Unicorn.js: LunaHook's Unicorn engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Unicorn.cpp and Unicorn.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX2, XX4 } = L;

/**
 *  jichi 9/16/2013: a-unicorn / gesen18
 *  See (CaoNiMaGeBi): http://tieba.baidu.com/p/2586681823
 *  Pattern: 2bce8bf8
 *      2bce      sub ecx,esi ; hook here
 *      8bf8      mov eds,eax
 *      8bd1      mov edx,ecx
 */
function InsertUnicornHook() {
    // pattern: 2bce8bf8
    const bytes = [
        0x2b, 0xce, // sub ecx,esi ; hook here
        0x8b, 0xf8, // mov edi,eax
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        type: L.NO_CONTEXT | L.DATA_INDIRECT,
        offset: L.regoffset('edi'),
        address: addr,
    }, 'Unicorn');
}

// ---- ScenarioHook ----
// Engine::TextRole: ScenarioRole = 1, NameRole = 2 (the hook sets them as the split)
const ScenarioRole = 1, NameRole = 2;
// TextStorage (restore/save write the translation back into the game: embed) and textCache_ (only filled by the
// skipped embed_fun) are left out; hookafter2, hookAfter and the second hook at afterAddress are embed only.
let textOffset_ = 0; // = 0x114

// 三極姫4: 00 00 00 00 ff ff ff ff ff ff ff ff 0a
// 戦極姫6: 00 00 00 00 be be be ff ff ff ff ff 0a
function isTextSeparator(text) {
    return L.u32(text) === 0 && L.u32(text + 8) === 0xffffffff && L.u8(text + 12) === 0x0a;
}

// TextStorage::load: the text and the lines after it (separated by 12 bytes)
function loadText(text) {
    let data = L.readA(text);
    let p = text + L.strlen(text);
    for (; isTextSeparator(p); p += L.strlen(p)) {
        p += 12;
        data += L.readA(p);
    }
    return data;
}

function scenarioHookBefore(s, hp, buffer, role) {
    const retaddr = s.stack[0];
    role.value = 0;
    if ((L.u32(retaddr - 5 - 8) & 0x00ffffff) === 0x2484c6) // 004B771B   C68424 AC060000 01 MOV BYTE PTR SS:[ESP+0x6AC],0x1
        role.value = ScenarioRole;
    else if ((L.u32(retaddr - 5 - 8) & 0x00ffffff) === 0x0024848d // 0049A844   8D8424 EC010000  LEA EAX,DWORD PTR SS:[ESP+0x1EC]
        || (L.u32(retaddr - 5 - 4) & 0x00ffffff) === 0x00244489) // 004B76BE   894424 14        MOV DWORD PTR SS:[ESP+0x14],EAX
        role.value = NameRole;
    if (!role.value) return;

    const text = L.u32((s.ecx + textOffset_) >>> 0); // [ecx+0x114]
    if (!L.u8(text) || L.all_ascii(L.readA(text))) return;

    // Engine::isAddressWritable(text) (the multi-line load is only used on writable memory): libLuna has no
    // writable check, so readable stands in
    const textStorageEnabled = role.value === ScenarioRole && L.isAddressReadable(text);
    let oldData;
    if (textStorageEnabled) oldData = loadText(text);
    else oldData = L.readA(text);

    if (role.value === NameRole) oldData = L.strReplace(oldData, '\x81\x40'); // remove spaces in the middle of names
    buffer.fromA(oldData);
}

function scenarioAttach(startAddress, stopAddress) {
    const bytes = [
        0x8b, 0x81, ...XX4, // 004b1c50   8b81 14010000    mov eax,dword ptr ds:[ecx+0x114]	; jichi: source text in eax
        0x8b, 0x54, 0x24, 0x04, // 004b1c56   8b5424 04        mov edx,dword ptr ss:[esp+0x4]		; jichi: target address in edx
        0x56, // 004b1c5a   56               push esi
        0x33, 0xf6, // 004b1c5b   33f6             xor esi,esi
        0x80, 0x38, 0x00, // 004b1c5d   8038 00          cmp byte ptr ds:[eax],0x0
    ];
    const beforeAddress = L.findBytes(bytes, startAddress, stopAddress);
    if (!beforeAddress) return false;
    const afterAddress = L.findBytes(L.le32(0xcc0004c2), beforeAddress, stopAddress);
    if (!afterAddress || afterAddress - beforeAddress > 0x200) return false; // should within 0x42
    textOffset_ = L.u32(beforeAddress + 2); // 0x114
    return L.NewHook({
        address: beforeAddress,
        text_fun: scenarioHookBefore,
        offset: L.stackoffset(1),
        lineSeparator: '\\n',
        type: 0,
    }, 'EMbedUnicorn');
}

// ---- OtherHook ----
function otherHookBefore(s, hp, buffer) {
    const retaddr = s.stack[0];
    switch (L.u16(retaddr)) {
        case 0xeed9: // 004769F8   D9EE             FLDZ
        case 0x08eb: // 004135BA   EB 08            JMP SHORT .004135C4
            break;
        default:
            return;
    }
    const text = s.stack[1]; // arg1
    const size = s.stack[2] | 0; // arg2
    if (!text || size <= 2 // avoid painting individual character
        || L.strlen(text) !== size || L.all_ascii(L.readA(text))) return;
    buffer.from(text, size);
}

function otherAttach(startAddress, stopAddress) {
    const bytes = [
        0x72, 0x0E, // 00403C42   72 0E            JB SHORT .00403C52
        0x8B, 0x46, 0x04, // 00403C44   8B46 04          MOV EAX,DWORD PTR DS:[ESI+0x4]
        0x5F, // 00403C47   5F               POP EDI
        0xC6, 0x00, 0x00, // 00403C48   C600 00          MOV BYTE PTR DS:[EAX],0x0
        0x8B, 0xC6, // 00403C4B   8BC6             MOV EAX,ESI
        0x5E, // 00403C4D   5E               POP ESI
        0x5D, // 00403C4E   5D               POP EBP
        0xC2, 0x08, 0x00, // 00403C4F   C2 0800          RETN 0x8
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun: otherHookBefore,
        type: L.NO_CONTEXT,
        lineSeparator: '\\n',
    }, 'EMbedUnicornOther');
}

const E = L.engine({
    name: 'Unicorn',
    check: { FILE_ANY: ['*.szs', 'Data\\*.szs'] },
    attach() {
        const embed = scenarioAttach(L.processStartAddress, L.processStopAddress);
        if (embed) otherAttach(L.processStartAddress, L.processStopAddress);
        return InsertUnicornHook() || embed;
    },
});

const E2 = L.engine({
    name: 'Unicorn_Anesen',
    check: { FILE_ALL: ['BGM', 'DATA', 'MGD', 'MSD', 'SE', 'VOICE'] },
    attach() {
        const bytes = [
            0x83, 0xFF, 0x20,
            ...XX2,
            0x0F, 0x84, ...XX4,
            0x81, 0xFF, 0x40, 0x81, 0x00, 0x00,
            0x0F, 0x84];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ type: L.USING_STRING, offset: L.stackoffset(4), address: addr }, 'Unicorn_Anesen');
    },
});

module.exports = [E, E2];
if (!module.parent) { L.run(E); L.run(E2); }
