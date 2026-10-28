// Nitroplus2.js: LunaHook's Nitroplus2 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Nitroplus2.cpp and Nitroplus2.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags of ScenarioHook (EmbedNitroplus keeps its text hook).
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/**
 *  Jazzinghen 23/05/2020: Add TokyoNecro hook
 *
 *  [Nitroplus] 東京Necro 1.01 - Text boxes hook
 *  Hook code: HS-14*8@B5420:TokyoNecro.exe
 *
 *  TokyoNecro.exe+B5420 - 55                - push ebp                  ; place to hook
 *  ...
 *  TokyoNecro.exe+B546A - 8B F8             - mov edi,eax                ▷ Search
 *  TokyoNecro.exe+B546C - 8D 75 D8          - lea esi,[ebp-28]           |
 *  TokyoNecro.exe+B546F - E8 6CE1F4FF       - call TokyoNecro.exe+35E0   ▷
 *
 *  The text is contained into the memory location at [esp+04] when hooking the code at TokyoNecro.exe+B5420
 */

const funcSig = [0x55, 0x8b, 0xec];

function TextHook() {
    const bytecodes = [
        0x8B, 0xF8,                   // 8B F8             - mov edi,eax
        0x8D, 0x75, 0xD8,             // 8D 75 D8          - lea esi,[ebp-28]
        0xE8, 0x6C, 0xE1, 0xF4, 0xFF, // E8 6CE1F4FF       - call TokyoNecro.exe+35E0
    ];
    const addr = L.findBytes(bytecodes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        return false;
    }

    // Look for the start of the function
    const function_start = L.findEnclosingAlignedFunction(addr);
    if (!L.MatchPattern(function_start, funcSig)) {
        return false;
    }

    // The memory address is held at [ebp+08] at TokyoNecro.exe+B543B, meaning that at the start of the function
    // it's right above the stack pointer, so we go up the stack instead of using the data in the registers
    return L.NewHook({ address: function_start, offset: L.stackoffset(1), type: L.USING_STRING }, 'TokyoNecroText');
}

/**
 * [Nitroplus] 東京Necro 1.01 - Database/Encyclopedia hook
 * Hook code: HS4*@B5380:tokyonecro.exe
 */
function DatabaseHook() {
    const bytecodes = [
        0x8B, 0xF8,                   // 8B F8             - mov edi,eax
        0x8D, 0x75, 0xD8,             // 8D 75 D8          - lea esi,[ebp-28]
        0xE8, 0x0C, 0xE2, 0xF4, 0xFF, // E8 6CE1F4FF       - call TokyoNecro.exe+35E0
    ];
    const addr = L.findBytes(bytecodes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        return false;
    }

    // Look for the start of the function
    const function_start = L.findEnclosingAlignedFunction(addr);
    if (!L.MatchPattern(function_start, funcSig)) {
        return false;
    }

    return L.NewHook({ address: function_start, offset: L.stackoffset(1), type: L.USING_STRING }, 'TokyoNecroDatabase');
}

function InsertTokyoNecroHook() {
    DatabaseHook();
    return TextHook();
}

function InsertNitroPlusHook() {
    // 機神咆吼デモンベイン
    // みにくいモジカの子
    const bytes = [
        0x55,
        0x8b, 0xec,
        0xff, 0x75, 0x10,
        0xff, 0x75, 0x0c,
        0xe8, XX, XX, 0xff, 0xff];
    const bytes2 = [
        0x55,
        0x8b, 0xec,
        0xff, 0x75, 0x0c,
        0xe8, XX, XX, 0xff, 0xff];
    const addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    const addr2 = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (addr1 === 0 && addr2 === 0)
        return false;
    let succ = false;
    if (addr1) {
        succ = L.NewHook({ address: addr1, offset: L.stackoffset(2), type: L.CODEC_UTF16 }, 'NitroPlus') || succ;
    }
    if (addr2) {
        succ = L.NewHook({ address: addr2, offset: L.stackoffset(2), type: L.CODEC_UTF16 }, 'NitroPlus') || succ;
    }
    return succ;
}

