// Hug.js: LunaHook's Hug engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Hug.cpp and Hug.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Hug',
    check: () => L.CheckFileAll(['data/data*.hud', 'data/img.hud', 'data/mv.hud', 'data/se.hud',
        'data/txt.hud', 'data/vo.hud', 'data/bgm/*.hum']) && L.SearchResourceString('Copyright (C)Hug'),
    attach() {
        const sig = L.aToBytes('\x83\x74\x83\x48\x83\x93\x83\x67\x83\x6E\x83\x93\x83\x68\x83\x8B\x92\x6C\x82\xAA\x88\xD9\x8F\xED\x82\xC5\x82\xB7\x0A\0');
        let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;

        const lasts = new Map(); // static std::map<std::pair<int, int>, std::string> lasts
        return L.NewHook({
            address: addr,
            type: L.USING_STRING,
            text_fun(context, hp, buffer, split) {
                const x = context.stack[1] | 0;
                const y = context.stack[2] | 0;
                if (x !== 0x37 && x !== 0x3c) return;
                const text = L.readA(context.stack[3]);
                split.value = x;
                const p = x + ',' + y;
                const thislast = lasts.get(p) || '';
                const parse = (s) => L.strReplace(s, '\x81\x40');
                if (thislast.length && L.startWith(text, thislast)) buffer.fromA(parse(text.substr(thislast.length)));
                else buffer.fromA(parse(text));
                lasts.set(p, text);
            },
        }, 'Hug');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
