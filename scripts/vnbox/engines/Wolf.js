// Wolf.js: LunaHook's Wolf engine (WOLF RPG Editor) for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Wolf.cpp and Wolf.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: embed_fun/hook-after parts (translation embedding, and the dataSet_ they fill), and the
// GuruGuruSMF4 hook made by trigger_fun in attach_function (trigger_fun is not supported by VNBox).
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// isStringUtf8 (include/stringutils.cpp): every character is well-formed UTF-8 (stops at a NUL)
function isStringUtf8(str) {
    const follow = (i) => (str.charCodeAt(i) & 0xC0) === 0x80; // 10xxxxxx; past the end it reads the string's NUL
    const charlen = (i) => {
        const c = str.charCodeAt(i);
        if (!(c >= 0)) return 0;
        if (c === 0) return 0;
        if ((c & 0x80) === 0) return 1;
        if ((c & 0xE0) === 0xC0) return follow(i + 1) ? 2 : 0;
        if ((c & 0xF0) === 0xE0) return follow(i + 1) && follow(i + 2) ? 3 : 0;
        if ((c & 0xF8) === 0xF0) return follow(i + 1) && follow(i + 2) && follow(i + 3) ? 4 : 0;
        return 0;
    };
    let len = 0;
    while (len < str.length) {
        const l = charlen(len);
        if (!l) break;
        len += l;
    }
    return len === str.length;
}

// WolfRPG
function InsertOldWolfHook() {
    const sub_esp = 0xec81; // jichi: caller pattern: sub esp = 0x81,0xec
    const c1 = L.FindCallAndEntryAbs(L.FindFunction('GetTextMetricsA'), L.processStopAddress - L.processStartAddress, L.processStartAddress, sub_esp);
    if (c1) {
        const c2 = L.FindCallOrJmpRel(c1, L.processStopAddress - L.processStartAddress, L.processStartAddress, 0);
        if (c2) {
            // jichi 10/12/2013: 83 EC XX   sub esp, XX
            const { bytes: b, base } = L.region(c2 - 0x400, c2 - 0x100 + 2);
            for (let i = c2 - 0x100, j = c2 - 0x400; i > j; i--) {
                if ((b[i - base] | (b[i - base + 1] << 8)) === 0xec83) {
                    return L.NewHook({
                        address: i,
                        offset: L.regoffset('ecx'),
                        split: L.regoffset('esp'),
                        type: L.DATA_INDIRECT | L.USING_SPLIT,
                    }, 'WolfRPG');
                }
            }
        }
    }
    return false;
}

function InsertWolf3Hook() {
    const bytes = [0xC7, 0x45, 0xFC, 0x00, 0x00, 0x00, 0x00, 0x8B, 0x45, 0x94, 0x83, 0xE0, 0x01];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) {
        return false;
    }
    return L.NewHook({
        address: addr + 41,
        type: L.USING_STRING | L.NO_CONTEXT | L.DATA_INDIRECT,
        offset: L.regoffset('eax'),
        index: 4,
    }, 'WolfRPG_String_Copy');
}

function InsertWolf4Hook() {
    const bytes = [0xC6, 0x45, 0xFC, 0x29, 0x8B, 0x8D, 0xE0, 0xEF, 0xFF, 0xFF, 0xE8, ...XX4, 0x50, 0x8B, 0x4D, 0xE8, 0x2B, 0x4D, 0xEC];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) {
        return false;
    }
    return L.NewHook({
        address: addr + 16,
        type: L.USING_STRING | L.NO_CONTEXT,
        offset: L.regoffset('eax'),
    }, 'WolfRPG4');
}

function InsertWolfHook() {
    // return InsertOldWolfHook(), InsertWolf3Hook(), InsertWolf4Hook(): all three run, the last one counts
    InsertOldWolfHook();
    InsertWolf3Hook();
    return InsertWolf4Hook();
}

function commonfilter(buffer) {
    const str = buffer.strA();
    if (!isStringUtf8(str)) return buffer.clear();
    const check1 = str.includes('/') || str.includes('\\');
    const hashsuffix = () => {
        const filterpath = [
            '.png', '.jpg', '.bmp',
            '.mp3', '.ogg',
            '.webm', '.mp4', '.sys', '.dat', '.sav',
            '.otf', '.mps'];
        for (const _ of filterpath) {
            if (str.includes(_)) return true;
        }
        return false;
    };
    const check2 = hashsuffix();
    const check3 = L.all_ascii(str);
    if (check1 && (check2 || check3)) return buffer.clear();
}

function hook5_1(addr_1) {
    const bytes = [
        0x6a, 0x01,
        0x68, ...XX4,
        0x68, ...XX4,
        0x6a, 0x01,
        0x6a, 0x00,
        0xFF, 0x77, 0x10,
        0xFF, 0x77, 0x18,
        0xE8];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const off = L.u32(bytes.length + addr);
    const _calladdr = (addr + bytes.length + 4 + off) >>> 0;
    if (addr_1 !== _calladdr) return false;
    return L.NewHook({
        address: addr + bytes.length - 1,
        offset: L.stackoffset(7),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun: commonfilter,
    }, 'Wolf5_1');
}

