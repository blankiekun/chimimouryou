// VALKYRIA.js: LunaHook's VALKYRIA engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/VALKYRIA.cpp and VALKYRIA.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

let isspace = false; // static bool isspace

const E = L.engine({
    name: 'VALKYRIA',
    check: () => L.SearchResourceString('Copyright(C)VALKYRIA') && L.CheckFile('data0*-00.dat'),
    attach() {
        let addr = L.findiatcallormov(L.FindFunction('GetTextExtentPoint32A'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        const sehstart = [
            0x6a, 0xff,
            0x68, ...XX4,
            0x64, 0xa1, 0, 0, 0, 0,
            0x50,
            0x81, 0xec, ...XX4,
            0xa1, ...XX4];
        addr = L.reverseFindBytes(sehstart, addr - 0x400, addr, 0, true);
        if (!addr) return false;
        if (L.NewHook({
            address: addr,
            type: L.USING_STRING,
            offset: L.stackoffset(5),
            filter_fun(buffer) {
                // 实际上是单字符
                const str = buffer.strA();
                if (isspace && str === '\x81\x40') {
                    buffer.clear();
                } else if (str === '\\r' || str === '\\R') {
                    isspace = true;
                    buffer.clear();
                } else {
                    isspace = false;
                }
                // (the C++ comment holds the decompiled \u, \r and \\ escape switch)
            },
        }, 'VALKYRIA')) {
            L.hookGDIFunctions(L.FindFunction('GetTextExtentPoint32W'));
            return true;
        }
        return false;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
