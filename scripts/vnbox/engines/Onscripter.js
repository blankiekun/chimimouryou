// Onscripter.js: LunaHook's Onscripter engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Onscripter.cpp and Onscripter.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// Monster Girl Quest Remastered
function hook2() {
    const bytes = [
        0x8b, 0xbe, ...XX2, 0x00, 0x00,
        0x80, 0x3c, 0x07, 0x00,
        0x8d, 0x1c, 0x07,
        0x75, XX,
        0x8b, 0xce,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    let last = ''; // static std::string last
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun(buffer) {
            let xx = buffer.strA();
            if (xx === last) return buffer.clear();
            last = xx;
            xx = L.strReplace(xx, '@');
            xx = L.strReplace(xx, '\\');
            xx = L.strReplace(xx, '_', '\n');
            xx = L.strReplace(xx, '/');
            // # ( ) < 代码里，但C了一会儿没遇到，不管了先
            buffer.fromA(xx);
        },
    }, 'onscripter');
}

const E = L.engine({
    name: 'Onscripter',
    check: { FILE: 'arc.nsa' },
    certain: false,
    attach() { return hook2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
