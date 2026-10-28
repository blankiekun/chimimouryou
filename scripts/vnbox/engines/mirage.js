// mirage.js: LunaHook's mirage engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/mirage.cpp and mirage.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'mirage',
    check: { FILE_ALL: ['anim/anm.pk', 'misc/*.pk', // bg.pk,script.pk,chr.pk,thumb.pk,se.pk,grp.pk,system.px,eff.pk
        'movie/*.mj',
        'sound/*.pk', // env.pk,music.pk
        'voice/voice.pk'] },
    attach() {
        //[031219][mirage] そこに海があって
        const addr = L.findCallerAddress(L.FindFunction('TextOutA'), 0x90909090, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr + 4, offset: L.stackoffset(1), type: L.DATA_INDIRECT | L.USING_CHAR }, 'mirage');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
