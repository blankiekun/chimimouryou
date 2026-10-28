// Moonstone.js: LunaHook's Moonstone engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Moonstone.cpp and Moonstone.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Moonstone',
    check: () => L.CheckFileAll(['bgm.pak', 'data.pak', 'voice.pak']) && L.SearchResourceString('mts'),
    attach() {
        // https://vndb.org/v464
        // あした出逢った少女
        const bytes = [
            // do { v6 = *v2; ++v5; ++v2; if (v6 >= 0x81 && v6 <= 0x9F || v6 >= 0xE0 && v6 <= 0xFC || v6 > 0x5C && v6 < 0x70) { ++v2; ++v3; } ++v3; } while (v3 < v4 - 1);
            0x8a, 0x02,
            0x47, 0x42,
            0x3c, 0x81, 0x72, 0x04,
            0x3c, 0x9f, 0x76, 0x10,
            0x3c, 0xe0, 0x72, 0x04,
            0x3c, 0xfc, 0x76, 0x08,
            0x3c, 0x5c, 0x76, 0x06,
            0x3c, 0x70, 0x73, 0x02,
            0x42,
        ];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING,
            text_fun(context, hp, buffer) {
                if (context.edi !== 0) return;
                buffer.fromCharPtr(context.edx);
            },
            filter_fun(buffer) {
                L.StringFilterA(buffer, '\x81\x89'); // ♂
                L.StringFilterA(buffer, '\x81\x6f');
                L.StringFilterA(buffer, '\x81\x70'); // ｛｝ 上标·
                const s = buffer.strA();
                if (s.length % 2 === 1) {
                    let sub = s.substr(0, s.length - 1);
                    if (s.endsWith('^')) { // 0x5e
                        sub += '\x81\x42'; // 。
                    } else if (s.endsWith('_')) { // 0x5f
                        sub += '\x81\x76'; // 」
                    } else if (s.endsWith(']')) { // 0x5d
                        // 、 8141 多了个]，不用补
                    } else if (s.endsWith('b')) { // 0x62
                        sub += '\x81\x48'; // ？
                    } else if (s.endsWith('a')) { // 0x61
                        sub += '\x81\x6a'; // ）
                    }
                    buffer.fromA(sub);
                }
            },
        }, 'Moonstone');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
