// LizardFactory.js: LunaHook's LizardFactory engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/LizardFactory.cpp and LizardFactory.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'LizardFactory',
    // Monster Brothel Ver1.15a
    check: () => L.CheckFile('archive') && L.GetModuleHandle('glew32.dll') && L.GetModuleHandle('Vox.dll'),
    files: ['archive'],
    certain: false,
    attach() {
        const bytes = [
            0x84, 0xc0,
            0x0f, 0x84, ...XX4,
            0x3c, 0x81,
            0x72, XX,
            0x3c, 0xa0,
            0x72, XX,
            0x3c, 0xe0,
            0x72, XX,
            0x3c, 0xff,
            0x73, XX,
            0x8b, 0x0f,
            0x8b, 0xc1,
            0xc1, 0xf8, 0x08,
            0x0f, 0xb6, 0xf0,
            0x0f, 0xb6, 0xc1,
            0xc1, 0xe0, 0x08,
            0x0b, 0xf0,
            0x83, 0xc7, 0x02,
            0xb8, 0x01, 0x00, 0x00, 0x00,
            0xeb, XX];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x20);
        if (!addr) return false;
        let last = ''; // static std::string last
        return L.NewHook({
            address: addr,
            offset: L.stackoffset(1),
            type: L.USING_STRING | L.DATA_INDIRECT,
            filter_fun(buffer) {
                const s = buffer.strA();
                if (L.endWith(last, s)) return buffer.clear();
                last = s;
                buffer.fromA(L.strReplace(L.strReplace(s, '\r'), '\n'));
            },
        }, 'LizardFactory');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
