// Silkys.js: LunaHook's Silkys engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Silkys.cpp and Silkys.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// TextUnionA (pack 4): union { char *text; char chars[16]; } at 0, size at 0x10, capacity at 0x14.
const textUnionA = (p) => {
    const size = L.u32(p + 0x10), capacity = L.u32(p + 0x14);
    const at = capacity < 0x10 ? p : L.u32(p);
    return {
        at, size,
        isValid() {
            return size > 0 && size <= capacity && L.isAddressReadable(at, size) && L.strlen(at) === size;
        },
    };
};

function SpecialHookSilkys(context, hp, buffer, split) {
    const arg1 = context.stack[1],
        arg2 = context.stack[2];

    let size = L.i32(arg1 + 0x14);
    if (size <= 0) return;

    const ShortTextCapacity = 0x10;
    let text = 0;
    if (size >= ShortTextCapacity) {
        text = L.u32(arg1 + 4);
        if (text && L.IsBadReadPtr(text, size)) text = 0; // this might not be needed though
    }
    if (!text) { // short text
        text = arg1 + 4;
        size = Math.min(size, ShortTextCapacity);
    }
    buffer.from(text, size);
    split.value = arg2 === 0 ? 1 : 2; // arg2 == 0 ? scenario : name
}

// hookBefore: the text part of the embed hook (hookafter1/hookAfter, the translation write-back and its
// second hook at addr + 5, are left out)
function hookBefore(s, hp, buffer) {
    const arg = textUnionA(s.stack[0] + 4); // arg1
    if (!arg.isValid()) return;
    // role: stack[1] != 0 is the name (no roles in VNBox)
    buffer.from(arg.at, arg.size);
}

function InsertSilkysHook() {
    const bytes = [
        0x66, 0x89, 0x45, 0xf9, // 00a1a062   66:8945 f9       mov word ptr ss:[ebp-0x7],ax
        0x39, 0x47, 0x14, // 00a1a066   3947 14          cmp dword ptr ds:[edi+0x14],eax
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;

    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;

    let succ = L.NewHook({ address: addr, text_fun: SpecialHookSilkys, type: L.USING_STRING | L.NO_CONTEXT }, 'SilkysPlus'); // = 9
    const fun = (a) => {
        return L.NewHook({ address: a, type: L.USING_STRING | L.NO_CONTEXT, text_fun: hookBefore }, 'EmbedSilkys'); // replace all functions
    };
    succ = L.iterNearCallAddress(fun, addr, L.processStartAddress, L.processStopAddress) || succ;
    return succ;
}

function InsertSilkysHook2() {
    let addr = L.findCallerAddressAfterInt3(L.FindFunction('GetCharacterPlacementW'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig = [
        0x8b, 0x80, ...XX4,
        0xff, 0xd0,
        0x8b, 0xf0];
    addr = L.findBytes(sig, addr, addr + 0x100);
    if (!addr) return false;
    let idx = 0;
    return L.NewHook({
        address: addr + 8,
        type: L.CODEC_UTF16 | L.USING_STRING,
        offset: L.regoffset('eax'),
        filter_fun(buffer) {
            if (idx % 2) buffer.clear();
            idx += 1;
        },
    }, 'SilkysPlus2');
}

function _s() {
    const sig = [
        0xBA, 0x00, 0x01, 0x00, 0x00,
        0xC7, 0x45, 0x08, 0x14, 0x20, 0x00, 0x00,
        0x8D, 0x49, 0x00];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return 0;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        lineSeparator: '\\n',
        type: L.USING_STRING | L.CODEC_UTF16,
    }, 'EmbedSilkysX');
}

function InsertSilkys2Hook() {
    const bytes = [
        0xC7, 0x45, XX, 0x00, 0x01, 0x00, 0x00,
        0xC7, 0x45, XX, 0x14, 0x20, 0x00, 0x00];
    const bytes2 = [
        0x8b, 0x4d, 0xf4,
        0x8b, 0x3c, 0x8f,
        0x03, 0x38];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.reverseFindBytes(bytes2, addr - 0x100, addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr + bytes2.length,
        offset: L.regoffset('edi'),
        filter_fun(buffer) {
            L.StringCharReplacerW(buffer, '\\i', '\'');
        },
        type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT,
    }, 'Silkys2');
}

