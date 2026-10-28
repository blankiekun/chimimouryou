// RPGMaker.js: LunaHook's RPGMaker engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RPGMaker.cpp and RPGMaker.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX2 } = L;

// https://www.dlsite.com/maniax/work/=/product_id/RJ01240121.html
// ネクロマリア
const E = L.engine({
    name: 'RPGMaker',
    check: () => L.processName_lower === 'game.dat' &&
        L.CheckFileAll(['data/game.dat', 'data/psl.dat', 'data/scenario.dat', 'data/system.dat']),
    certain: false,
    attach() {
        const bytes2 = [
            0x81, 0xf9, 0xff, 0xff, 0xff, 0x7f,
            ...XX2,
            0xb9, 0xff, 0xff, 0xff, 0x7f,
            ...XX2,
            0x8b, 0xc2,
            0xd1, 0xe8,
            0x89, 0x45, 0x0c,
            0xb8, 0xff, 0xff, 0xff, 0x7f,
            0x2b, 0x45, 0x0c,
            0x3b, 0xd0,
            ...XX2,
            0xb9, 0xff, 0xff, 0xff, 0x7f];
        let addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x100);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING | L.CODEC_UTF8,
            offset: L.stackoffset(1),
            length_offset: 2,
            filter_fun(buffer) {
                const result = buffer.strA();
                if (L.all_ascii(result)) return buffer.clear();
                buffer.fromA(L.re.sub(result, String.raw`@c\[\](.*?)@c\[\]`, '$1'));
            },
        }, 'RPGMaker');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
