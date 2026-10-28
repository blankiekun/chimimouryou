// Arcturus.js: LunaHook's Arcturus engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Arcturus.cpp and Arcturus.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function h2() {
    // 二世の契り
    const bytes2 = [
        0x8b, 0x44, 0x24, 0x04,
        0x56,
        0x8b, 0x74, 0x24, 0x0c,
        0x8a, 0x0e,
        0x84, 0xc9,
        0x74, XX,
        XX,
        0x80, 0xf9, 0x24,
        0x75, XX,
        0x8a, 0x4e, 0x01,
        0x46,
        0x80, 0xf9, 0x6e,
        0x75, XX];
    const addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        type: L.USING_STRING,
        address: addr,
        offset: L.stackoffset(2),
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`\x81\x6f(.*?)\x81\x5e(.*?)\x81\x70`, '$2');
            s = L.re.sub(s, String.raw`@c\d(.*?)@c`, '$1');
            s = L.re.sub(s, '[\r\n]+(\x81\x40)*');
            buffer.fromA(s);
        },
    }, 'Arcturus2');
}

function h1() {
    // https://github.com/HIllya51/LunaTranslator/issues/1824
    // https://vndb.org/v23847
    // ときめき にゃの☆げっちゅ！
    // https://archive.org/details/tokimeki-nya-no-getchu
    // https://github.com/HIllya51/LunaTranslator/issues/1825
    // https://vndb.org/v23852
    // げっちゅ屋★げっちゅ！！
    // https://archive.org/details/getchu-yagetchu
    const bytes = [
        0x57,
        0xe8, ...XX4,
        0x83, 0xc4, 0x04,
        0x85, 0xc0,
        0x75, XX,
        0x8a, 0x07,
        0x3c, 0x20,
        0x7c, XX,
        0x3c, 0x7f,
        0x7d, XX,
        0x0f, 0xbe, 0xc0,
        0x8d, 0x0c, 0x45, ...XX4,
        0x51,
        0xe8, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x20);
    if (!addr) return false;
    return L.NewHook({ type: L.USING_STRING, address: addr, offset: L.stackoffset(3) }, 'Arcturus');
}

let type = 0; // the check sets it, attach reads it

const E = L.engine({
    name: 'Arcturus',
    certain: false,
    check: () => {
        if (!L.CheckFileAll(['advdata/voice.dat', 'advdata/mes/*.mes', 'advdata/se/*.pcm'])) return false;
        if (L.SearchResourceString('Getchu')) type = 1;
        else if (L.SearchResourceString('LANTERNROOMS') && L.SearchResourceString('NISE')) type = 2;
        return type !== 0;
    },
    attach() {
        if (type === 1) return h1();
        if (type === 2) return h2();
        return false;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
