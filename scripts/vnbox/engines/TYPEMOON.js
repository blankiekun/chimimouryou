// TYPEMOON.js: LunaHook's TYPEMOON engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TYPEMOON.cpp and TYPEMOON.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// https://vndb.org/v165
// The C++ carries the decompiled glyph loop (it branches on '\\' (92), '\r' (13), '<' (60), '>' (62) and ',' (44)).
const E = L.engine({
    name: 'TYPEMOON',
    check: { FILE_ALL: ['data0*.p', '0*.p'] },
    certain: false,
    attach() {
        // Melty Blood ReACT
        const bytes = [
            0x8a, 0x03,
            0x3c, 0x5c,
            0x0f, 0x84, ...XX4,
            0x3c, 0x0d,
            0x75, XX,
            0x83, 0x7c, 0x24, 0x14, 0x01,
            0x75, XX];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING | L.NO_CONTEXT,
            text_fun(context, hp, buffer) {
                const str = L.readA(context.stack[4]);
                let start = 0, end;
                while (true) {
                    end = str.indexOf('\\', start); // strchr: a missing '\\' ends the loop here (the C++ would crash)
                    if (end < 1 || !L.IsShiftjisLeadByte(str.charCodeAt(end - 1))) break;
                    start = end + 1;
                }
                buffer.fromA(str.substr(0, end < 0 ? str.length : end));
                L.CharFilterA(buffer, '\n');
            },
        }, 'typemoon');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
