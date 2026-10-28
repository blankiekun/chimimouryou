// TAKUYO.js: LunaHook's TAKUYO engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TAKUYO.cpp and TAKUYO.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'TAKUYO',
    check: {
        FILE_ALL: [
            'voicedata*.arc',
            'voicedata*.bin',
            'sedata.arc',
            'sedata.bin',
            'BGMDATA.ARC',
            'BGMDATA.BIN',
            'bmpdata.arc',
            'bmpdata.bin',
            'sysdata.arc',
            'sysdata.bin',
            'scrdata.arc',
            'scrdata.bin',
        ],
    },
    attach() {
        const sig = [
            0X66, 0X83, 0X3D, ...XX4, 0X00,
            0X74, XX,
            0X8B, 0X0D, ...XX4,
            0X8B, 0X15, ...XX4,
            0xb8, ...XX4,
            0x66, 0x29, 0x50, 0xfe,
            0x66, 0x29, 0x08,
            0x83, 0xc0, 0x0c,
            0x66, 0x83, 0x78, 0x02, 0x00,
            0x75, XX,
            0x56,
            0xe8, ...XX4,
            0x83, 0xc4, 0x04,
            0X66, 0X83, 0X3D, ...XX4, 0X00,
            0X74, XX,
            0X8B, 0X0D, ...XX4,
            0X8B, 0X15, ...XX4,
            0xb8, ...XX4,
            0x66, 0x01, 0x50, 0xfe,
            0x66, 0x01, 0x08,
            0x83, 0xc0, 0x0c,
            0x66, 0x83, 0x78, 0x02, 0x00,
            0x75, XX];
        let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING | L.USING_SPLIT,
            offset: L.stackoffset(2), // 其实可以内嵌，但是字体渲染有问题
            split: L.stackoffset(1),
        }, 'TAKUYO');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
