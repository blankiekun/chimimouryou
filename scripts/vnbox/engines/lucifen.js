// lucifen.js: LunaHook's lucifen engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/lucifen.cpp and lucifen.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: every embed_fun (hookafter_navel, hookafter, dispatch*after, replaceNewLines, dispatchNameTextafter),
// the EMBED flags and embed_hook_font, Engine::...Role assignments.
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

/********************************************************************************************
Lucifen hook:
  Game folder contains *.lpk. Used by Navel games.
  Hook is same to GetTextExtentPoint32A, use ESP to split name.
********************************************************************************************/
function InsertLucifenHook() {
    // BOOL GetTextExtentPoint32(HDC hdc, LPCTSTR lpString, int c, LPSIZE lpSize);
    return L.NewHook({
        address: L.FindFunction('GetTextExtentPoint32A'),
        offset: L.stackoffset(2), // arg2 lpString
        split: L.regoffset('esp'),
        length_offset: 3,
        type: L.USING_STRING | L.USING_SPLIT,
    }, 'Lucifen');
}

function hook() {
    // まじかるカナン -RISEA-
    const oldoutline = L.GetProcAddress(L.GetModuleHandle('gdi32.dll'), 'GetGlyphOutline');
    let addr = L.findCallerAddress(oldoutline, 0xec8b55, L.processStartAddress, L.processStopAddress);
    if (!addr) addr = L.findCallerAddress(L.FindFunction('GetGlyphOutlineA'), 0xec8b55, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        split: L.stackoffset(6),
        type: L.CODEC_ANSI_BE | L.USING_SPLIT,
    }, 'Lucifen2');
}

function hookBefore_navel(context, hp, buffer, split) {
    let text = L.readA(context.stack[1]); // text in arg1

    if (text.includes('$&')) {
        text = text.substr(text.indexOf('$&') + 2);
    }
    if (text[text.length - 1] === '$') {
        text = text.substr(0, text.length - 1);
    }
    buffer.fromA(text);
}

function attach_navel(startAddress, stopAddress) { // attach scenario
    // 通过搜索3C 9F(i > 0x9Fu shiftjis范围判断)找到。
    //   int __thiscall sub_455AB0(int this, _BYTE *a2)
    const bytes = [
        0x50,
        0xff, 0x15, 0xfc, 0xd0, 0x4e, 0x00,
        0x03, 0xf0,
        0x83, 0xc3, 0x04,
        0xb1, 0x01];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;

    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.NO_CONTEXT, text_fun: hookBefore_navel }, 'LucifenEmbed');
}

// ---- ScenarioHook
let scenarioOffset_ = 0,
    nameOffset_ = 0;

// Sample game: 猫撫ディストーション. 0x5b is the text to skip next character
function ltrimScenarioText(p) {
    while (L.u8(p) === 0 && L.u8(p + 1) === 0x5b && L.u8(p + 2) > 0) p += L.u8(p + 2) + 2;
    return p;
}
function parseScenarioText(p, end) {
    let size = L.strlen(p);
    if (end > p && end - p < size) size = end - p;
    let ret = '';
    if (size) ret = L.readA(p, size);
    for (p += ret.length; (!end || p < end) && L.u8(p + 1) === 0x5b && L.u8(p + 2) > 0; p += ret.length) {
        p += L.u8(p + 2) + 2;
        size = L.strlen(p);
        if (end > p && end - p < size) size = end - p;
        ret += L.readA(p, size);
    }
    return ret;
}
function dispatchScenarioText(text, split, context, buffer, role) {
    let scenarioEnd = L.u32(text + 0x1000);
    if (!L.isAddressReadable(scenarioEnd)) scenarioEnd = 0;

    text = ltrimScenarioText(text);
    if (!L.u8(text)) return;
    const oldData = parseScenarioText(text, scenarioEnd);
    buffer.fromA(oldData);
}
function scenarioHookBefore(context, hp, buffer, split) {
    const self = context.ecx;
    const retaddr = context.stack[0];
    dispatchScenarioText(self + scenarioOffset_, retaddr, context, buffer, split);
}
function attachScenario(startAddress, stopAddress) { // attach scenario
    const bytes = [
        0xe8, ...XX4,            // 0043e1f0   e8 3b46ffff      call .00432830
        0x89, 0x87, ...XX4,      // 0043e1f5   8987 a0030000    mov dword ptr ds:[edi+0x3a0],eax
        0x8d, 0x86, ...XX4,      // 0043e1fb   8d86 84c60000    lea eax,dword ptr ds:[esi+0xc684]	; jichi: this is scenario
        ...XX4,                  // 0043e203   8bcf             mov ecx,edi
        0xe8, ...XX4,            // 0043e205   e8 765f0000      call .00444180
        0x8d, 0x9e, ...XX4,      // 0043e20a   8d9e 20c60000    lea ebx,dword ptr ds:[esi+0xc620]	; jichi: this is the chara name, such as kot0
        0x8d, 0x86, ...XX4,      // 0043e210   8d86 0fc60000    lea eax,dword ptr ds:[esi+0xc60f]	; jichi: this is the name address
        0x53,                    // 0043e216   53               push ebx
        0x50,                    // 0043e217   50               push eax
        0x8b, 0xcf,              // 0043e218   8bcf             mov ecx,edi
        0x89, 0x44, 0x24, L.XX,  // 0043e21a   894424 18        mov dword ptr ss:[esp+0x18],eax
        0xe8                     //, XX4            // 0043e21e   e8 0d5f0000      call .00444130
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;

    scenarioOffset_ = L.u32(addr + 2 + 0x0043e1fb - 0x0043e1f0);
    nameOffset_ = L.u32(addr + 2 + 0x0043e210 - 0x0043e1f0);
    if ((scenarioOffset_ >>> 16) || // offset high bits are zero
        (nameOffset_ >>> 16)) return false;

    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.NO_CONTEXT, text_fun: scenarioHookBefore }, 'EmbedLucifen');
}

