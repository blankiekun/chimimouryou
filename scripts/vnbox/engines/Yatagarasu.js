// Yatagarasu.js: LunaHook's Yatagarasu engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Yatagarasu.cpp and Yatagarasu.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Yatagarasu',
    check: { RESOURCE_STR: 'Yatagarasu' },
    attach() {
        // テンタクルロード －我が手に堕ちよ勇壮なる乙女－
        const left = L.aToBytes('<%\0');
        const right = L.aToBytes('<voice\0');
        let addr1 = L.findBytes(left, L.processStartAddress, L.processStopAddress);
        let addr2 = L.findBytes(right, L.processStartAddress, L.processStopAddress);
        if (!addr1 || !addr2) return false;
        addr1 = L.findPushAddress(addr1, L.processStartAddress, L.processStopAddress);
        addr2 = L.findPushAddress(addr2, L.processStartAddress, L.processStopAddress);
        if (!addr1 || !addr2) return false;
        addr1 = L.findEnclosingAlignedFunction(addr1);
        addr2 = L.findEnclosingAlignedFunction(addr2);
        // LunaHook returns false here unconditionally (the `if` before this `return false;` is missing in
        // be625f4), so the rest (a hook at addr1 with offset edx, USING_STRING | NO_CONTEXT, whose filter
        // removes "<%.*?>", "<voice.*?>" and "<\\w+>") is unreachable and left out.
        return false;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
