// @name LunaHook engines (automatic)
// PC_LunaEngines.js: runs LunaHook's engine checks in LunaHook's order (enginecollection32.cpp) and
// attaches the first engine that matches; with none, hooks the GDI text functions (HIJACK()).
// The ported engines are the files next to this one (scripts/vnbox/engines/, PORTING.md);
// node order.mjs rewrites the list below after a port.
// Ported from LunaTranslator (HIllya51), LunaHook/enginecollection32.cpp and enginecontrol.cpp, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const files = [
    // <engines>
    // </engines>
];
// LunaHook's order (order.mjs ORDER) is kept by the list above; files with several engines export an array.
const engines = files.flatMap((e) => [].concat(e));

module.exports = engines;
if (!module.parent) L.auto(engines);
