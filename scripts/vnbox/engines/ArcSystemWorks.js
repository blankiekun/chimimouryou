// ArcSystemWorks.js: LunaHook's ArcSystemWorks engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ArcSystemWorks.cpp and ArcSystemWorks.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

const E = L.engine({
    name: 'ArcSystemWorks',
    check: { FILE_ALL: ['DATA/text/*.lst', 'DATA/STORY/SCRIPT/*.PAC', 'DATA/STORY/image/*.HIP'] },
    attach() {
        // https://vndb.org/v18642
        // 月英学園 -kou-
        const bytes2 = [
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x8d, XX, XX,
            0x51,
            0x6a, 0x01,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0x00,
            0x6a, 0xff,
            0x8d, XX, XX,
            0x52,
            0x8d, XX, XX,
            0x50,
            0x8d, XX, XX,
            0x51,
            0xba, 0x1c, 0x00, 0x00, 0x00,
            0x6b, 0xd2, 0x00,
            0x8b, XX, XX,
            0x8d, XX, XX, XX,
            0x51,
            0x51,
            0xf3, ...XX4,
            0xf3, ...XX4,
            0x68, 0x00, 0x04, 0x00, 0x00,
            0x8d, XX, ...XX4,
            0x52,
            0x6a, 0x00,
            0x8b, XX, XX,
            0x50,
            0xb9, 0x1c, 0x00, 0x00, 0x00,
            0x6b, 0xc9, 0x00,
            0x8b, XX, XX,
            0x8d, ...XX2, ...XX4,
            0xe8, ...XX4,
            0x50,
            0xe8];
        const addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr + bytes2.length - 1,
            type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT | L.FULL_STRING,
            text_fun(context, hp, buffer, split) {
                const stack = context.stack;
                buffer.fromWCharPtr(stack[1]);
            },
            filter_fun(buffer) {
                let result = buffer.strW();
                result = L.re.sub(result, '<ruby>(.*?)<.*?/ruby>', '$1');
                buffer.fromW(result);
            },
        }, 'ArcSystemWorks');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
