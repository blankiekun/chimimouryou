// Jellyfish.js: LunaHook's Jellyfish engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Jellyfish.cpp and Jellyfish.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let ism = 0, minaddr = 0, maxaddr = 0;

function Jellyfish_attach_function() {
    // https://vndb.org/r13456
    // GREEN～秋空のスクリーン～ STANDARD EDITION
    // https://vndb.org/r1136
    // LOVERS～恋に落ちたら…～
    const bytes = [
        0x8a,
        XX,
        0x01, // mov     cl, [ecx+1]
        0x80,
        XX,
        0x6e, // cmp     cl, 6Eh ; 'n'
        0x75,
        XX,
    ];
    let addr = L.findBytes(bytes, minaddr, maxaddr);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x1000);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING,
        filter_fun(buffer) {
            if (buffer.data.length === 2) return buffer.clear();
            L.StringCharReplacerA(buffer, '\\n', '\n');
            L.StringCharReplacerA(buffer, '\\N', '\n');
            L.StringFilterA(buffer, '\x81\xa4');
            L.StringFilterA(buffer, '\x81\x40');

            buffer.fromA(L.re.sub(buffer.strA(), String.raw`\\[0-7a-zA-Z]+`));
        },
    }, 'Jellyfish');
}

function Jellyfish_attach_function2() {
    // https://vndb.org/r109826
    // Sisters: Last Day of Summer
    const bytes = [0x68, 0xB0, 0x04, 0x00, 0x00, 0x68, 0x40, 0x06, 0x00, 0x00];
    const count = new Map();
    let maxa = 0;
    let maxi = 0;
    for (let _ of L.SearchMemory(bytes, L.PAGE_EXECUTE, minaddr, maxaddr)) {
        _ = L.findfuncstart(_);
        if (_ === 0) continue;
        count.set(_, (count.get(_) || 0) + 1);
        if (count.get(_) >= maxi) {
            maxi = count.get(_);
            maxa = _;
        }
    }
    if (maxa === 0) return false;
    return L.NewHook({
        address: maxa, // 0x2F2E1+(DWORD)ism;
        type: L.USING_CHAR | L.CODEC_UTF16,
        text_fun(context, hp, buffer, split) {
            if (context.argof(3) === 3) return;
            split.value = context.argof(3) !== 0 ? 1 : 0; // 多行文本
            buffer.from_t(context.argof(1) & 0xffff, 2);
            // 不可以快进，否则会有重复
        },
    }, 'Jellyfish');
}

function Jellyfish_attach_function3() {
    // https://vndb.org/v2249
    // DEEP VOICE

    // 不可以快进，否则会有重复
    const bytes = [
        0x03, 0xd0,
        0x81, 0xFA, 0xE0, 0x01, 0x00, 0x00,
        0x0f, 0x8f, ...XX4];
    let addr = L.findBytes(bytes, minaddr, maxaddr);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_CHAR }, 'Jellyfish3');
}

const E = L.engine({
    name: 'Jellyfish',
    check: () => {
        ism = L.GetModuleHandle('ism.dll');
        return ism;
    },
    certain: false,
    attach() {
        [minaddr, maxaddr] = L.QueryModuleLimits(ism);
        return Jellyfish_attach_function() || Jellyfish_attach_function2() || Jellyfish_attach_function3();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
