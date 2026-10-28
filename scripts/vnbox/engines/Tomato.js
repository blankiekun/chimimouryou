// Tomato.js: LunaHook's Tomato engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Tomato.cpp and Tomato.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Tomato',
    check: { FILE_ALL: ['*.kun', '*.arc'] },
    certain: false,
    attach() {
        // 姫武者
        let ok = false;
        for (let addr of L.findiatcallormov_all(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr) continue;
            ok = L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.DATA_INDIRECT, index: 0 }, 'Tomato') || ok;
        }
        return ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
