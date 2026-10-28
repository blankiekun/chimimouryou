// Anim.js: LunaHook's Anim engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Anim.cpp and Anim.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertAnimHook() {
    const bytes = [0xC7, 0x45, 0xFC, 0x01, 0x00, 0x00, 0x00, 0x8B, 0x4D, 0x10, 0x51, 0x8D, 0x8D, 0x40, 0x7E, 0xFF, 0xFF];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    // embed flags and embed_hook_font left out (translation embedding); /HQ: NO_CONTEXT takes the text of every thread
    return L.NewHook({ address: addr + 10, type: L.USING_STRING | L.NO_CONTEXT, offset: L.regoffset('ecx') }, 'Anim');
}

function InsertAnim2Hook() {
    const bytes = [0xC7, 0x45, 0xFC, 0x01, 0x00, 0x00, 0x00, 0x8B, 0x45, 0x10, 0x50, 0x8D, 0x8D, 0xAC, 0x7E, 0xFF, 0xFF];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    // メスつまみ３
    // そんな俺に声をかけてきたのは、近所のスーパーで働いている主婦の、@n『@[赤羽:あかばね]@[千晶:ちあき]』さんだ。
    // 僕がいない間に変貌えられた妻の秘肉 ～ラブラブ新婚妻は他の男に抱かれ淫らに喘ぐ夢を見るか～ 体験版
    return L.NewHook({
        address: addr + 10,
        filter_fun(buffer) {
            let result = buffer.strA();
            result = L.re.sub(result, String.raw`@\[(.*?):(.*?)\]`, '$1');
            buffer.fromA(result);
        },
        lineSeparator: '@n',
        type: L.USING_STRING | L.NO_CONTEXT,
        offset: L.regoffset('eax'),
    }, 'Anim2');
}

function Anim3Filter(buffer) {
    L.StringFilterBetweenA(buffer, '\x81\x40', '@m'); // @r(2,はと)
    L.StringFilterBetweenA(buffer, '\x81\x40', '@n'); // @r(2,はと)
    L.StringCharReplacerA(buffer, '@b', ' ');
    L.StringCharReplacerA(buffer, '\x81\x42', '.');
    L.StringCharReplacerA(buffer, '\x81\x48', '?');
    L.StringCharReplacerA(buffer, '\x81\x49', '!');
}

function InsertAnim3Hook() {
    /*
     * Sample games:
     * https://vndb.org/v17427
     * https://vndb.org/v18837
     */
    const bytes = [
        0xCC, // int 3
        0x55, // push ebp      << hook here
        0x8B, 0xEC, // mov ebp,esp
        0x81, 0xEC, ...XX4, // sub esp,00000830
        0xA1, ...XX4, // mov eax,[musu_mama.exe+A91F0]
        0x33, 0xC5, // xor eax,ebp
        0x89, 0x45, 0xE8, // mov [ebp-18],eax
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr + 1, offset: L.regoffset('edx'), type: L.USING_STRING, filter_fun: Anim3Filter }, 'Anim3');
}

const E = L.engine({
    name: 'Anim',
    check: { FILE: 'voice\\*.pck' },
    certain: false,
    attach() {
        L.hookGDIFunctions(L.FindFunction('GetGlyphOutlineA'));
        let b1 = InsertAnimHook() || InsertAnim2Hook();
        b1 = InsertAnim3Hook() || b1;
        return b1;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
