// R11.js: LunaHook's R11 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/R11.cpp and R11.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// Remember 11
function ff(buffer) {
    // StringFilter(buffer, "%XS", 5): remove %XS followed by 2 chars
    let a = buffer.strA();
    for (let at = a.indexOf('%XS'); at >= 0; at = a.indexOf('%XS', at)) a = a.slice(0, at) + a.slice(at + 5);
    buffer.fromA(a);
    const str = buffer.strAW();
    let result1 = L.re.sub(str, String.raw`\{(.*?):(.*?)\}`, '$1');
    result1 = L.re.sub(result1, String.raw`\{(.*?);(.*?)\}`, '$1');
    result1 = L.re.sub(result1, '%[A-Z]+', '');
    buffer.fromWA(result1);
}

function maintext() {
    const check = [
        0x8a, 0x11,
        0x83, 0xc1, 0x01,
        0x84, 0xd2,
        0x75, 0xf7,
        0x2b, 0x4c, 0x24, 0x24,
        0x03, 0xc1,
        0x80, 0x38, 0x81,
        0x75, XX,
        0x8a, 0x40, 0x01,
        0x3c, 0x75,
        0x0f, 0x84, ...XX4,
        0x3c, 0x77,
        0x0f, 0x84, ...XX4,
        0x3c, 0x69,
        0x74, XX];
    let addr = L.findBytes(check, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    // embed_fun (English text written back into the game) left out; EMBED_ABLE dropped
    return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(1), filter_fun: ff }, 'R11');
}

function sentakushi() {
    const check = [
        0xc1, 0xe0, 0x0c,
        0x99,
        0x81, 0xe2, 0xff, 0x0f, 0x00, 0x00,
        0x03, 0xc2,
        0x8b, 0x96, 0x10, 0x02, 0x00, 0x00,
        0xc1, 0xf8, 0x0c,
        0x2d, 0xff, 0x0f, 0x00, 0x00,
        0xc1, 0xf8, 0x0c,
        0x2b, 0xd0];
    let addr = L.findBytes(check, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const start = [0xCC, 0xCC, 0x53];
    addr = L.reverseFindBytes(start, addr - 0x100, addr, 2, true);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING | L.FULL_STRING, offset: L.stackoffset(3), filter_fun: ff }, 'R11');
}

const E = L.engine({
    name: 'R11',
    check: { FILE_ANY: ['FILE/bg.afs', 'FILE/bgm.afs', 'FILE/bgmpc.afs', 'FILE/chr.afs', 'FILE/etc.afs', 'FILE/ev.afs', 'FILE/file.afs', 'FILE/mac.afs', 'FILE/se.afs', 'FILE/voice.afs'] },
    attach() { return maintext() && sentakushi(); },
});

module.exports = E;
if (!module.parent) L.run(E);
