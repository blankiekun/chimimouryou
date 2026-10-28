// T2U.js: LunaHook's T2U engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/T2U.cpp and T2U.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// lru_cache<std::string> cache(5): touch(s) is true when s is cached (and refreshes it), else it inserts s
const cache = [];
function touch(s) {
    const i = cache.indexOf(s);
    if (i >= 0) {
        cache.splice(i, 1);
        cache.push(s);
        return true;
    }
    cache.push(s);
    if (cache.length > 5) cache.shift();
    return false;
}

const E = L.engine({
    name: 'T2U',
    //(18禁ゲーム)[000128][BLUE GALE] Treating2U (bin+cue)
    check: { FILE_ALL: ['*.zbm', 'scene00.bdt', '*.dat', '*.Snn'] },
    attach() {
        return L.NewHook({
            address: L.FindFunction('TextOutA'), // 这个游戏设置embed_hook_font会卡死
            type: L.USING_STRING,
            offset: L.stackoffset(4),
            filter_fun(buffer) {
                if (touch(buffer.strA())) return buffer.clear();
            },
        }, 'T2U');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
