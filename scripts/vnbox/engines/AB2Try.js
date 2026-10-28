// AB2Try.js: LunaHook's AB2Try engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AB2Try.cpp and AB2Try.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// AkabeiSoft2Try (YaneSDK.dll, .NET): the text is read by JIT code, `movzx eax, word ptr [edx*2 + eax + C]`.
// shortcut: L.SearchMemory sees module images only, not JIT code, so this finds nothing until it can
// enumerate executable pages (frida-compat has no Process.enumerateRanges yet).
const E = L.engine({
    name: 'AB2Try',
    check: { FILE: 'Yanesdk.dll' },
    attach() {
        for (const addr of L.SearchMemory('0F B7 44 50 0C 89', L.PAGE_EXECUTE_READWRITE)) {
            return L.NewHook({
                address: addr,
                type: L.USING_STRING | L.NO_CONTEXT | L.CODEC_UTF16,
                // NSTRING { vfTable; lenWithNull; lenWithoutNull; WCHAR str[] } in eax, when edx == 0
                text_fun(context, hp, buffer, split) {
                    if (context.edx !== 0) return;
                    const s = context.eax;
                    if (!s) return;
                    buffer.from(s + 12, L.live.u32(s + 8) << 1);
                    split.value = L.FIXED_SPLIT_VALUE;
                },
            }, 'AB2Try');
        }
        return false;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
