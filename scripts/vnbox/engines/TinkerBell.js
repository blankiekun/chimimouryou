// TinkerBell.js: LunaHook's TinkerBell engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TinkerBell.cpp and TinkerBell.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

function InsertTinkerBellHook() {
    let count = 0;
    const start = L.processStartAddress, stop = L.processStopAddress;
    const { bytes: b, base } = L.region(start - 2, stop);
    const at = (a) => b[a - base] || 0;
    for (let i = start; i < stop - 4; i++) {
        if (at(i) !== 0x41 || at(i + 1) !== 0x81 || at(i + 2) !== 0 || at(i + 3) !== 0) continue; // *(DWORD *)i == 0x8141
        let t = at(i - 1);
        let offset = 0, address = 0;
        if (t === 0x3d || t === 0x2d) {
            offset = L.regoffset('eax');
            address = i - 1;
        } else if (at(i - 2) === 0x81) {
            t &= 0xf8;
            if (t === 0xf8 || t === 0xe8) {
                offset = -8 - ((at(i - 1) & 7) << 2);
                address = i - 2;
            }
        }
        if (address) {
            if (L.NewHook({ address, offset, type: L.CODEC_ANSI_BE | L.NO_CONTEXT }, 'TinkerBell')) count++;
        }
    }
    return count > 0;
}

function WendyBell_filter(buffer) {
    let wc = buffer.strW();
    for (let i = 0; i < wc.length - 1; i++) {
        if (wc[i] === '\xff' && wc[i + 1] === '\xff') {
            wc = wc.substr(0, i) + wc.substr(i + 3 + (wc.charCodeAt(i + 2) || 0));
        }
    }
    for (let i = 0; i < wc.length; i++) {
        if (wc.charCodeAt(i) < 10) {
            wc = wc.substr(0, i) + wc.substr(i + 1);
        }
    }
    wc = L.strReplace(wc, '\xfe');
    buffer.fromW(wc);
}

let last = '';
function tkbl_filter(buffer, hp) {
    L.StringFilterW(buffer, '\u26bc\x65\x25\uffff'); // 移除心形
    WendyBell_filter(buffer, hp);
    const str = buffer.strW(); // 末尾存在一个换行符
    if (last === str) return buffer.clear();
    last = str;
    buffer.fromW(str);
}

function tkbl() {
    // せをはやみ
    const bytes = [
        0x55, 0x8b, 0xec,
        0x83, 0xec, 0x0c,
        0x53, 0x56,
        0x8b, 0xf1,
        0x8b, 0x5e, 0x10,
        0x8b, 0x4e, 0x14,
        0x89, 0x5d, 0xf4,
        0x89, 0x4d, 0xfc,
        0x3b, 0xd9];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // Left out: the text_fun's call fuck(stack[1], retaddr) and the second hook "tkbl2" (人妻上司の分からせ方) on
    // that function (DECLARE_FUNCTION: a native function injected into the game that only re-emits a character).
    return L.NewHook({
        type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT,
        address: addr,
        filter_fun: tkbl_filter,
        text_fun(context, hp, buffer, split) {
            const str = context.ebx;
            const ws = L.readW(str);
            split.value = (ws.includes('【') && ws.includes('】')) ? 1 : 0;
            buffer.fromWCharPtr(str);
        },
        offset: L.regoffset('ebx'),
    }, 'tkbl');
}