function hook5() {
    const bytes = [
        0x80, 0x38, 0x40,
        0x0f, 0x85, ...XX4,
        0x57,
        0x68, ...XX4,
        0x8d, ...[XX, XX],
        0xe8];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    if (hook5_1(addr)) return true;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(8),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun: commonfilter,
    }, 'Wolf5');
}

function hook6() {
    const bytes = [
        0xB8, 0x00, 0x00, 0x00, 0x80,
        0x83, 0xC0, 0x23];
    let ok = false;
    for (let addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        ok = L.NewHook({
            address: addr,
            offset: L.stackoffset(3),
            type: L.USING_STRING | L.CODEC_UTF8,
            filter_fun: commonfilter,
        }, 'Wolf6') || ok;
    }
    return ok;
}

function wolf_hook56() {
    const _1 = hook5();
    const _2 = hook6();
    return _1 || _2;
}

// ScenarioHook (attach other text): ecx points at a list element
// struct TextListElement { DWORD flag1; LPSTR text; DWORD flag2, flag3, flag4; int size, capacity; }
// flag1 (at 0) should be zero when text is valid; size at 0x14, capacity at 0x18 (capacity of the data including \0)
function ScenarioHookAttach(startAddress, stopAddress) {
    const addr = L.findCallerAddressAfterInt3(L.FindFunction('CharNextA'), startAddress, stopAddress);
    if (!addr) return 0;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('ecx'),
        index: 4,
        text_fun(s, hp, buffer) {
            const self = s.ecx; // ecx is actually a list of element
            const text0 = L.u32(self + 4), size = L.i32(self + 0x14), capacity = L.i32(self + 0x18);
            const isValid = size > 0 && size <= capacity && L.isAddressReadable(text0, capacity) && size === L.strlen(text0);
            if (isValid) {
                let text = text0;
                while (L.u8(text) && L.u8(text) <= 39) text++; // ltrim
                if (L.u8(text)) {
                    buffer.fromCharPtr(text); // the dataSet_ check only filters text the embed part has written
                }
            }
        },
        type: L.USING_STRING | L.DATA_INDIRECT | L.NO_CONTEXT,
    }, 'EmbedWolf');
}

function wolf7() {
    const sig = [
        0x52,
        0x8b, 0x4d, 0xf4,
        0xe8, ...XX4,
        0x03, 0x45, 0x08,
        0x03, 0x45, 0x0c,
        0x50,
        0x8b, 0x4d, 0xf4,
        0xe8, ...XX4,
        0x03, 0x45, 0x08,
        0x03, 0x45, 0x14,
        0x50,
        0xe8, ...XX4,
        0x83, 0xc4, 0x0c,
        0x8b, 0x45, 0x14];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr += 31;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT }, 'Wolf7');
}

const GuruGuruSMF4 = {
    h1() {
        const bytes = [
            0x50,
            0x8d, 0x4d, 0x24,
            0xe8, ...XX4,
            0x80, 0x38, 0x40,
            0x0f, 0x85, ...XX4,
            0x6a, 0x00,
            0x68, ...XX4,
            0x8d, 0x4d, 0x24,
            0xe8, ...XX4,
            0x8b, 0xf8,
            0x83, 0xff, 0xff,
            0x75, XX,
            0x6a, 0x00,
            0x68, ...XX4,
            0x8d, 0x4d, 0x24,
            0xe8, ...XX4,
            0xe9, ...XX4,
            0x8d, 0x47, 0xff,
            0x83, 0xf8, 0x09,
            0x7e, XX,
            0x83, 0xec, 0x18];
        const bytes2 = [
            0x57,
            0x8d, 0x4d, 0x24,
            0xe8, ...XX4,
            0x80, 0x38, 0x40,
            0x0f, 0x85, ...XX4,
            0x57,
            0x68, ...XX4,
            0x8d, 0x4d, 0x24,
            0xe8, ...XX4,
            0x89, 0x85, ...XX4,
            0x83, 0xf8, 0xff,
            0x75, XX,
            0x68, ...XX4,
            0x8d, 0x4d, 0x24,
            0xe8, ...XX4,
            0xe9, ...XX4,
            0x48,
            0x83, 0xf8, 0x09,
            0x7e, XX,
            0x83, 0xec, 0x18];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = Math.max(L.findfuncstart(addr), L.findEnclosingAlignedFunction(addr));
        if (!addr) return false;
        return L.NewHook({
            address: addr, // 0x53F7B0 + processStartAddress
            type: L.CODEC_UTF8 | L.USING_STRING,
            offset: L.stackoffset(8),
            filter_fun(buffer, hp) {
                commonfilter(buffer, hp);
                let s = buffer.strA();
                if (L.startWith(s, '@1')) {
                    s = s.substr(2);
                }
                s = L.re.sub(s, String.raw`\\\w\[\\\w+\[\d+\]\]`);
                s = L.re.sub(s, String.raw`\\\w+\[\d+\]`);
                s = L.re.sub(s, String.raw`\\-\[\d+\]`);
                s = L.re.sub(s, String.raw`/\w*\[\d+\]`);
                s = L.re.sub(s, String.raw`\\E`);
                s = L.re.sub(s, String.raw`\\r\[(.*?),(.*?)\]`, '$1');
                s = L.re.sub(s, String.raw`\[\d+\]`);
                buffer.fromA(s);
            },
        }, 'GuruGuruSMF4_2');
    },
};

