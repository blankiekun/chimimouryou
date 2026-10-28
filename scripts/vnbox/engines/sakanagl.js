// sakanagl.js: LunaHook's sakanagl engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/sakanagl.cpp and sakanagl.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

let hmodule = 0;

const E = L.engine({
    name: 'sakanagl',
    check: () => !!(hmodule = L.GetModuleHandleW('sakanagl.dll')),
    certain: false,
    attach() {
        // 年上お姉さんを独り占めしたい！
        // https://store.steampowered.com/app/2541470/__Possessing_My_Older_Sister/?l=japanese
        const [minAddress, maxAddress] = L.QueryModuleLimits(hmodule);
        const bytes = [0x89, 0x01, 0x33, 0xc9, 0x85, 0xdb];
        const addr = L.findBytes(bytes, minAddress, maxAddress);
        return L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.USING_STRING | L.CODEC_UTF8 }, 'sakanagldll');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