function saiminset() {
    const addr1 = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (addr1 === 0) return false;
    const func1 = L.findEnclosingAlignedFunction(addr1);
    if (func1 === 0) return false;
    const check = [
        0x80, 0xf9, 0x81, ...XX2, // cmp     cl, 81h
        0x80, 0xf9, 0x9f, ...XX2, // cmp     cl, 9Fh
    ];
    if (L.findBytes(check, func1, addr1) === 0) return false;
    const xrefs = L.findxref_reverse_checkcallop(func1, L.processStartAddress, L.processStopAddress, 0xe8);
    if (xrefs.length === 0) return false;
    const addr2 = xrefs[0];
    const addr = L.findEnclosingAlignedFunction(addr2);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        index: 0,
        split: L.stackoffset(6),
        type: L.USING_SPLIT | L.DATA_INDIRECT,
    }, 'Silkys3');
}

function silkys4() {
    const check = [
        0x80, 0xFA, 0x81,
        0x72, XX,
        0x80, 0xFA, 0x9F,
        0x76, XX];
    const addr = L.findCallerAddress(L.FindFunction('GetGlyphOutlineA'), 0xec8b55, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    if (L.findBytes(check, addr, addr + 0x100) === 0) return false;
    let idx = 0;
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR | L.DATA_INDIRECT | L.USING_SPLIT,
        split: L.stackoffset(1),
        offset: L.stackoffset(1), // thiscall arg1
        filter_fun(buffer) {
            if ((idx++) % 2) buffer.clear();
        },
    }, 'Silkys4');
}

function silkys5() {
    const sig = [
        0xff, 0xd0, // call eax
        0x8b, 0x0f,
        0x8b, 0xf0, // mov esi,eax
        0x68, 0x80, 0, 0, 0,
        0x68, 0x80, 0, 0, 0,
        0x6a, 0,
        0x8b, 0x11,
        0x6a, 0];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    let idx = 0;
    return L.NewHook({
        address: addr + 2,
        type: L.USING_CHAR | L.DATA_INDIRECT | L.CODEC_UTF16,
        offset: L.regoffset('eax'),
        filter_fun(buffer) {
            if ((idx++) % 2) buffer.clear();
        },
    }, 'silkys5');
}

const E = L.engine({
    name: 'Silkys',
    check: { FILE_ALL: ['data.arc', 'effect.arc', 'Script.arc'] },
    attach() {
        const b1 = InsertSilkys2Hook();
        return InsertSilkysHook() || InsertSilkysHook2() || _s() || b1 || saiminset() || silkys4() || silkys5();
    },
});

// Almost the same as Silkys except mes.arc is replaced by Script.arc
const E2 = L.engine({
    name: 'SilkysOld',
    check: { FILE_ALL: ['bgm.AWF', 'effect.AWF', 'gcc.ARC', 'mes.ARC', 'sequence.ARC'] },
    attach() {
        const addr = L.findCallerAddressAfterInt3(L.FindFunction('TextOutA'), L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.DATA_INDIRECT }, 'SilkysOld');
    },
});

