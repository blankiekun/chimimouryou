// Azurite.js: LunaHook's Azurite engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Azurite.cpp and Azurite.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Azurite',
    check: { FILE_ALL: ['Data01', 'Data02', 'Grphic', 'ih_ed', 'ih_op', 'SE', 'Voice', 'PCM/*.mp3'] },
    certain: false,
    attach() {
        let succ = false;
        for (const addr of L.findiatcallormov_all(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
            const faddr = L.findfuncstart(addr, 0x280);
            if (!faddr) continue;
            // cmp eax, 6E5Ch, searched from addr on (faddr < addr: the range wraps, as in LunaHook)
            if (!L.findBytes('3D 5C 6E 00 00', addr, faddr)) continue;
            succ = L.NewHook({ address: faddr, type: L.USING_STRING | L.NO_CONTEXT, offset: L.stackoffset(1) }, 'Azurite') || succ;
        }
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
