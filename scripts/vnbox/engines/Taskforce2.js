// Taskforce2.js: LunaHook's Taskforce2 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Taskforce2.cpp and Taskforce2.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function InsertTaskforce2Hook() {
    const bytes = [
        0x88, 0x02, // 005948de  |. 8802           |mov byte ptr ds:[edx],al
        0x42, // 005948e0  |. 42             |inc edx
        0x46, // 005948e1  |. 46             |inc esi
        0x3a, 0xc3, // 005948e2  |. 3ac3           |cmp al,bl
        0x74, 0x03, // 005948e4  |. 74 03          |je short taskforc.005948e9
        0x4f, // 005948e6  |. 4f             |dec edi
        0x75, 0xf3, // 005948e7  |.^75 f3          \jnz short taskforc.005948dc
        0x3b, 0xfb, // 005948e9  |> 3bfb           cmp edi,ebx ; jichi: hook here
    ];
    const addr_offset = bytes.length - 2;
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('ecx'), // text in ecx
        type: L.USING_STRING, // 0x41
        filter_fun: L.all_ascii_Filter,
    }, 'Taskforce2');
}

function InsertTaskforce2XHook() {
    const bytes = [0X8A, 0X07, 0X89, 0x7d, XX, 0X84, 0XC0, 0x0F];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edi'),
        type: L.USING_STRING | L.USING_SPLIT, // 0x41
        split: L.regoffset('eax'),
        filter_fun: L.all_ascii_Filter,
    }, 'Taskforce2');
}

// ---- ScenarioHook (embed_fun and hookafter left out) ----
function hookBefore(s, hp, buffer) {
    const capacity = s.stack[1] | 0; // arg 2, should always be 0x1000
    const text = s.stack[2]; // arg 3
    if (capacity <= 0 || !text || !L.u8(text)) return;
    buffer.fromCharPtr(text);
}

function scenarioAttach(startAddress, stopAddress) {
    const bytes = [
        0x8d, 0xbe, 0xa8, 0x02, 0x00, 0x00, // 0044a609   8dbe a8020000    lea edi,dword ptr ds:[esi+0x2a8]
        0x68, 0x00, 0x10, 0x00, 0x00, // 0044a60f   68 00100000      push 0x1000
        0x57, // 0044a614   57               push edi
        0xe8, // 0044a615   e8 5d4e1400      call .0058f477  ; jichi: called here
    ];
    const addr_offset = bytes.length - 1;
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        text_fun: hookBefore,
        type: L.USING_STRING | L.NO_CONTEXT,
    }, 'EmbedTaskforce');
}

const E = L.engine({
    name: 'Taskforce2',
    check: () => L.processName_lower.includes('taskforce2') || L.processName_lower.startsWith('taskfo~') || L.CheckFile('Taskforce2.exe'),
    files: ['Taskforce2.exe'],
    attach() {
        const b1 = InsertTaskforce2Hook();
        const b2 = InsertTaskforce2XHook();
        const b3 = scenarioAttach(L.processStartAddress, L.processStopAddress);
        return b1 || b2 || b3;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
