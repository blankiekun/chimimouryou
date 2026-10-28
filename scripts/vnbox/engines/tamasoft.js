// tamasoft.js: LunaHook's tamasoft engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/tamasoft.cpp and tamasoft.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// LOST CHILD
// https://vndb.org/v1183
const E = L.engine({
    name: 'TamaSoft',
    check: () => L.CheckFileAll(['data.epk', 'data.e01']) && L.SearchResourceString('Programmed by sgt (based by mic-o24)'),
    attach() {
        const bytes2 = [
            0x8a, 0x45, 0x00,
            0xc7, XX, XX, XX, ...XX4,
            0x84, 0xc0,
            0x0f, 0x84, ...XX4,
            0x3c, 0x81,
            0x72, 0x04,
            0x3c, 0x9f,
            0x76, 0x10,
            0x3c, 0xe0,
            0x0f, 0x82, ...XX4,
            0x3c, 0xfc,
            0x0f, 0x87, ...XX4];
        const bytes = [
            0x8a, 0x4d, 0x00,
            0x84, 0xc9,
            0x0f, 0x84, ...XX4,
            0x80, 0xf9, 0x81,
            0x72, 0x05,
            0x80, 0xf9, 0x9f,
            0x76, 0x12,
            0x80, 0xf9, 0xe0,
            0x0f, 0x82, ...XX4,
            0x80, 0xf9, 0xfc,
            0x0f, 0x87, ...XX4];
        // Left out: the filter_fun calling `fuck(buffer->strA().c_str())` and the third hook on that
        // function (DECLARE_FUNCTION(fuck): a native function injected into the game, which only re-emits
        // the string both hooks already send).
        let succ = true;
        const hp = { offset: L.regoffset('ebp'), type: L.USING_STRING | L.NO_CONTEXT };
        hp.address = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        succ = L.NewHook(hp, 'TamaSoft') && succ;
        hp.address = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        succ = L.NewHook(hp, 'TamaSoft') && succ;
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
