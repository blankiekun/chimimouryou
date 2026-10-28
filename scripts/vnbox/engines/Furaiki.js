// Furaiki.js: LunaHook's Furaiki engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Furaiki.cpp and Furaiki.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function h1() {
    const bytes = [
        0X55,
        0X56,
        0X8B, 0XF0,
        0X33, 0XED,
        0X39, 0XAE, 0XCC, 0X08, 0X00, 0X00,
        0XC6, 0X86, 0XC9, 0X00, 0X00, 0X00, 0X01,
        0X89, 0XAE, 0XD0, 0X08, 0X00, 0X00,
        0X7E, 0X68,
        0X57,
        0X8D, 0XBE, 0XCB, 0X00, 0X00, 0X00];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        type: L.FULL_STRING | L.USING_STRING | L.NO_CONTEXT,
        address: addr,
        text_fun(context, hp, buffer, split) {
            let v2 = 0;
            const a1 = context.eax;
            let s = '';
            let v4 = a1 + 203;
            do {
                s += L.readA(v4);
                v4 += 256;
                ++v2;
            } while (v2 < L.u32(a1 + 2252));
            buffer.fromA(s);
        },
    }, 'Furaiki');
}

const E = L.engine({
    name: 'Furaiki',
    check: { FILE_ALL: ['bin/Grp_*.dat', 'bin/Snd_*.dat', 'ap/*.dat'] },
    attach() { return h1(); },
});

module.exports = E;
if (!module.parent) L.run(E);