// ---- ChoiceHook
function choiceHookBefore(context, hp, buffer, split) {
    const text = context.stack[0]; // arg1 is text
    if (!text || !L.u8(text)) return;
    buffer.fromCharPtr(text);
}
function attachChoice(startAddress, stopAddress) { // attach scenario
    const bytes = [
        0xff, 0x90, 0x84, 0x00, 0x00, 0x00, // 00442482   ff90 84000000    call dword ptr ds:[eax+0x84]             ; .004bbd00	; jichi: text called
        0x8a, 0x44, 0x24, 0x13              // 00442488   8a4424 13        mov al,byte ptr ss:[esp+0x13]
    ];
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.NO_CONTEXT, text_fun: choiceHookBefore }, 'lucifen_choice');
}

// ---- Embedlucifen2 (countZero is only used by the skipped hookafter)
function hookBefore(context, hp, buffer, split) {
    const text = context.stack[1]; // arg1 is text
    if (!text || L.strlen(text) <= 2) return;
    buffer.fromCharPtr(text);
}
function attach11(startAddress, stopAddress) { // attach scenario
    const bytes = [
        0x83, 0xec, 0x14,                   // 00461ca0   83ec 14          sub esp,0x14
        0x33, 0xd2,                         // 00461ca3   33d2             xor edx,edx
        0x55,                               // 00461ca5   55               push ebp
        0x56,                               // 00461ca6   56               push esi
        0x8b, 0x74, 0x24, 0x20,             // 00461ca7   8b7424 20        mov esi,dword ptr ss:[esp+0x20]
        0x8b, 0xe9,                         // 00461cab   8be9             mov ebp,ecx
        0x3b, 0xf2,                         // 00461cad   3bf2             cmp esi,edx
        0x0f, 0x84, 0x55, 0x02, 0x00, 0x00, // 00461caf   0f84 55020000    je .00461f0a
        0x39, 0x55, 0x08,                   // 00461cb5   3955 08          cmp dword ptr ss:[ebp+0x8],edx
        0x0f, 0x84, 0x4c, 0x02, 0x00, 0x00, // 00461cb8   0f84 4c020000    je .00461f0a
        0x8b, 0x85, 0x74, 0x20, 0x00, 0x00  // 00461cbe   8b85 74200000    mov eax,dword ptr ss:[ebp+0x2074]
    ];
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.NO_CONTEXT, text_fun: hookBefore }, 'Embedlucifen2');
}

const E = L.engine({
    name: 'Lucifen',
    check: { FILE: '*.lpk' },
    attach() {
        const b1 = attachScenario(L.processStartAddress, L.processStopAddress) || attach_navel(L.processStartAddress, L.processStopAddress);
        if (b1) {
            attachChoice(L.processStartAddress, L.processStopAddress);
            attach11(L.processStartAddress, L.processStopAddress);
        }

        let succ = InsertLucifenHook();
        succ = hook() || succ;
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
