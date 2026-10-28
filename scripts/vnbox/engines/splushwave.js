// splushwave.js: LunaHook's splushwave engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/splushwave.cpp and splushwave.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function splushwave_(buf) {
    let addr = L.findBytes(buf, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = Math.max(L.findfuncstart(addr, 0x300), // ドラゴンファーム Version 2.05
        L.findEnclosingAlignedFunction(addr));
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
        filter_fun(buffer) {
            /*
            [VID_Z_RIZ_016]リーゼロッテ「知ってるわ。でも、これから徐々に――」
            提督「強くなれないのに強敵と戦うのか？　それではいつか死ぬだけだ」
            #STM:リーゼロッテ＿怒り[VID_Z_RIZ_017]リーゼロッテ「…………」
            #EVENT_FLAG_ON:Ｅ＿ＯＰ＿終了#BGM_FADEOUT#FADE_SET#FADEOUT_BK
            #BGM:ＫＭ＿強化#FADE_SET#MES_CLR#MES_OFF#CG_CLR#BG:調教部屋#FADE_IN
            */
            if (buffer.data[0] === 0x23) return buffer.clear(); // '#'
            L.StringFilterBetweenA(buffer, '[', ']');
        },
    }, 'splushwave');
}

function umw() {
    const bytes = [
        0x8b, 0x54, 0x24, 0x04,
        0x56, 0x57,
        0x33, 0xf6,
        0x8b, 0xfa,
        0x83, 0xc9, 0xff,
        0x33, 0xc0,
        0x89, XX, ...XX4,
        0xf2, 0xae,
        0xf7, 0xd1,
        0x49,
        0x89, XX, ...XX4,
        0xd1, 0xe9,
        0x89, XX, ...XX4,
        0x89, XX, ...XX4,
        0x8b, XX, ...XX4,
        0xb9, 0x14, 0x00, 0x00, 0x00,
        0xb8, 0x18, 0x00, 0x00, 0x00];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.FULL_STRING | L.NO_CONTEXT,
        filter_fun(buffer) {
            if (buffer.data[0] === 0x23) return buffer.clear(); // '#'
            L.StringFilterBetweenA(buffer, '[', ']');
            L.StringFilterA(buffer, 'CR');
        },
    }, 'umw');
}

const E = L.engine({
    name: 'splushwave',
    check: () => L.SearchResourceString('splush wave') ||
        L.CheckFileAll(['Syuusei.dat', '*_ADD.DAT', '*_BASE.DAT', '*_CG.DAT', '*_SE.DAT', '*_VOI.DAT', '*_BOOT.DAT']) || // とある魔雀の禁書目録
        L.CheckFileAll(['Syuusei.dat', '*_BASE.DAT', '*_BGM.DAT', '*_SE.DAT', '*_KOE.DAT', 'BOOT.DAT']), // Unlimited Mahjongg Works
    certain: false,
    attach() {
        // https://vndb.org/r113134
        // 天色戦姫 体験版 https://gyutto.com/i/item128979?select_uaflag=1
        const aErrMesbufS = L.aToBytes('err:mesbuf %s\0\0');
        // ドラゴンアカデミー  http://gyutto.com/i/item98617?select_uaflag=1
        // ドラゴンアカデミー3  http://gyutto.com/i/item208616?select_uaflag=1
        const aCidS = L.aToBytes('CID_%s\0\0');
        const r1 = splushwave_(aErrMesbufS);
        const r2 = splushwave_(aCidS); // `|`: both run
        return (r1 || r2) || umw();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
