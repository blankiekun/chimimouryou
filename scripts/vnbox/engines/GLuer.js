// GLuer.js: LunaHook's GLuer engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GLuer.cpp and GLuer.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let name = false; // static bool name
let last = ''; // static std::string last

const E = L.engine({
    name: 'GLuer',
    check: { FILE_ALL: ['bg', 'bgm', 'ev', 'obj', 'se', 'system', 'text', 'voice'] },
    certain: false,
    attach() {
        let succ = true;
        {
            const bytes = [
                0x8b, 0x54, 0x24, 0x0c,
                0x83, 0xec, 0x18,
                0x8a, 0x02,
                0x55,
                0x84, 0xc0,
                0x8b, 0xe9,
                0x0f, 0x84, ...XX4,
                0x8b, 0x4c, 0x24, 0x2c,
                0x53,
                0x81, 0xe1, 0x00, 0x00, 0x00, 0xff,
                0x56];
            const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
            if (!addr) return false;
            succ = L.NewHook({
                address: addr,
                type: L.USING_STRING | L.FULL_STRING,
                offset: 0xc,
                filter_fun(buffer) {
                    const s = buffer.strA();
                    if (s.length > 2 && name) {
                        name = !name;
                    } else buffer.clear();
                },
            }, 'GLuer') && succ;
        }
        {
            const bytes = [
                0x83, 0xec, 0x20,
                0x8b, 0x44, 0x24, 0x28,
                0x53,
                0x8b, 0xd9,
                0x55,
                0x8b, 0x4c, 0x24, XX,
                0x8b, 0x6c, 0x24, XX,
                0x83, 0xc1, 0x04,
                0x56,
                0x57,
                0x89, 0x44, 0x24, XX,
                0x89, 0x4c, 0x24, XX,
                0xc7, 0x44, 0x24, 0x14, 0x20, 0x00, 0x00, 0x00];
            const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
            if (!addr) return false;
            succ = L.NewHook({
                address: addr,
                type: L.USING_STRING | L.FULL_STRING,
                filter_fun(buffer) {
                    let s = buffer.strA();
                    if (last === s) return buffer.clear();
                    last = s;
                    name = true;
                    s = L.re.sub(s, String.raw`\n(\x81\x40)*`);
                    buffer.fromA(s);
                },
                text_fun(context, hp, buffer, split) {
                    let s = '';
                    const a4 = context.stack[3];
                    let v19 = a4 + 4; // int ***
                    let v14 = 32;
                    let v11;
                    do {
                        let v6 = L.u32(v19); // int **
                        if (v6) {
                            while (true) {
                                const v13 = L.u32(v6);
                                s += L.readA(L.u32(v6 + 8)); // (char *)v6[2]
                                if (!v13) break;
                                v6 = v13;
                            }
                        }
                        s += '\n';
                        v11 = v14 === 1;
                        v19 += 7 * 4;
                        --v14;
                    } while (!v11);
                    buffer.fromA(s);
                },
            }, 'GLuer') && succ;
        }
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
