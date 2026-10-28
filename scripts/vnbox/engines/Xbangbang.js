// Xbangbang.js: LunaHook's Xbangbang engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Xbangbang.cpp and Xbangbang.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Xbangbang',
    check: { FILE: 'fastdata.arc' },
    certain: false,
    attach() {
        // さわさわ絵にっき
        // さわさわ絵にっき２
        let ok = false;
        for (let addr of L.findiatcallormov_all(L.FindFunction('GetTextExtentPoint32A'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr) continue;
            ok = L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'Xbangbang') || ok;
        }
        return ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
