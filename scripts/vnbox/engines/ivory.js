// ivory.js: LunaHook's ivory engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ivory.cpp and ivory.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'ivory',
    check: { FILE_ALL: ['BG/*.sg', 'CHR/*.sg', 'MAP/*.sg', 'PARTS/*.sg', 'MUSIC/*.px', 'SE/*.px'] },
    certain: false,
    attach() {
        // https://vndb.org/v1122
        // とらいあんぐるハート3～Sweet Songs Forever～
        const bytes = [
            0x56,
            0x8b, 0x74, 0x24, 0x08,
            0x57,
            0x8b, 0xf9,
            0x8a, 0x06,
            0x84, 0xc0,
            0x74, XX,
            0xa8, 0x80,
            0x74, 0x0f,
            0x6a, 0x02,
            0x56,
            0x8b, 0xcf,
            0xe8, ...XX4,
            0x83, 0xc6, 0x02];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.stackoffset(1),
            type: L.USING_STRING,
            filter_fun(buffer) {
                const s = buffer.viewA();
                if (s === '\x81\x75\x81\x76') buffer.fromA('\x81\x75');
            },
        }, 'TH3');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
