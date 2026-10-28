// AniSeed.js: LunaHook's AniSeed engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AniSeed.cpp and AniSeed.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let lastisleftkuohao = false;

const E = L.engine({
    name: 'AniSeed',
    check: { FILE_ALL: ['bg/*.sg', 'chr/*.sg', 'event/*.sg', 'music/*.px', 'oneshot/*.px', 'script/*.kaf', 'system/*.sg'] },
    attach() {
        // 花譜 ～この調べが君に届きますように～
        // https://vndb.org/v3521
        const addr = L.findiatcallormov(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        const faddr = L.findEnclosingAlignedFunction(addr);
        if (!faddr) return false;
        const check = [
            0x8a, 0x01,
            0xa8, 0x80,
            0x74, XX,
            0x3c, 0xa0,
            0x73, XX,
            0x25, 0xff, 0x00, 0x00, 0x00,
            0x2d, 0x80, 0x00, 0x00, 0x00,
            0x33, 0xd2,
            0x8a, 0x51, 0x01,
            0x8a, 0xf0];
        if (!L.findBytes(check, faddr, addr)) return false;
        return L.NewHook({
            address: faddr,
            offset: L.stackoffset(1),
            type: L.USING_CHAR | L.DATA_INDIRECT,
            codepage: 932,
            filter_fun(buffer) {
                const s = buffer.viewA();
                if (s === '\x81\x75') lastisleftkuohao = true;
                else {
                    if (lastisleftkuohao && s === '\x81\x76') buffer.clear();
                    lastisleftkuohao = false;
                }
            },
        }, 'AniSeed');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
