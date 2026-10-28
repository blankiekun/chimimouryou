// Pinpai.js: LunaHook's Pinpai engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Pinpai.cpp and Pinpai.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// https://vndb.org/v11397
// X'mas Present
const E = L.engine({
    name: 'Pinpai',
    check: () => L.CheckFileAll(['bgm/*.wdt', 'eve/*.sdt', 'gra/*.gdt', 'se/*.wdt', 'voice/*.wdt']) && L.SearchResourceString('Xmas Present'),
    attach() {
        const bytes2 = [
            /*
             if ( *a3 == 0x81 && a3[1] == 64 )
             {
               this[514] += 24;
               return 1;
             }
            */
            0X83, 0XEC, XX,
            0X53,
            0X56,
            0X57,
            0X8B, 0X7C, 0X24, XX,
            0X8B, 0XF1,
            0X8A, 0X17,
            0X80, 0XFA, 0X81,
            0X75, XX,
            0X80, 0X7F, 0X01, 0X40,
            0X75, XX,
            0X8B, 0X86, ...XX4,
            0X5F,
            0X83, 0XC0, 0X18];
        const addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_CHAR | L.DATA_INDIRECT,
            offset: L.stackoffset(2),
            filter_fun(buffer) {
                if (buffer.viewA() === '\x83\xcb') buffer.clear();
                else if (buffer.viewA() === '\x83\xca') buffer.clear();
            },
        }, 'Pinpai');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
