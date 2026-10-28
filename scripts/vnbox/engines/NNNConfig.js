// NNNConfig.js: LunaHook's NNNConfig engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/NNNConfig.cpp and NNNConfig.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const everythreadlast = new Map(); // static std::unordered_map<uintptr_t, std::string> everythreadlast

// NNNConfig::attach_function (gazelle inherits it)
function attachNNN() {
    // blackcyc
    // 夢幻廻廊
    // 復讐の女仕官ハイネ ～肢体に刻まれる淫欲のプログラム～
    // https://vndb.org/v24955
    const bytes = [
        0x68, 0xE8, 0x03, 0x00, 0x00, 0x6a, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;

    addr = addr + bytes.length;
    for (let i = 0; i < 5; i++) {
        if (L.u8(addr) === 0xe8) {
            addr += 1;
            break;
        }
        addr += 1;
    }
    let offset = L.u32(addr);
    const funcaddr = (offset + addr + 4) >>> 0;
    const check = [0x83, 0xEC, 0x1C];
    const checkoffset = L.findBytes(check, funcaddr, funcaddr + 0x20);

    if (checkoffset === 0) offset = L.stackoffset(5);
    else offset = L.stackoffset(6);
    L.hookGDIFunctions(L.FindFunction('TextOutA'));
    return L.NewHook({
        address: funcaddr,
        offset,
        type: L.USING_STRING,
        text_fun(context, hp, buffer) {
            // 当前文本可以过滤重复，上一条文本会按照换行符切分不停刷新。
            const data = context.stack[hp.offset / 4];
            const thisstr = L.readA(data);
            if ((everythreadlast.get(context.retaddr) || '') === thisstr) return;
            everythreadlast.set(context.retaddr, thisstr);
            buffer.from(data, thisstr.length);
        },
    }, 'NNNhook');
}

const E = L.engine({
    name: 'NNNConfig',
    check: { FILE: 'nnnConfig2.exe' },
    certain: false,
    attach() { return attachNNN(); },
});

const gazelle = L.engine({
    name: 'gazelle',
    // https://vndb.org/v6180
    // 海の女神 空の女神
    check: { FILE: 'nnndir/*.txt' },
    certain: false,
    attach() { return attachNNN(); },
});

module.exports = [E, gazelle];
if (!module.parent) L.run(E);
