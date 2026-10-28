// DISCOVERY.js: LunaHook's DISCOVERY engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/DISCOVERY.cpp and DISCOVERY.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function DISCOVERY1() {
    // https://vndb.org/v4053
    // 小雪の朱－コユキノアカ－
    const sig = [
        /*
        if ( *(v6 - 2) != 23
          || *(v6 - 3) != sub_40C130(255, 255, 255)
          || sub_418190(*(v6 - 4), v6 - 1) != 1
          || dword_B81054 && dword_975570 )*/
        0x83, 0x7b, 0xf8, 0x17,
        0x75, XX,
        0x68, 0xff, 0x00, 0x00, 0x00,
        0x68, 0xff, 0x00, 0x00, 0x00,
        0x68, 0xff, 0x00, 0x00, 0x00,
        0xe8];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR,
        text_fun(context, hp, buffer, split) {
            const v6 = context.ebx - 4 * 4; // (int *)ebx - 4
            buffer.from_t(L.u32(v6) & 0xffff, 2);
        },
    }, 'DISCOVERY');
}

function DISCOVERY2() {
    // [090828] [DISCOVERY MARS] 寝盗られ女教師 美帆先生○×日誌
    const sig1 = [
        // v3 = *(int *)((char *)&dword_507F64 + v0); if ( v3 == 16513 )
        0x8b, XX, ...XX4,
        0x3d, 0x81, 0x40, 0x00, 0x00];
    let succ = false;
    for (let addr of L.SearchMemory(sig1, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        const strptr = L.i32(addr + 2);
        const sig = [
            // if ( *(int *)((char *)&dword_507F6C + v0) != 26
            //   || *(int *)((char *)&dword_507F68 + v0) != sub_40D1A0()
            //   || sub_41A160(*(int *)((char *)&dword_507F64 + v0)) != 1
            //   || dword_4D9AAC && dword_CCEE90 )
            0x83, 0xbe, ...XX4, 0x1a,
            0x75, XX,
            0xb9, 0xff, 0x00, 0x00, 0x00,
            0x8b, 0xd1,
            0x8b, 0xc1,
            0xe8];
        addr = L.reverseFindBytes(sig, addr - 0x100, addr);
        if (!addr) continue;
        succ = L.NewHook({
            address: addr,
            type: L.USING_CHAR,
            user_value: strptr,
            text_fun(context, hp, buffer, split) {
                const c = context.esi + hp.user_value;
                buffer.from_t(L.u32(c) & 0xffff, 2);
            },
        }, 'DISCOVERY') || succ;
    }
    return succ;
}

const E = L.engine({
    name: 'DISCOVERY',
    check: { FILE_ALL: ['BG.PD', 'CG.PD', 'CHIP.PD', 'SE.PB', 'STAND.PD', 'VOICE.PB', '*.ID'] },
    certain: false,
    attach() { return DISCOVERY1() || DISCOVERY2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
