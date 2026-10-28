// C4.js: LunaHook's C4 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/C4.cpp and C4.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// C4 hook: (Contributed by Stomp). Game folder contains C4.EXE or XEX.EXE.
function InsertC4Hook() {
    const bytes = [0x8a, 0x10, 0x40, 0x80, 0xfa, 0x5f, 0x88, 0x15];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.DATA_INDIRECT | L.NO_CONTEXT }, 'C4');
}

const E = L.engine({
    name: 'C4',
    check: { FILE_ANY: ['C4.EXE', 'XEX.EXE'] },
    attach() { return InsertC4Hook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