function InsertWendyBellHook() {
    const bytes = [
        0x83, 0xbe, ...XX4, 0x00,
        0x8b, ...XX2,
        0x0f, 0x85, ...XX4,
        0x83, 0xbe, ...XX4, 0x00,
        0x0f, 0x85, ...XX4,
        0x83, 0xbe, ...XX4, 0x00,
        0x0f, 0x84, ...XX4,
        // .always:0048E4CA 83 BE F8 04 00 00 00          cmp     dword ptr[esi + 4F8h], 0
        // .always : 0048E4D1 8B 5D 84                      mov     ebx,[ebp + Src]
        // .always : 0048E4D4 0F 85 86 F8 FF FF             jnz     loc_48DD60
        // .always : 0048E4DA 83 BE F4 04 00 00 00          cmp     dword ptr[esi + 4F4h], 0
        // .always : 0048E4E1 0F 85 79 F8 FF FF             jnz     loc_48DD60
        // .always : 0048E4E7 83 BE 00 05 00 00 00          cmp     dword ptr[esi + 500h], 0
        // .always : 0048E4EE 0F 84 6C F8 FF FF             jz      loc_48DD60
    ];
    const bytes2 = [
        // 夢幻のさくら ~緋艶姫淫辱孕蝕譚~
        // 妖花の園
        0x8b, 0x86, ...XX4,
        0x6a, 0x00,
        0x8b, 0x80, ...XX4,
        0x50,
        0x8b, 0x08,
        0xff, 0x91, ...XX4,
        0x8b, 0x45, XX,
        0x83, 0xF8, 0x08];
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    const addrs2 = L.SearchMemory(bytes2, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    addrs.push(...addrs2);
    let succ = false;
    for (const addr of addrs) {
        const hp = {
            address: addr,
            offset: L.regoffset('ebx'),
            filter_fun: WendyBell_filter,
            type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT,
        };
        succ = L.NewHook(hp, 'WendyBell') || succ;
        if (L.u16(6 + addr) === 0x006a) {
            hp.address = 6 + addr;
            hp.offset = L.regoffset('edx');
            succ = L.NewHook(hp, 'WendyBell') || succ;
        }
    }
    return succ;
}

const savecontext = { cnt: 0, cntx: 0, cnt_valid: 0 }; // static struct in _2()

function TinkerBell2Filter(buffer) {
    const wc = (buffer.data[0] | (buffer.data[1] << 8)) || 0;
    const ok = (() => {
        switch (wc) {
            case 0xfe:
                return false; // 换行
            case 0xff:
                savecontext.cnt += 1;
                return false;
            default:
                if (savecontext.cntx === 0 && savecontext.cnt) {
                    savecontext.cntx = wc * 2;
                    savecontext.cnt -= 1;
                    return false;
                }
                if (savecontext.cntx && savecontext.cnt === 1) {
                    savecontext.cntx -= 1;
                    return false;
                }
                if (savecontext.cntx && savecontext.cnt === 0) {
                    savecontext.cntx -= 1;
                    if (savecontext.cntx % 2) return true;
                    return false;
                }
                return true;
        }
    })();
    if (!ok) {
        buffer.clear();
        savecontext.cnt_valid = 0;
    } else if (savecontext.cnt_valid + 1 === wc) {
        buffer.clear();
        savecontext.cnt_valid = 0;
    } else {
        savecontext.cnt_valid += 1;
    }
}

function _2() {
    const bytes = [
        0x55, 0x8b, 0xec,
        0x53,
        0x8b, 0x5d, 0x08,
        0x56, 0x8b, 0xf1,
        0x57,
        0x8b, 0x4e, 0x10,
        0x8b, 0xc1,
        0xf7, 0xd0,
        0x3b, 0xc3];
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (const addr of addrs) {
        succ = L.NewHook({
            address: addr,
            offset: L.stackoffset(2),
            type: L.CODEC_UTF16 | L.USING_CHAR | L.NO_CONTEXT,
            filter_fun: TinkerBell2Filter,
        }, 'TinkerBell2') || succ;
    }
    // PcHooks::hookOtherPcFunctions(GetStringTypeExW) has no equivalent in libLuna: left out
    return succ;
}

const E = L.engine({
    name: 'TinkerBell',
    check: () => {
        let iswendybell = false;
        for (let i = 0; i < 10; i++) {
            if (L.CheckFile('Arc0' + i + '.dat')) {
                iswendybell = true;
                break;
            }
        }
        return L.processName_lower.includes('c,system') || iswendybell || L.SearchResourceString('TinkerBell');
    },
    files: ['Arc00.dat', 'Arc01.dat', 'Arc02.dat', 'Arc03.dat', 'Arc04.dat', 'Arc05.dat', 'Arc06.dat', 'Arc07.dat', 'Arc08.dat', 'Arc09.dat'],
    certain: false,
    attach() {
        if (InsertTinkerBellHook() || tkbl()) return true;
        const w = InsertWendyBellHook(); // `|` in C++: both run
        const x = _2();
        return w || x;
    },
});

const E2 = L.engine({
    name: 'TinkerBellold',
    check: () => {
        let iswendybell = false;
        for (let i = 'a'.charCodeAt(0); i <= 'z'.charCodeAt(0); i++) {
            if (L.CheckFile('arc' + String.fromCharCode(i) + '.dat')) {
                iswendybell = true;
                break;
            }
        }
        return iswendybell && L.CheckFile('head.dat');
    },
    certain: false,
    attach() {
        return L.NewHook({
            address: L.FindFunction('ExtTextOutA'),
            offset: L.stackoffset(6),
            type: L.USING_STRING | L.USING_SPLIT,
            split: L.stackoffset(5),
        }, 'TinkerBellold');
    },
});

module.exports = [E, E2];
if (!module.parent) { L.run(E); L.run(E2); }
