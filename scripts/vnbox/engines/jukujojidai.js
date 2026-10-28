// jukujojidai.js: LunaHook's jukujojidai engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/jukujojidai.cpp and jukujojidai.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'jukujojidai',
    check: { FILE_ALL: ['adv', 'bg', 'bgm', 'ch', 'ev', 'se', 'system', 'voice'] },
    attach() {
        const bytes = [
            // 撫乳～今夜、あなたのお掃除しましょうか?～
            // https://vndb.org/v15867
            0x41,
            0x83, 0xC0, 0x20,
            0x81, 0xF9, 0xC8, 0x00, 0x00, 0x00,
            0x7C];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x1000);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_UTF16 | L.DATA_INDIRECT }, 'jukujojidai');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
