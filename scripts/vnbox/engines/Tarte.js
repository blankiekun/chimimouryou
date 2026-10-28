// Tarte.js: LunaHook's Tarte engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Tarte.cpp and Tarte.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Tarte',
    check: { FILE: 'caf\\script.caf' },
    certain: false,
    attach() {
        // ひなたぼっこ
        // ひなたると～ひなたぼっこファンディスク～
        // スクールぱにっく！
        // こいじばし  https://vndb.org/v4247
        for (let addr of L.findiatcallormov_all(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr) continue;
            const xrefs = L.findxref_reverse_checkcallop(addr, addr - 0x1000, addr + 0x1000, 0xe8);
            for (const addrx of xrefs) {
                const addrx1 = L.findEnclosingAlignedFunction(addrx);
                if (!addrx1) continue;
                const __ = [0x3C, 0x81];
                const _ = L.findBytes(__, addrx1, addrx);
                if (_ === 0) continue;
                let succ = L.NewHook({ address: addrx1, offset: L.stackoffset(2), type: L.CODEC_ANSI_BE }, 'Tarte');
                const xrefs1 = L.findxref_reverse_checkcallop(addrx1, addrx1 - 0x1000, addrx1 + 0x1000, 0xe8);
                for (const addrx11 of xrefs1) {
                    const addrx12 = L.findEnclosingAlignedFunction(addrx11);
                    if (((addrx11 - addrx12) >>> 0) < 0x30) {
                        succ = L.NewHook({ address: addrx12, offset: L.stackoffset(5), type: L.CODEC_ANSI_BE }, 'Tarte') || succ;
                    }
                }
                return succ;
            }
        }
        return false;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
