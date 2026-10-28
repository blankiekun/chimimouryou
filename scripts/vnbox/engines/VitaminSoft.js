// VitaminSoft.js: LunaHook's VitaminSoft engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/VitaminSoft.cpp and VitaminSoft.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function _1() {
    // どうして？いじってプリンセスFinalRoad～もう！またこんなところで3～
    let ok = false;
    for (let addr of L.findiatcallormov_all(L.FindFunction('ExtTextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        ok = L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.DATA_INDIRECT, index: 0 }, 'VitaminSoft') || ok;
    }
    return ok;
}

function _2() {
    // ねとって女神
    // ねとって女神 NEO
    let ok = false;
    for (let addr of L.findiatcallormov_all(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        ok = L.NewHook({
            address: addr,
            // 真説 猟奇の檻
            // mov     eax, [esp+arg_10]
            offset: L.u32(addr) === 0x1424448b ? L.stackoffset(3) : L.stackoffset(1),
            type: L.USING_STRING,
        }, 'VitaminSoft2') || ok;
    }
    return ok;
}

const E = L.engine({
    name: 'VitaminSoft',
    check: { FILE: '*.fpk' },
    certain: false,
    attach() {
        const succ = _2() || _1();
        L.hookGDIFunctions(L.FindFunction('TextOutA'));
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
