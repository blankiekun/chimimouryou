// Seraphim.js: LunaHook's Seraphim engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Seraphim.cpp and Seraphim.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// Left out: Seraphimattach_function2 (School Captain 2), whose hook is made from a trigger_fun on
// GetGlyphOutlineW (not supported); LunaHook tries it first, here only function1 runs.

function Seraphimattach_function1() {
    // Laughter Land
    const addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig = [0x81, 0xEC, 0xB8, 0x00, 0x00, 0x00];
    return L.NewHook({
        address: L.reverseFindBytes(sig, addr - 0x400, addr),
        type: L.USING_STRING,
        offset: L.stackoffset(7),
    }, 'Seraphim2');
}

const E = L.engine({
    name: 'Seraphim',
    check: () => L.CheckFileAll(['ArchPac.Dat', 'ScnPac.Dat', 'Voice0.dat']) && L.SearchResourceString('Seraphim'),
    attach() { return Seraphimattach_function1(); },
});

module.exports = E;
if (!module.parent) L.run(E);
