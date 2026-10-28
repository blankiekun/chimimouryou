// NUGSystem.js: LunaHook's NUGSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/NUGSystem.cpp and NUGSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

const E = L.engine({
    name: 'NUGSystem',
    // https://vndb.org/v1053
    // そらうた
    check: () => L.CheckFileAll(['bgm.dat', 'data.dat', 'image.dat', 'se.dat', 'story.dat', 'system.dat', 'voice.dat']) &&
        L.SearchResourceString('NUG System'),
    attach() {
        const bytes = [
            0X57,
            0X56,
            0X55,
            0X53,
            0X83, 0XEC, 0X08,
            0X8B, XX, XX, XX,
            0X88, 0X0C, XX,
            0X8B, 0XC1,
            0X25, 0X00, 0XFF, 0X00, 0X00,
            0XC1, 0XE8, 0X08,
            0X8B, 0XD1,
            0X81, 0XE2, 0X00, 0X00, 0XFF, 0X00,
            0X88, XX, 0X24, 0X01,
            0XC1, 0XEA, 0X10,
            0X88, XX, 0X24, 0X02,
            0X81, 0XE1, 0X00, 0X00, 0X00, 0XFF,
            0XC1, 0XE9, 0X18,
            0X88, XX, 0X24, 0X03];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_CHAR | L.CODEC_ANSI_BE }, 'NUGSystem');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
