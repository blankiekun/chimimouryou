// A98SYS.js: LunaHook's A98SYS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/A98SYS.cpp and A98SYS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// https://vndb.org/v6447 Rainy Blue ～6月の雨～
const E = L.engine({
    name: 'A98SYS',
    check: { FILE: 'A98SYS.PAK' },
    attach() {
        const addrs = L.findiatcallormov_all(L.FindFunction('ExtTextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE);
        if (addrs.length !== 2) return false;
        let addr = L.findEnclosingAlignedFunction(addrs[1]);
        if (!addr) return false;
        const addrs1 = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
        if (!addrs1.length) return false;
        addr = L.findEnclosingAlignedFunction(addrs1[0]);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'A98SYS');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
