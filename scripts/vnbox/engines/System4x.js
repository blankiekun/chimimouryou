// System4x.js: LunaHook's System4x engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/System4x.cpp and System4x.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertSystem43OldHook(hookName) {
    const bytes = [
        0xe8, ...XX4, //   005506a9  |. e8 f2fb1600    call rance01.006c02a0 ; hook here
        0x83, 0xc4, 0x0c, //   005506ae  |. 83c4 0c        add esp,0xc
        XX, //   005506b1  |. 5f             pop edi ; Artikash 2/9/2019 change these to wildcards: Evenicle 2 has the pops and moves switched order
        XX, //   005506b2  |. 5e             pop esi
        XX, XX, //   005506b3  |. b0 01          mov al,0x1
        0x5b, //   005506b5  |. 5b             pop ebx
        0xc2, 0x04, 0x00, //   005506b6  \. c2 0400        retn 0x4
        0xcc, 0xcc, // patching a few int3 to make sure that this is at the end of the code block
    ];
    const addr_offset = 0;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.stackoffset(1),
        split: L.regoffset('esp'),
        type: L.NO_CONTEXT | L.USING_SPLIT | L.USING_STRING,
    }, hookName);
}

function InsertSystem43NewHook(hookName) {
    const bytes = [
        0xe8, ...XX4, // 004eeb34   e8 67cb0100      call .0050b6a0  ; jichi: hook here, text on the top of the stack
        0x39, 0x6c, 0x24, 0x28, // 004eeb39   396c24 28        cmp dword ptr ss:[esp+0x28],ebp
        0x72, 0x0d, // 004eeb3d   72 0d            jb short .004eeb4c
        0x8b, 0x4c, 0x24, 0x14, // 004eeb3f   8b4c24 14        mov ecx,dword ptr ss:[esp+0x14]
        0x51, // 004eeb43   51               push ecx
        0xe8, // 004eeb44   e8 42dc1900      call .0068c78b
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.NO_CONTEXT | L.USING_STRING | L.USING_SPLIT | L.SPLIT_INDIRECT,
        split_index: 0x10, // use [[esp]+0x10] to differentiate name and thread
    }, hookName);
}

function System43aFilter(buffer) {
    L.CharReplacerA(buffer, '\n', ' ');
    if (buffer.viewA().includes('${')) L.StringFilterBetweenA(buffer, '${', '}');
}

function InsertSystem43aHook() {
    const bytes = [
        0xC7, 0x46, 0x10, ...XX4, // mov [esi+10],00000000
        0x72, 0x02, // jb dohnadohna.exe+1BFA7E
        0x8B, 0x36, // mov esi,[esi]
        0x8B, 0x4C, 0x24, 0x14, // mov ecx,[esp+14]
        0x57, // push edi
        0xC6, 0x06, 0x00, // mov byte ptr [esi],00   << hook here
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + bytes.length - 3,
        offset: L.regoffset('edx'),
        split: L.regoffset('esp'),
        type: L.NO_CONTEXT | L.USING_STRING | L.USING_SPLIT,
        filter_fun: System43aFilter,
    }, 'System43new');
}

function InsertSystem43bHook() {
    const bytes = [
        0x8B, 0xCE, // mov ecx,esi            << hook here
        0xE8, ...XX4, // call Oyakorankan.exe+13D890
        0x8B, 0x43, 0x04, // mov eax,[ebx+04]
        0x8D, 0x4C, 0x24, 0x10, // lea ecx,[esp+10]
        0x3B, 0xC8, // cmp ecx,eax
        0x73, 0x64, // jae Oyakorankan.exe+1403B2
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        split: L.stackoffset(12),
        type: L.USING_STRING | L.USING_SPLIT,
    }, 'System43b');
    return true;
}

function InsertSystem43Hook() {
    if (InsertSystem43aHook() || InsertSystem43bHook()) return true;

    const patched = !!L.GetModuleHandle('AliceRunPatch.dll');
    let ok = InsertSystem43OldHook(patched ? 'AliceRunPatch43' : 'System43');
    ok = InsertSystem43NewHook('System43+') || ok;
    return ok;
}

// ---- ScenarioHook (System 4.4; embed_fun, hookafter2, hookAfter and the hooks at addr + 5 left out) ----
// struct TextArgument (first argument of the scenario hook): ULONG *unknown[2]; LPCSTR text (+8); int size (+0xc,
// text data size including '\0'); int capacity (+0x10); ULONG split (+0x14)
function textArgumentValid(arg) {
    if (!L.isAddressReadable(arg, 0x18)) return false;
    const text = L.u32(arg + 8), size = L.i32(arg + 0xc), capacity = L.i32(arg + 0x10);
    if (!(size <= capacity && size >= 4 && text && L.isAddressReadable(text, size) && L.strlen(text) + 1 === size)) return false; // skip translating single text
    // skip text beginning / ending with ascii
    return L.u8(text) > 127 && L.u8(text + size - 3) > 127 && !L.readA(text).includes('\x81\x5e'); // "／"
}

function isOtherText(text) {
    const s = ['\x82\xa2\x82\xa2\x82\xa6', '\x82\xcd\x82\xa2'];
    return s.includes(text);
}