let wolf8Last = ''; // static std::string last
function wolf8() {
    const sig = [
        0X8B, 0X54, 0x24, 0x0c,
        0x8b, 0xc2,
        0x56,
        0x57,
        0x8b, 0xf1,
        0x8d, 0x78, 0x01,
        0x0f, 0x1f, 0x00,
        0x8a, 0x08,
        0x40,
        0x84, 0xc9,
        0x75, 0xf9,
        0x2b, 0xc7,
        0x8b, 0xce,
        0x50,
        0x52,
        0xff, 0x74, 0x24, 0x18,
        0xff, 0x74, 0x24, 0x18,
        0xe8, ...XX4,
        0x5f,
        0x5e,
        0xc2, 0x0c, 0x00];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.CODEC_UTF8 | L.USING_STRING,
        offset: L.stackoffset(3),
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`\d`);
            s = L.strReplace(s, 'G');
            s = L.strReplace(s, '@');
            s = L.strReplace(s, '"');
            s = L.strReplace(s, ' ');
            s = L.strReplace(s, '<');
            s = L.strReplace(s, '-');
            s = L.strReplace(s, '\n');
            s = L.strReplace(s, L.utf8A('　'));
            s = L.re.sub(s, String.raw`[\x01-\x20]`);
            s = L.re.sub(s, String.raw`,.*?\]`);
            if (!s.length) return buffer.clear();
            if (s === wolf8Last) {
                return buffer.clear();
            }
            if (L.endWith(wolf8Last, s)) {
                wolf8Last = s;
                return buffer.clear();
            }
            if (L.startWith(s, wolf8Last)) {
                s = s.substr(wolf8Last.length);
            }
            wolf8Last = s;
            buffer.fromA(s);
        },
    }, 'wolf8');
}

function w9() {
    const sig = [
        0X81, 0XFB, 0XFF, 0XFF, 0XFF, 0X7F,
        0X0F, 0X87, 0XA3, 0X00, 0X00, 0X00,
        0X8B, 0XFB,
        0X83, 0XCF, 0X0F,
        0X81, 0XFF, 0XFF, 0XFF, 0XFF, 0X7F,
        0X76, 0X12,
        0XB8, 0X00, 0X00, 0X00, 0X80,
        0XBF, 0XFF, 0XFF, 0XFF, 0X7F,
        0X50,
        0XE8, ...XX4,
        0XEB, XX,
        0X8B, 0XCD,
        0XB8, 0XFF, 0XFF, 0XFF, 0X7F,
        0XD1, 0XE9];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig2 = [0x53, 0x8b, 0x5c, 0x24, 0x0c,
        0x55, 0x56, 0x8b, 0xf1];
    addr = L.reverseFindBytes(sig2, addr - 0x50, addr, 0, true);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.CODEC_UTF8 | L.USING_STRING,
        offset: L.stackoffset(1),
        filter_fun(buffer) {
            if (L.all_ascii(buffer.strA())) buffer.clear();
        },
    }, 'wolf9');
}

function wolf10() {
    const sig = [
        0x81, 0xfe, 0x00, 0x04, 0x00, 0x00,
        0x7e, XX,
        0x68, 0xaf, 0x06, 0x00, 0x00,
        0x8d, 0x04, 0xf5, 0x00, 0x00, 0x00, 0x00,
        0x68, ...XX4,
        0x50,
        0xc7, XX, XX, XX, 0x01, 0x00, 0x00, 0x00,
        0xe8, ...XX4];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x80);
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.CODEC_UTF16,
        text_fun(s, hp, buffer) {
            if (s.stack[6] !== 2) return;
            buffer.fromWCharPtr(s.ecx);
        },
    }, 'wolf10');
}

const E = L.engine({
    name: 'Wolf',
    certain: false,
    check: () => L.CheckFileAny(['data.wolf', 'data\\*.wolf', 'data\\basicdata\\cdatabase.dat'])
        || L.GetModuleHandle('GuruGuruSMF4.dll') || L.SearchResourceString('Game / WOLF RPG Editor'),
    files: ['data.wolf', 'data\\*.wolf', 'data\\basicdata\\cdatabase.dat'], // any of these alone passes the check
    attach() {
        let succ = false;
        const _ = ScenarioHookAttach(L.processStartAddress, L.processStopAddress);
        succ = (InsertWolfHook() || wolf_hook56() || _ || wolf7()) || succ;
        succ = GuruGuruSMF4.h1() || succ;
        succ = succ || w9() || wolf8();
        succ = wolf10() || succ;
        L.hookGDIFunctions();
        // trigger_fun (the GuruGuruSMF4 hook found from the first GetGlyphOutlineW call) left out
        return !!succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
