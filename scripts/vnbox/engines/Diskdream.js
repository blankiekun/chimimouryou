// Diskdream.js: LunaHook's Diskdream engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Diskdream.cpp and Diskdream.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'Diskdream',
    check: { FILE_ALL: ['system.har', 'Graphic.har', 'wave*.har'] },
    attach() {
        // https://vndb.org/v3143
        // Endless Serenade
        let addr = L.findBytes(L.aToBytes('FrameSkip = \0'), L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.regoffset('edx'),
            type: L.USING_STRING,
            codepage: 932,
            filter_fun(buffer) {
                if (!L.IsShiftjisLeadByte(buffer.data[0])) buffer.clear();
            },
        }, 'Diskdream');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
