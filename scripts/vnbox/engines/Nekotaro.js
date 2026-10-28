// Nekotaro.js: LunaHook's Nekotaro engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Nekotaro.cpp and Nekotaro.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

const E = L.engine({
    name: 'Nekotaro',
    check: { RESOURCE_STR: 'Nekotaro Game System for Win95/98' },
    attach() {
        // [991217][Jam] 女の子どうし ～Girl Playing Game～ (cdi)
        const bytes = [
            0x3c, 0x61,
            0X72, 0X0A,
            0X3C, 0X7A,
            0X77, 0X06,
            0X24, 0XDF,
            0X88, 0X44, 0X24, XX];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0X300);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.stackoffset(6),
            type: L.USING_STRING,
            filter_fun(buffer) {
                let s = buffer.strA();
                s = L.strReplace(s, '@n', '\n');
                s = L.strReplace(s, '\x87\x52', '!?');
                s = L.re.sub(s, String.raw`@x\d`);
                s = L.re.sub(s, String.raw`@C\d`);
                s = L.re.sub(s, String.raw`@P\d`);
                s = L.re.sub(s, String.raw`@c\d+`);
                buffer.fromA(s);
            },
        }, 'Nekotaro');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
