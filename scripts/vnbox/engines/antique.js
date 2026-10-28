// antique.js: LunaHook's antique engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/antique.cpp and antique.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let i = 0; // static int i

const E = L.engine({
    name: 'antique',
    check: { FILE_ALL: ['*.VMC', 'vorbis.acm', 'SE.DAT', 'PACK.DAT'] },
    certain: false,
    attach() {
        // https://vndb.org/v3122
        // あそび塾
        const bytes = [
            // cmp byte ptr [eax], 81h; jnz; mov al, [eax+1]; cmp al, 41h ('A'); jl; cmp al, 44h ('D'); jg
            // if ( *(_BYTE *)dword_43E5B4 == 0x81 && (v14 = *(_BYTE *)(dword_43E5B4 + 1), v14 >= 65) && v14 <= 68 )
            0x80, 0x38, 0x81,
            0x75, XX,
            0x8a, 0x40, 0x01,
            0x3c, 0x41,
            0x7c, XX,
            0x3c, 0x44,
            0x7f, XX];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING | L.DATA_INDIRECT | L.USING_SPLIT | L.SPLIT_INDIRECT,
            offset: L.stackoffset(1),
            split: L.stackoffset(3),
            filter_fun(buffer) {
                if (i++ % 2) return buffer.clear();
                L.StringFilterA(buffer, '\\n');
            },
        }, 'antique'); // embed_hook_font left out (translation embedding)
    },
});

module.exports = E;
if (!module.parent) L.run(E);
