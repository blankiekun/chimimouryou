// Aromarie.js: LunaHook's Aromarie engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Aromarie.cpp and Aromarie.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// https://vndb.org/v2330
// 月ノ光太陽ノ影
const E = L.engine({
    name: 'Aromarie',
    check: { FILE_ALL: ['scene.db', 'script.axr', 'se.axr', 'system.db', 'user.db', 'koe.axr', 'cg.axr', 'bgm.axr'] },
    certain: false,
    attach() {
        const name = (() => {
            const paSelectNameVoic = L.findBytes(L.aToBytes('select name,voiceBase,soundMode from envCharacter where name=?;\0'), L.processStartAddress, L.processStopAddress);
            if (!paSelectNameVoic) return false;
            const push = L.findPushAddress(paSelectNameVoic, L.processStartAddress, L.processStopAddress);
            if (!push) return false;
            let addr = L.findEnclosingAlignedFunction(push);
            if (!addr) return false;
            const checks = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
            if (!checks.length) return false;
            const last = checks[checks.length - 1];
            addr = L.findEnclosingAlignedFunction(last);
            if (!addr) return false;
            // embed flags left out (translation embedding)
            return L.NewHook({ address: addr, type: L.USING_STRING | L.NO_CONTEXT, offset: L.stackoffset(1) }, 'AromarieName');
        })();
        const text = (() => {
            const sig = [
                // if ( (unsigned __int8)((v6 ^ 0x20) + 95) < 0x3Cu )
                // mov cl, al; xor ecx, 20h; add ecx, 5Fh; and ecx, 0FFh; cmp ecx, 3Ch; jl; cmp al, 5Ch ('\')
                0x8A, 0xC8,
                0x83, 0xF1, 0x20,
                0x83, 0xC1, 0x5F,
                0x81, 0xE1, 0xFF, 0x00, 0x00, 0x00,
                0x83, 0xF9, 0x3C,
                0x0F, XX, ...XX4,
                0x3C, 0x5C];
            const check = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
            if (!check) return false;
            let addr = L.findEnclosingAlignedFunction(check);
            if (!addr) return false;
            const checks = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
            if (!checks.length) return false;
            const last = checks[checks.length - 1];
            addr = L.findEnclosingAlignedFunction(last);
            if (!addr) return false;
            return L.NewHook({
                address: addr,
                type: L.USING_STRING | L.NO_CONTEXT,
                offset: L.stackoffset(1),
                filter_fun(buffer) {
                    let s = buffer.strA();
                    s = L.re.sub(s, String.raw`\\\w`);
                    s = L.re.sub(s, '%.*?%');
                    buffer.fromA(s);
                },
            }, 'AromarieText');
        })();
        return name && text;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