// 女系家族
// https://vndb.org/v5650
const E3 = L.engine({
    name: 'Siglusold',
    check: { FILE_ALL: ['*.mfg', '*.mff', '*.mfm', '*.mfs'] },
    attach() {
        const bytes = [
            0x66,
            XX,
            0x40,
            0x87,
            ...XX2,
            0x66,
            XX,
            0x9f,
            0x87,
        ];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction_strict(addr);
        if (!addr) return false;
        let succ = L.NewHook({ address: addr, type: L.USING_CHAR | L.DATA_INDIRECT, offset: L.stackoffset(1) }, 'Siglusold_slow'); // 文本速度是慢速时这个有用，调成快速以后有无法过滤的重复
        const addrs = L.findxref_reverse_checkcallop(addr, addr - 0x1000, addr + 0x1000, 0xe8);
        for (let a of addrs) {
            a = L.findEnclosingAlignedFunction_strict(a);
            if (!a) continue;
            succ = L.NewHook({
                address: a,
                codepage: 932,
                text_fun(context, hp, buffer) {
                    const a2 = context.stack[2];
                    const len1 = context.stack[3]; // 慢速时是1
                    const len2 = (L.u32(a2 + 7 * 4) - L.u32(a2 + 6 * 4)) >>> 0;
                    if (len1 === 0 || len2 === 0) return;
                    if (len1 === 1) { // 慢速
                        hp.type = L.USING_CHAR;
                        let data = (L.u32(a2 + 5 * 4) + L.u32(a2 + 6 * 4)) >>> 0;
                        data = L.u16(data);
                        const check = data & 0xff; // 换行符
                        if (L.IsShiftjisLeadByte(check)) buffer.from_t(data, 2);
                        else buffer.from_t(data & 0xff, 1);
                    } else { // 快速&&慢速下立即显示
                        buffer.from(L.u32(a2 + 5 * 4), len1);
                    }
                },
                type: L.USING_STRING,
            }, 'Siglusold_fast') || succ;
        }
        return succ;
    },
});

const E4 = L.engine({
    name: 'Silkyssakura',
    // いれかわ　お姉ちゃん、ぼくの身体でオナニーしちゃうの!
    check: { FILE: 'pak\\data001.pak' },
    attach() {
        let addr = L.findCallerAddressAfterInt3(L.FindFunction('GetGlyphOutlineW'), L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        const hp = {
            address: addr,
            offset: L.stackoffset(3),
            split: L.stackoffset(5),
            type: L.DATA_INDIRECT | L.USING_CHAR | L.USING_SPLIT | L.CODEC_UTF16,
        };
        let xrefs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
        if (xrefs.length === 1) {
            addr = L.findEnclosingAlignedFunction(xrefs[0]);
            if (addr) {
                xrefs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
                if (xrefs.length === 1) {
                    addr = L.findEnclosingAlignedFunction(xrefs[0]);
                    if (addr) {
                        // embed_hook_font left out; 这个是分两层分别绘制文字和阴影，需要两个都内嵌。
                        return L.NewHook({
                            address: addr,
                            offset: L.stackoffset(2),
                            type: L.USING_STRING | L.CODEC_UTF16,
                        }, 'embedSilkyssakura');
                    }
                }
            }
        }
        return L.NewHook(hp, 'Silkyssakura');
    },
});

function fob2() {
    const bytes = [
        0x53,
        0x56,
        0x8b, 0xf1,
        0x8b, 0xde,
        0x8d, 0x4b, 0x01,
        0x8d, 0xa4, 0x24, 0x00, 0x00, 0x00, 0x00,
        0x8a, 0x03,
        0x43,
        0x84, 0xc0,
        0x75, XX,
        0x2b, 0xd9,
        0xb8, 0xa8, 0x00, 0x00, 0x00,
        0x3b, 0xd8,
        0x68, 0xac, 0x00, 0x00, 0x00];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('ecx'),
        lineSeparator: '\\n',
        type: L.USING_STRING,
    }, 'SilkysX');
}

function Silkysveryveryold_attach_function() {
    const bytes = [
        0x8b, XX, XX,
        0x03, XX, XX,
        0x33, XX,
        0x8a, 0x02,
        0x83, XX, 0x5c,
        0x0f, 0x85, ...XX4,
        0x8b, XX, XX,
        0x03, XX, XX,
        0x33, XX,
        0x8a, XX, 0x01,
        0x83, XX, 0x6e];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        lineSeparator: '\\n',
        type: L.USING_STRING,
    }, 'SilkysX');
}

