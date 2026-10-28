// Rejet.js: LunaHook's Rejet engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Rejet.cpp and Rejet.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const MAX_REL_ADDR = 0x00300000;

/**
 *  jichi 12/22/2013: Rejet
 *  See (CaoNiMaGeBi): http://www.hongfire.com/forum/printthread.php?t=36807&pp=40&page=172
 *  Pattern: 2bce8bf8
 *      2bce      sub ecx,esi ; hook here
 *      8bf8      mov eds,eax
 *      8bd1      mov edx,ecx
 *
 *  Examples:
 *  - Type1: ドットカレシ-We're 8bit Lovers!: /HBN-4*0@A5332:DotKareshi.exe (the hook address varies)
 *    01185311   . FFF0           PUSH EAX  ; beginning of a new function
 *    01185332   . E8 99A9FBFF    CALL DotKares.0113FCD0    ; hook here (0x21 into the function)
 *  - Type2: ドットカレシ-We're 8bit Lovers! II: /HBN-8*0@A7AF9:dotkareshi.exe, Tiny×MACHINEGUN
 *    01357ad2   . fff0           push eax ; beginning of a new function
 *    01357af9   . e8 7283fbff    call dotkares.0130fe70    ; jichi: hook here (0x27 into the function)
 *  - Type 3: 剣が君: /HBN-8*0@B357D:KenGaKimi.exe
 *    01113578     68 dc6a5401    push kengakim.01546adc
 *    0111357d     e8 3eaff6ff    call kengakim.0107e4c0    ; hook here
 */
function FindRejetHook(pattern, hook_off, hook_offset, hook_name = 'Rejet') {
    let addr = L.processStartAddress;
    do {
        const range = Math.min(L.processStopAddress - addr, MAX_REL_ADDR);
        addr = L.findBytes(pattern, addr, addr + range);
        if (!addr) return false;
        addr += hook_off;
    } while (0xe8202474 !== L.u32(addr - 3)); // mov esi,[esp+0x20]; call

    return L.NewHook({
        address: addr,
        type: L.NO_CONTEXT | L.DATA_INDIRECT | L.FIXING_SPLIT,
        offset: hook_offset,
    }, hook_name);
}

function InsertRejetHook1() { // This type of hook has varied hook address
    const bytes = [
        // Type1: Function start
        0xff, 0xf0, // 01185311   . fff0           push eax  ; beginning of a new function
        0x0f, 0xc1, 0x11, // 01185313   . 0fc111         xadd dword ptr ds:[ecx],edx
        0x4a, // 01185316   . 4a             dec edx
        0x85, 0xd2, // 01185317   . 85d2           test edx,edx
        0x0f, 0x8f, // 01185319   . 0f8f 45020000  jg DotKares.01185564
    ];
    const addr_offset = 0x21; // Type1: hex(0x01185332-0x01185311)
    const hook_offset = -0x8; // hook parameter (eax)
    return FindRejetHook(bytes, addr_offset, hook_offset);
}

function InsertRejetHook2() { // This type of hook has static hook address
    const bytes = [
        // Type2 Function start
        0xff, 0xf0, // push eax
        0x0f, 0xc1, 0x11, // xadd dword ptr ds:[ecx],edx
        0x4a, // dec edx
        0x85, 0xd2, // test edx,edx
        0x7f, 0x0a, // jg short DotKares.01357ae6
        0x8b, 0x08, // mov ecx,dword ptr ds:[eax]
        0x8b, 0x11, // mov edx,dword ptr ds:[ecx]
        0x50, // push eax
        0x8b, 0x42, 0x04, // mov eax,dword ptr ds:[edx+0x4]
        0xff, 0xd0, // call eax
        0x8b, 0x4c, 0x24, 0x14, // mov ecx,dword ptr ss:[esp+0x14]
    ];
    const addr_offset = 0x27; // Type2: hex(0x0133CEC7-0x0133CEA0) = hex(0x01357af9-0x1357ad2)
    const hook_offset = -0xc; // hook parameter (ecx)
    return FindRejetHook(bytes, addr_offset, hook_offset);
}

function InsertRejetHook3() { // jichi 12/28/2013: add for 剣が君
    // The following pattern is the same as type2
    const bytes = [
        0xff, 0xf0, // push eax
        0x0f, 0xc1, 0x11, // xadd dword ptr ds:[ecx],edx
        0x4a, // dec edx
        0x85, 0xd2, // test edx,edx
        0x7f, 0x0a, // jg short DotKares.01357ae6
        0x8b, 0x08, // mov ecx,dword ptr ds:[eax]
        0x8b, 0x11, // mov edx,dword ptr ds:[ecx]
        0x50, // push eax
        0x8b, 0x42, 0x04, // mov eax,dword ptr ds:[edx+0x4]
        0xff, 0xd0, // call eax
        0x8b, 0x4c, 0x24, 0x14, // mov ecx,dword ptr ss:[esp+0x14]
    ];
    const hook_offset = -0xc; // (ecx)
    let addr = L.processStartAddress;
    for (;;) {
        const range = Math.min(L.processStopAddress - addr, MAX_REL_ADDR);
        addr = L.findBytes(bytes, addr, addr + range);
        if (!addr) return false;
        addr += bytes.length;
        // Push and call at once, i.e. push (0x68) and call (0xe8)
        // 01185345     52             push edx
        // 01185346   . 68 e4fe5501    push dotkares.0155fee4                   ; |arg1 = 0155fee4
        // 0118534b   . e8 1023f9ff    call dotkares.01117660                   ; \dotkares.00377660
        const start = 0x10, stop = 0x50;
        // Different from FindRejetHook
        let i;
        for (i = start; i < stop; i++) {
            if (L.u16(addr + i - 1) === 0x6852 && L.u8(addr + i + 5) === 0xe8) break; // 0118534B-01185346
        }
        if (i < stop) {
            addr += i;
            break;
        }
    }

    // The same as type2
    return L.NewHook({
        address: addr,
        type: L.NO_CONTEXT | L.DATA_INDIRECT | L.FIXING_SPLIT,
        offset: hook_offset,
    }, 'Rejet');
}

function InsertRejetHook() {
    return InsertRejetHook2() || InsertRejetHook1() || InsertRejetHook3();
} // insert hook2 first, since 2's pattern seems to be more unique

function htokyo() {
    // https://vndb.org/v7675
    // TOKYOヤマノテBOYS DARK CHERRY DISC
    let addr = L.findiatcallormov(L.FindFunction('GetTextExtentPoint32A'), L.processStartAddress, L.processStartAddress, L.processStopAddress, true);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        filter_fun(buffer) { L.StringFilterA(buffer, '\x81\x40'); },
        offset: L.stackoffset(1),
        split: L.regoffset('edi'),
        type: L.CODEC_ANSI_BE | L.USING_SPLIT | L.USING_STRING | L.DATA_INDIRECT,
    }, 'Rejet');
}

// https://vndb.org/v7675 TOKYOヤマノテBOYS DARK CHERRY DISC
let tokyo = false;
const E = L.engine({
    name: 'Rejet',
    check: () => {
        if (L.CheckFileAll(['gd.dat', 'pf.dat', 'sd.dat'])) return true;
        tokyo = L.SearchResourceString('Rejet株式会社');
        return tokyo;
    },
    attach() { return ((!tokyo) && InsertRejetHook()) || (tokyo && htokyo()); },
});

module.exports = E;
if (!module.parent) L.run(E);
