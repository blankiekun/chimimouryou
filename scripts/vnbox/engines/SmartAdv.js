// SmartAdv.js: LunaHook's SmartAdv engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/SmartAdv.cpp and SmartAdv.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// https://vndb.org/r6347
// VALENTINE PINK～パーフェクトエディション～
const E = L.engine({
    name: 'SmartAdv',
    check: () => {
        const smartadv = L.GetModuleHandle('smartadv.dll');
        const video = L.GetModuleHandle('video.dll');
        const NSL = L.GetModuleHandle('NSL.dll');
        if (!smartadv || !video || !NSL) return false;
        return L.SearchResourceString('Scenario Script Engine', smartadv);
    },
    attach() {
        // int __stdcall sub_100122D0(_DWORD *a1, int a2, int a3, int *a4, int a5)
        const video = L.GetModuleHandle('video.dll');
        if (!video) return false; // the check guarantees it
        const [s, e] = L.QueryModuleLimits(video);
        let addr = L.findiatcallormov(L.FindFunction('CreateFontIndirectA'), video, s, e);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING,
            offset: L.stackoffset(2),
            filter_fun(buffer) { L.CharFilterA(buffer, '\n'); },
        }, 'SmartAdv');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