function bird() {
    const bytes = [
        0x8b, 0x45, 0xf4,
        0x33, 0xc9,
        0x8a, 0x88, ...XX4,
        0x81, 0xf9, 0x81, 0x00, 0x00, 0x00,
        0x0f, 0x85, ...XX4,
        0x8b, 0x55, 0xf4,
        0x33, 0xc0,
        0x8a, 0x82, ...XX4,
        0x83, 0xf8, 0x75,
        0x74, 0x14,
        0x8b, 0x4d, 0xf4,
        0x33, 0xd2,
        0x8a, 0x91, ...XX4,
        0x83, 0xfa, 0x77,
        0x0f, 0x85, ...XX4,
        0x8b, 0x45, 0xf4,
        0x50];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    // embed_hook_font left out
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        offset: L.stackoffset(1),
        lineSeparator: '\\n',
    }, 'SilkysX');
}

function old2() {
    const sig1 = [
        0x66, 0x81, 0x3c, 0x55, 0x04, 0x21, 0x45, 0x00, 0x73, 0x74];
    let addr = L.findBytes(sig1, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig2 = [
        0x33, XX, // xor     eax, eax||  xor     edx, edx
        0x66, 0x8b, XX, XX, ...XX4, // mov     ax, word ptr dword_452104+2[ecx*2]||mov     dx, word ptr dword_452104+2[eax*2]
        0x03, XX, // add     eax, edx||  add     edx, esi
        0x8d, XX, XX, ...XX4, // lea     edx, ds:452100h[eax*2]||lea     ecx, ds:452100h[edx*2]
        XX, // push    edx||push    ecx
        0xe8, ...XX4];
    addr = L.findBytes(sig2, addr, addr + 0x100);
    if (!addr) return false;
    let target = addr + sig2.length - 5;
    target = (target + 5 + L.i32(target + 1)) >>> 0;
    // embed_fun (puts a leading newline back: isnewlinefirst) left out
    return L.NewHook({
        address: target,
        type: L.USING_STRING,
        offset: L.stackoffset(1),
        lineSeparator: '\\n',
        filter_fun(buffer) {
            L.StringReplacerA(buffer, '\x84\xa5\x84\xa7', '\x81\x5b\x81\x5b');
            L.StringCharReplacerA(buffer, '\\n', '\n');
            let result = '';
            let hasFirstNewline = false;
            for (const c of buffer.viewA()) {
                if (c === '\n') {
                    if (!hasFirstNewline) {
                        result += c;
                        hasFirstNewline = true;
                    }
                } else {
                    result += c;
                }
            }
            if (result[0] === '\n') result = result.substr(1);
            buffer.fromA(result);
        },
    }, 'SilkysX');
}

// flutter of birds II 天使たちの翼
// https://vndb.org/v2380
const E5 = L.engine({
    name: 'Silkysveryveryold',
    check: { FILE: '*SYS*.ifl' },
    attach() { return Silkysveryveryold_attach_function() || fob2() || bird() || old2(); },
});

// 肢体を洗う
const E6 = L.engine({
    name: 'Aisystem6',
    check: () => {
        if (!L.CheckFileAll(['script.arc', 'sequence.arc', 'mask.arc', 'bitmap.arc', 'flag0000'])) return false;
        return L.findBytes(L.aToBytes('AISYSTEM_6\0'), L.processStartAddress, Math.min(L.processStopAddress, L.processStartAddress + 0x100000)) !== 0;
    },
    attach() {
        const bytes = [
            0x66, 0x8B, 0x01, 0xF7, // mov     ax, [ecx]
            0xDD, 0x1B,
            0xED, 0x83, 0xC5, 0x02,
            0xD1, 0xEB,
            0x0F, 0xAF, 0xDD,
            0x66, 0x3D, 0x81, 0x93, // cmp     ax, 9381h
        ];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        const addrs = L.findxref_reverse_checkcallop(addr, addr - 0x1000, addr + 0x1000, 0xe8);
        if (addrs.length !== 1) return false;
        addr = L.findEnclosingAlignedFunction(addrs[0]);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.stackoffset(1),
            type: L.USING_STRING | L.NO_CONTEXT, // 男主自定义人名会被分开
            filter_fun(buffer) {
                L.StringCharReplacerA(buffer, '\x81\x93', '\n');
            },
        }, 'Aisystem6');
    },
});

module.exports = [E, E2, E3, E4, E5, E6];
if (!module.parent) { for (const e of [E, E2, E3, E4, E5, E6]) L.run(e); }
