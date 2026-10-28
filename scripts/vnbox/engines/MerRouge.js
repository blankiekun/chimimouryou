// MerRouge.js: LunaHook's MerRouge engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/MerRouge.cpp and MerRouge.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'MerRouge',
    check: { FILE_ALL: ['bmp/*.pak', 'cv/*.pcv', 'scenario/*.txt', 'SE/*.wav'] },
    attach() {
        // https://vndb.org/v12120
        const addrs = new Set(); // static std::set<uintptr_t> addrs
        return L.NewHook({
            address: L.FindFunction('TextOutA'),
            offset: L.stackoffset(4),
            type: L.USING_STRING, // 可以内嵌，但是需要修改TextOutA导致递归崩溃
            text_fun(context, hp, buffer, split) {
                const addr = context.stack[4];
                if (addrs.has(addr - 4)) return;
                addrs.add(addr);
                buffer.fromCharPtr(addr);
            },
        }, 'MerRouge');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