/**
 *  ScenarioHook. Sample game: 凍京NECRO 体験版
 *  Issues: It cannot extract character name.
 *  File pattern: *.npk for new "Nitroplus" (p is lower case), *.npa for old "Nitroplus"
 */
function attachScenario(startAddress, stopAddress) {
    const bytes = [
        0xc7, 0x45, 0xfc, 0x00, 0x00, 0x00, 0x00, // 00cf0ec4   c745 fc 00000000 mov dword ptr ss:[ebp-0x4],0x0	; jichi: pattern start
        0x8b, 0x8b, 0x84, 0x03, 0x00, 0x00,       // 00cf0ecb   8b8b 84030000    mov ecx,dword ptr ds:[ebx+0x384]
        0x8b, 0x01,                               // 00cf0ed1   8b01             mov eax,dword ptr ds:[ecx]
        0x8b, 0x40, 0x60,                         // 00cf0ed3   8b40 60          mov eax,dword ptr ds:[eax+0x60]
        0x8b, 0xd6,                               // 00cf0ed6   8bd6             mov edx,esi
        0x52,                                     // 00cf0ed8   52               push edx
        0xff, 0xd0,                               // 00cf0ed9   ffd0             call eax   ;jichi: called here  .00caef00
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING,
        filter_fun: L.all_ascii_Filter,
    }, 'EmbedNitroplus');
}

function sayanouta() {
    // 沙耶の唄 The Best 10対応DL版
    const tolang = L.aToBytes('string too long\0');
    const tolangaddr = L.findBytes(tolang, L.processStartAddress, L.processStopAddress);
    let lower = L.processStartAddress;
    let succ = false;
    while (true) {
        const addrX = L.findPushAddress(tolangaddr, lower, L.processStopAddress);
        if (addrX === 0)
            break;
        lower = addrX + 0x100;

        const bytes = [
            0x55, 0x8b, 0xec,
            0x53, 0x8b, 0x5d, 0x08,
            0x56, 0x8b, 0xf1,
            0x85, 0xdb,
            0x74, XX,
            0x8b, 0x4e, 0x14,
            0x83, 0xf9, 0x10,
            0x72, 0x04,
            0x8b, 0x06,
            0xeb, 0x02];

        const addr = L.reverseFindBytes(bytes, addrX - 0x200, addrX);
        if (!addr)
            continue;
        succ = L.NewHook({
            address: addr,
            type: L.USING_STRING | L.CODEC_UTF8 | L.NO_CONTEXT,
            text_fun(context, hp, buffer, split) {
                const refaddr = (context.retaddr - L.GetModuleHandle(null)) >>> 0;
                if (refaddr < 0xb0000 || refaddr > 0xb1000)
                    return;
                buffer.from(context.stack[1], context.stack[2]);
            },
            filter_fun(buffer) {
                let result = buffer.strA();
                result = L.re.sub(result, String.raw`#\{(.*?)\}(.*?)#`, '$2');
                result = L.strReplace(result, L.utf8A('　\n'));
                result = L.strReplace(result, L.utf8A('\n'));
                buffer.fromA(result);
            },
        }, 'sayanouta') || succ;
    }
    return succ;
}

function hprint() {
    const aPrint = L.aToBytes('print\0');
    let addr = L.findBytes(aPrint, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    const check = [
        0x53, 0x57,
        0x68, ...XX4,
        0x68, ...XX4,
        0x8b, 0xce,
        0xe8, ...XX4];
    if (!L.MatchPattern(addr - 2, check))
        return false;
    const faddr = L.i32(addr + 5 + 1);
    return L.NewHook({
        address: faddr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.FULL_STRING,
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, '<I>');
            s = L.re.sub(s, '</I>');
            buffer.fromA(s);
        },
    }, 'Nitroplus3');
}

const E = L.engine({
    name: 'Nitroplus2',
    check: { FILE: '*.npk' },
    certain: false,
    attach() {
        const embed = attachScenario(L.processStartAddress, L.processStopAddress);
        const b = InsertNitroPlusHook();
        const b3 = hprint();
        let b2 = L.SearchResourceString('TOKYONECRO') && InsertTokyoNecroHook();
        b2 = sayanouta() || b2;
        return b3 || b || b2 || embed;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