// hashes_ is only filled by the skipped embed_fun, so it stays empty
function scenarioHookBefore(context, hp, buffer) {
    const split = L.u32(context.ecx + 0x34);
    if (split > 0xff || (split && split < 0xf)) return;
    const arg = context.stack[0]; // arg1
    if (!arg || !textArgumentValid(arg)) return;
    const text = L.u32(arg + 8), size = L.i32(arg + 0xc);
    const str = L.readA(text);
    if (size < 0xf && split > 0 && !isOtherText(str)) return;
    // roles (name / scenario / other) are not used in VNBox
    buffer.fromCharPtr(text);
}

function scenarioAttach(startAddress, stopAddress) {
    const bytes = [
        0x53, // 005D3D90   53               PUSH EBX
        0x56, // 005D3D91   56               PUSH ESI
        0x8B, 0x74, 0x24, 0x0C, // 005D3D92   8B7424 0C        MOV ESI,DWORD PTR SS:[ESP+0xC]
        0x57, // 005D3D96   57               PUSH EDI
        0x8B, 0xF9, // 005D3D97   8BF9             MOV EDI,ECX
        0x83, 0x7E, 0x0C, 0x00, // 005D3D99   837E 0C 00       CMP DWORD PTR DS:[ESI+0xC],0x0
        0x74, 0x1C, // 005D3D9D   74 1C            JE SHORT Rance03T.005D3DBB
        0x8B, 0x56, 0x08, // 005D3D9F   8B56 08          MOV EDX,DWORD PTR DS:[ESI+0x8]
        0x85, 0xD2, // 005D3DA2   85D2             TEST EDX,EDX
        0x74, 0x15, // 005D3DA4   74 15            JE SHORT Rance03T.005D3DBB
        0x8D, 0x4A, 0x01, // 005D3DA6   8D4A 01          LEA ECX,DWORD PTR DS:[EDX+0x1]
        0x8D, 0xA4, 0x24, 0x00, 0x00, 0x00, 0x00, // 005D3DA9   8DA424 00000000  LEA ESP,DWORD PTR SS:[ESP]
        0x8A, 0x02, // 005D3DB0   8A02             MOV AL,BYTE PTR DS:[EDX]
        0x42, // 005D3DB2   42               INC EDX
        0x84, 0xC0, // 005D3DB3   84C0             TEST AL,AL
    ];
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;

    let count = 0;
    const fun = (a) => {
        const retaddr = a + 5;
        // 005C68DA   84C0             TEST AL,AL
        if (L.u16(retaddr) === 0xc084) count += 1;
        return L.NewHook({
            address: a,
            type: L.NO_CONTEXT,
            text_fun: scenarioHookBefore,
        }, 'EmbedSysmtem44'); // replace all functions
    };
    L.iterNearCallAddress(fun, addr, startAddress, stopAddress);
    return count;
}

// attachSystem43 starts with `return false` in LunaHook ("太麻煩 放棄。"), so system4X is attachSystem44
function system4X(startAddress, stopAddress) {
    return !!scenarioAttach(startAddress, stopAddress);
}

function System42Filter(buffer) {
    if (buffer.size === 1) return buffer.clear();
    if (L.all_ascii(buffer.viewA())) {
        L.CharReplacerA(buffer, '`', ' ');
        L.CharReplacerA(buffer, '\x7D', '-');
    }
}

function InsertSystem42Hook() {
    const bytes = [
        0x8B, 0x46, 0x04, // mov eax,[esi+04]
        0x57, // push edi
        0x52, // push edx
        0x50, // push eax
        0xE8, ...XX4, // call Sys42VM.DLL+4B5B0
    ];
    const module = L.GetModuleHandle('Sys42VM.dll');
    if (!module) return false;
    const [minAddress, maxAddress] = L.QueryModuleLimits(module);
    const addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        split: L.regoffset('esp'),
        type: L.NO_CONTEXT | L.USING_STRING | L.USING_SPLIT,
        filter_fun: System42Filter,
    }, 'System42');
}

function Evenicle() {
    const bytes = [
        0xb8, ...XX4,
        0xe8, ...XX4,
        0x83, 0xec, 0x18,
        0x8b, 0x01,
        0x56,
        0x8b, 0xf2,
        0xff, 0x10, // v3 = (const char *)(**a1)(a1); ->EAX
        0x50,
        0x8d, 0x4d, 0xdc,
        0xe8, ...XX4,
        0x83, 0x65, 0xfc, 0x00,
        0x8d, 0x45, 0xdc,
        0x8b, 0x0d, ...XX4,
        0x56,
        0x50,
        0x8d, 0x49, 0x04,
        0xe8, ...XX4,
        0x8d, 0x4d, 0xdc,
        0xe8, ...XX4,
        0x8b, 0x4d, 0xf4,
        0x5e,
        0x64, 0x89, 0x0d, 0x00, 0x00, 0x00, 0x00,
        0xc9,
        0xc3];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 5 + 5 + 3 + 2 + 1 + 2 + 2,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
    }, 'Evenicle');
}

const E = L.engine({
    name: 'System4x',
    // jichi 12/26/2013: Add this after alicehook
    check: { FILE: 'AliceStart.ini' },
    attach() {
        if (L.CheckFile('DLL/Sys42VM.dll')) {
            if (InsertSystem42Hook()) return true;
        }
        const _ = system4X(L.processStartAddress, L.processStopAddress);
        return InsertSystem43Hook() || _ || Evenicle();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
