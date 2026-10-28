// e_Erekiteru.js: LunaHook's e_Erekiteru engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/e_Erekiteru.cpp and e_Erekiteru.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let lastlength = 0; // static int, shared by the hook
let lastslen = 0;

const E = L.engine({
    name: 'e_Erekiteru',
    check: { FILE_ALL: ['hmc.dll', '*.pkk'] },
    attach() {
        // https://vndb.org/v15578
        // 水素～1/2の奇蹟～
        const bytes = [
            0x3C, 0x20,
            0x72, 0x04,
            0x3C, 0x7E,
            0x76, 0x15,
            0x3C, 0xA1,
            0x72, 0x04,
            0x3C, 0xDF,
            0x76, 0x0D];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        const bs = [0x8B, 0x85, ...XX4];
        const bs2 = [0x8A, 0x44, 0x29, XX];
        const addr1 = L.findBytes(bs, addr, addr + 0x100);
        if (!addr1) return false;
        const addr2 = L.findBytes(bs2, addr, addr + 0x100);
        if (!addr2) return false;
        const lengthoffset = L.i32(addr1 + 2);
        const stroffset = L.u8(addr2 + 3);
        return L.NewHook({
            address: addr,
            text_fun(context, hp, buffer, split) {
                const thislength = L.u32(context.ecx + lengthoffset);
                const slen = L.strlen(context.ecx + stroffset);
                if ((lastslen !== 0) && (lastslen !== slen) && (thislength === slen)) return;
                lastslen = slen;
                if (lastlength === thislength) return;
                if (lastlength > thislength) lastlength = 0;
                buffer.from(context.ecx + stroffset + lastlength, thislength - lastlength);
                lastlength = thislength;
            },
            filter_fun: L.NewLineCharToSpaceA,
            type: L.USING_STRING,
        }, 'e_Erekiteru');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
