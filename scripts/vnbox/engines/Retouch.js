// Retouch.js: LunaHook's Retouch engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Retouch.cpp and Retouch.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// jichi 6/21/2015
function SpecialHookRetouch1(context, hp, buffer, split) {
    buffer.fromCharPtr(context.stack[1]);
    // 这个slit不总是管用，但这样最多也不过是把人名和文本合并（例如夏への方舟系列），改了反而会导致某些游戏炸了。
    split.value = context.eax === 0 ? L.FIXED_SPLIT_VALUE * 2 : // name
        context.ebx === 0 ? L.FIXED_SPLIT_VALUE * 1 // scenario
            : L.FIXED_SPLIT_VALUE * 3; // other
}

// embed flags and embed_hook_font left out (translation embedding) in the hooks below
function InsertRetouch1Hook(hm) {
    // private: bool __thiscall RetouchPrintManager::printSub(char const *,class UxPrintData &,unsigned long)
    const sig = '?printSub@RetouchPrintManager@@AAE_NPBDAAVUxPrintData@@K@Z';
    const addr = L.GetProcAddress(hm, sig);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun: SpecialHookRetouch1,
    }, 'Retouch1');
}

function InsertRetouch2Hook(hm) {
    // private: void __thiscall RetouchPrintManager::printSub(char const *,unsigned long,int &,int &)
    const sig = '?printSub@RetouchPrintManager@@AAEXPBDKAAH1@Z';
    const addr = L.GetProcAddress(hm, sig);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT }, 'Retouch2');
}

function get_jmp_absaddr(inst) {
    return (inst + 5 + L.u32(inst + 1)) >>> 0;
}

function HistoryHookAttach(hm) { // attach scenario
    const [startAddress, stopAddress] = L.QueryModuleLimits(hm);
    const bytes = [
        0x8b, 0x44, 0x24, 0x04, // mov eax,dword ptr ss:[esp+0x4]
        0x6a, 0x02, // push 0x2
        0x6a, 0x00, // push 0x0
        0x6a, 0x00, // push 0x0
        0x6a, 0x00, // push 0x0
        0x50, // push eax
        0xe8, // call _1locke2.051ceb90 (then retn 0x4)
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr += bytes.length - 1; // move to the short call instruction
    addr = get_jmp_absaddr(addr);
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT }, 'RetouchHistory');
}

function old(hm) {
    // Pia Carrot e Youkoso!! 3
    // https://vndb.org/r12883
    return (() => {
        // 这作会把每行分开，不好内嵌。
        const message = L.GetProcAddress(hm, '?message@FCProjectAdvSystem@@UAEXPBDH@Z');
        if (!message) return false;
        return L.NewHook({ address: message, offset: L.stackoffset(1), type: L.USING_STRING }, 'FCProjectAdvSystem::message');
    })() && (() => {
        const name = L.GetProcAddress(hm, '?name@FCProjectAdvSystem@@UAEXPBD0H@Z');
        if (!name) return false;
        return L.NewHook({ address: name, offset: L.stackoffset(1), type: L.USING_STRING }, 'FCProjectAdvSystem::name');
    })();
}

let hm = 0;
const E = L.engine({
    name: 'Retouch',
    check: () => { hm = L.GetModuleHandle('resident.dll'); return !!hm; },
    attach() {
        let ok = InsertRetouch1Hook(hm);
        ok = InsertRetouch2Hook(hm) || ok;
        ok = HistoryHookAttach(hm) || ok;
        return ok || old(hm);
    },
});

module.exports = E;
if (!module.parent) L.run(E);
