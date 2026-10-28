// PixelGameMakerMVplayer.js: LunaHook's PixelGameMakerMVplayer engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/PixelGameMakerMVplayer.cpp and PixelGameMakerMVplayer.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function updateText() {
    let succ = false;
    for (const func of [
        '?updateText@TextGui@agtk@@QAEXV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@HHMMHHM@Z',
        '?updateText@TextGui@agtk@@QAEXV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@HHMMHH@Z',
        '?updateTextRender@TextGui@agtk@@QAEXV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@HHMMHH@Z',
        '?updateTextRender@TextGui@agtk@@QAEXV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@HHMMHHM@Z',
    ]) {
        const updatetext = L.GetProcAddress(L.GetModuleHandle(null), func);
        if (!updatetext) continue;
        succ = L.NewHook({
            address: updatetext,
            type: L.USING_STRING | L.CODEC_UTF8,
            text_fun(s, hp, buffer, role) {
                // std::string by value: arg1.. is the string object (SSO buffer inline, or a pointer), capacity at stack[6]
                if (s.stack[6] >= 0x10) buffer.fromCharPtr(s.stack[1]);
                else buffer.fromCharPtr(s.esp + 4); // &s->stack[1]
            },
        }, L.strSplit(func.substring(1), '@')[0]) || succ;
    }
    return succ;
}

function getCString(cocos2d) {
    /* v9 = (cocos2d::__String *)(*(TextData + 20))(TextData);
       CString = (char *)cocos2d::__String::getCString(v9);   <-------- CString */
    const PgetCString = L.GetProcAddress(cocos2d, '?getCString@__String@cocos2d@@QBEPBDXZ');
    if (!PgetCString) return false;
    return L.NewHook({
        address: PgetCString,
        type: L.USING_STRING | L.CODEC_UTF8 | L.FULL_STRING,
        text_fun(s, hp, buffer, role) {
            const _this = s.argof_thiscall();
            const result = _this + 28;
            if (L.u32(_this + 4 * 12) >= 0x10) return buffer.fromCharPtr(L.u32(result));
            return buffer.fromCharPtr(result);
        },
        filter_fun(buffer) {
            const s = buffer.strA();
            if (L.all_ascii(s)) return buffer.clear();
            if (s.includes(':') && s.includes('/')) return buffer.clear();
        },
    }, 'getCString');
}

function cocos2dHook() {
    const cocos2d = L.GetModuleHandle('libcocos2d.dll');
    if (!cocos2d) return false;
    return getCString(cocos2d);
}

const E = L.engine({
    name: 'PixelGameMakerMVplayer',
    check: { RESOURCE_STR: 'Pixel Game Maker MV player' },
    attach() { return updateText() | cocos2dHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
