// IronGameSystem.js: LunaHook's IronGameSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/IronGameSystem.cpp and IronGameSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: trigger_fun = InsertIGSDynamicHook (a hook set up when GetGlyphOutlineW is first hit; VNBox has no trigger_fun).
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'IronGameSystem',
    check: () => L.processName_lower.includes('igs_sample') || L.processName_lower.startsWith('igs_sa~') || L.CheckFile('igs_sample.exe'),
    attach() {
        L.hookGDIFunctions();
        return true;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
