// TERIOS.js: LunaHook's TERIOS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TERIOS.cpp and TERIOS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'TERIOS',
    check: { StringFileInfo: 'TERIOS' }, // STREAM.PAK
    certain: false,
    attach() {
        // https://vndb.org/v1722
        const bytes = [
            0x8b, 0xd8,
            0x80, 0xfb, 0x20,
            0x77, XX,
            0x8b, 0xc3,
            0x2c, 0x01,
            0x0f, XX, ...XX4,
            0x2c, 0x09,
            0x0f, XX, ...XX4,
            0xe9];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.regoffset('eax'),
            type: L.USING_STRING,
            filter_fun(buffer) {
                if (L.all_ascii(buffer.viewA().substr(0, 2))) return buffer.clear();
            },
        }, 'TERIOS');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
