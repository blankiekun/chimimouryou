// LovaGame.js: LunaHook's LovaGame engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/LovaGame.cpp and LovaGame.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// The C++ attach_function is `return false;` followed by an `#if 0` hook, so this engine never attaches.
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'LovaGame',
    check: { FILE_ALL: ['UE3ShaderCompileWorker.exe', 'awesomium_process.exe'] },
    attach() { return false; },
});

module.exports = E;
if (!module.parent) L.run(E);
