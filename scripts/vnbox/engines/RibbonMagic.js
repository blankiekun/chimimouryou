// RibbonMagic.js: LunaHook's RibbonMagic engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RibbonMagic.cpp and RibbonMagic.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'RibbonMagic',
    check: { FILE_ALL: ['setup', 'voice', 'se', 'scenario', 'cg', 'cg.dat', 'bgm', 'system'] },
    certain: false,
    attach() {
        // https://vndb.org/v807
        // クレプシドラ～光と影の十字架～
        const bytes2 = [
            0x83, 0xec, XX,
            0xa1, ...XX4,
            0x53,
            0x89, XX, XX, XX,
            0x55,
            0x33, 0xc0,
            0x56,
            0x57,
            0x8b, 0xe9,
            0x89, XX, XX, XX,
            0x8b, XX, XX, XX,
            0x8b, XX, XX, XX,
            0xf7, 0xd8,
            0x1b, 0xc0,
            0x89, XX, XX, XX,
            0x24, 0xfc,
            0xc7, XX, XX, XX, 0x20, 0x00, 0x00, 0x00,
            0x83, 0xc0, 0x08];
        const addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        let last = ''; // static std::string last
        return L.NewHook({
            address: addr,
            type: L.USING_STRING,
            filter_fun(buffer) {
                const s = buffer.strA();
                if (s.startsWith(last)) buffer.fromA(s.substr(last.length));
                last = s;
            },
            text_fun(context, hp, buffer) {
                const a4 = context.stack[3];
                let ss = '';
                // v8 points at nodes { next, ?, char *text, char *text2 }
                let v16 = a4 + 4;
                let v18 = 32;
                let v14;
                do {
                    let v8 = L.u32(v16);
                    if (v8) {
                        while (true) {
                            const v17 = L.u32(v8);
                            ss += L.readA(L.u32(v8 + 8));
                            if (L.i32(L.u32(v8 + 12) - 8)) ss += L.readA(L.u32(v8 + 12));
                            if (!v17) break;
                            v8 = v17;
                        }
                    }
                    v14 = v18 === 1;
                    v16 += 7 * 4;
                    --v18;
                } while (!v14);
                buffer.fromA(ss);
            },
        }, 'clep');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
