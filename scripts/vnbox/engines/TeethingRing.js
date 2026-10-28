// TeethingRing.js: LunaHook's TeethingRing engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TeethingRing.cpp and TeethingRing.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// Left out: TeethingRing_attach_function (キミとボクとエデンの林檎, HSF932#-C@85FB0:EDEN.exe): its text_fun
// calls the game's virtual function at vtable+60 to get the string (a call into the guest, not possible
// here). LunaHook tries it first; here the others run.

function TeethingRing_attach_function2() {
    // https://vndb.org/v791
    // きると
    const bytes = [
        0x8b, 0x4e, 0x18,
        0x83, 0xf9, 0x10,
        0x53,
        0x8d, 0x5e, 0x04,
        0x72, 0x04,
        0x8b, 0x13,
        0xeb, 0x02,
        0x8b, 0xd3,
        0x83, 0xf9, 0x10,
        0x72, 0x04,
        0x8b, 0x0b,
        0xeb, 0x02];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT | L.FULL_STRING,
        text_fun(context, hp, buffer, split) {
            const _this = context.argof_thiscall(0);
            const v13 = L.u32(_this + 24);
            const v14 = _this + 4;
            const v16 = v13 < 0x10 ? v14 : L.u32(v14);
            const a2 = context.argof(1);
            split.value = _this;
            buffer.fromCharPtr((v16 + a2) >>> 0);
        },
        filter_fun(buffer) {
            let str = buffer.strA();
            if (L.all_ascii(str)) return buffer.clear();
            str = L.strReplace(str, '#F');
            // 俺はこのアクシデントが、何か幸#<さい>先#<さき>のいいもののように思えて、鞄を抱え直してギルドへの階段を昇り始めた。
            str = L.re.sub(str, '#<(.*?)>');
            buffer.fromA(str);
        },
    }, 'TeethingRing');
}

function Garnet_Cradle() {
    // Garnet Cradle
    const bytes = [
        0x66, 0x3d, 0x80, 0x00,
        0x72, 0x06,
        0x66, 0x3d, 0x9f, 0x00,
        0x76, 0x10,
        0x8d, 0x88, ...XX4,
        0x66, 0x83, 0xf9, 0x1f,
        0x0f, 0x87, ...XX4,
        0x8b, XX, XX,
        0x66, 0x8b, 0x50, 0xff,
        0x83, 0xc0, 0x01];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + bytes.length, offset: L.regoffset('edx'), type: L.USING_CHAR | L.NO_CONTEXT }, 'Garnet Cradle');
}

const E = L.engine({
    name: 'TeethingRing',
    check: { RESOURCE_STR: 'TeethingRing' },
    certain: false,
    attach() { return TeethingRing_attach_function2() || Garnet_Cradle(); },
});

module.exports = E;
if (!module.parent) L.run(E);
