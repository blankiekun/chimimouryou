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
const files = [
    require('./KiriKiri.js'),
    require('./AB2Try.js'),
    require('./akatombo.js'),
    require('./A98SYS.js'),
    require('./Abalone.js'),
    require('./Anisetta.js'),
    require('./Broccoli.js'),
    require('./Azurite.js'),
    require('./AZSystem.js'),
];
const order = ["KiriKiri","AB2Try","akatombo","A98SYS","Abalone","Anisetta","Broccoli","Azurite","AZSystem"];
// </engines>
];
// Files with several engines export an array; the engines run in LunaHook's order (the order line above).
const order = JSON.parse(/\/\/ order: (.*)/.exec(String(files.length && ORDER_LINE))[1]);
const engines = files.flatMap((e) => [].concat(e)).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

module.exports = engines;
if (!module.parent) L.auto(engines);
