// Winters.js: LunaHook's Winters engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Winters.cpp and Winters.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

const E = L.engine({
    name: 'Winters',
    check: { FILE_ALL: ['MSG.dat', 'SCR.ifx', 'GRP.ifx'] },
    attach() {
        // こんな魔法少女…アタシはレミィ
        // https://vndb.org/v11018
        const bytes = [
            0x4a,
            0x8b, 0xda,
            0xc1, 0xe3, 0x02,
            0x8d, 0x1c, 0x9b,
            0x8b, 0xcb,
            0x83, 0xc1, 0x11,
            0xba, 0x19, 0x00, 0x00, 0x00,
            0xe8, ...XX4];
        // ゴメンなさい・・・アタシのせいで
        // https://vndb.org/v4267
        const bytes2 = [
            0x4a,
            0x8b, 0xda,
            0xc1, 0xe3, 0x03,
            0x8d, 0x1c, 0x5b,
            0x8b, 0xcb,
            0X41,
            0X81, 0XC1, 0X70, 0X01, 0X00, 0X00,
            0XBA, 0X27, 0X00, 0X00, 0X00,
            0xe8, ...XX4];
        let off1 = bytes.length;
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) {
            off1 = bytes2.length;
            addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        }
        if (!addr) return false;
        const off = L.u32(addr + off1 - 4);
        const target = (off + addr + off1) >>> 0;
        let idx = 0; // static int idx
        return L.NewHook({
            address: target,
            offset: L.stackoffset(1),
            type: L.USING_STRING,
            filter_fun(buffer) {
                if ((idx++) % 2) buffer.clear();
            },
        }, 'Winters');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
