// Circus.js: LunaHook's Circus engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Circus.cpp and Circus.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// CIRCUS hook: the game folder contains an advdata folder. Fonts are cached, and the GetGlyphOutline
// trace-back gives a hook with repetition; a characteristic instruction (cmp al,0x24) finds the
// function that fills the text buffer instead.

// lru_cache<std::string> cache(n): touch(s) is true when s is cached (and refreshes it), else it inserts s
function lruCache(max) {
    const items = [];
    return {
        touch(s) {
            const i = items.indexOf(s);
            if (i >= 0) {
                items.splice(i, 1);
                items.push(s);
                return true;
            }
            items.push(s);
            if (items.length > max) items.shift();
            return false;
        },
    };
}

// reads over the exe image for the hand-written scans
function imageReader() {
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    return {
        u8: (a) => (a >= base && a - base < b.length ? b[a - base] : 0),
        u16: (a) => (a >= base && a - base + 2 <= b.length ? dv.getUint16(a - base, true) : 0),
        u32: (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0),
    };
}

let lastMiyako = ''; // static std::string last
function miyako(k) {
    const fs = L.findxref_reverse_checkcallop(k, L.processStartAddress, L.processStopAddress, 0xe8);
    if (fs.length !== 2)
        return false;
    let f = fs[0];
    f = L.findEnclosingAlignedFunction(f);
    if (!f)
        return false;
    const check = [
        0x80, 0x3c, 0x3b, 0x81,
        0x75, XX,
        0x80, 0x7c, 0x3b, 0x01, 0x6d,
        0x75, XX];
    if (!L.findBytes(check, f, f + 0x100))
        return false;
    return L.NewHook({
        address: f,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.FULL_STRING,
        filter_fun(buffer) {
            let s = buffer.strA();
            if (s === lastMiyako)
                return buffer.clear();
            lastMiyako = s;
            s = L.re.sub(s, String.raw`\x81\x6f(.*?)\x81\x5e(.*?)\x81\x70`, '$2'); // ｛みす／御簾｝
            s = L.re.sub(s, '\n(\x81\x40)*');
            buffer.fromA(s);
        },
    }, 'Circus3');
}

function InsertCircusHook1() { // jichi 10/2/2013: Change return type to bool
    const m = imageReader();
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress - 4; i++)
        if ((m.u16(i) === 0xa3c) && (m.u8(3 + i) !== 0)) // cmp al, 0xA; je  //A3 3C 0A 9B 00   mov     dword_9B0A3C, eax
            for (let j = i; j < i + 0x100; j++) {
                const c = m.u8(j);
                if (c === 0xc3)
                    break;
                if (c === 0xe8) {
                    const k = (m.u32(j + 1) + j + 5) >>> 0;
                    if (k > L.processStartAddress && k < L.processStopAddress) {
                        const hp = {
                            address: k,
                            offset: L.stackoffset(3),
                            split: L.regoffset('esp'), // 这个的split有点糟糕，还是不要split了。
                            type: L.DATA_INDIRECT,
                            filter_fun(buffer) {
                                L.StringFilterA(buffer, '\x81\x40');
                            },
                        };
                        return miyako(k) || L.NewHook(hp, 'Circus1');
                    }
                }
            }
    return false;
}

function commonfilter(buffer) {
    let s = buffer.strA();
    s = L.re.sub(s, String.raw`\x81\x6f(.*?)\x81\x5e(.*?)\x81\x70`, '$2'); // ｛みす／御簾｝
    s = L.re.sub(s, '\n(\x81\x40)*');
    buffer.fromA(s);
}

function circus12() {
    const sig = [
        0x3C, 0x24,
        0x0F, 0x85, ...XX4,
        0x8A, 0x47, 0x01,
        0x47,
        0x3C, 0x6E,
        0x75, XX,
        0xA0, ...XX4,
        0xB9, ...XX4,
        0x84, 0xC0,
        0x0F, 0x84, ...XX4,
        0x88, 0x06,
        0x8A, 0x41, 0x01,
        0x46,
        0x41,
        0x84, 0xC0,
        0x75, XX,
        0xE9, ...XX4,
        0x3C, 0x66,
        0x75, XX];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x40);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'Circus1_2');
}

function dcold_name() {
    const sig = [
        0x57,
        0x6a, 0x01,
        0x68, 0x58, 0x02, 0x00, 0x00,
        0x68, 0x20, 0x03, 0x00, 0x00,
        0x6a, 0x00,
        0x6a, 0x00,
        0xe8, ...XX4,
        0x8b, 0x7c, 0x24, 0x1c,
        0x83, 0xc4, 0x14,
        0x80, 0x3f, 0x00,
        0x74, XX,
        0x8b, 0xc7,
        0x8d, 0x50, 0x01,
        0x8a, 0x08,
        0x40,
        0x84, 0xc9,
        0x75, XX,
        0x2b, 0xc2,
        0x6b, 0xc0, 0x1a];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'dcold_name');
}

const setakushiCache = lruCache(3); // static lru_cache<std::string> cache(3)
function dcold_setakushi() {
    const sig = [
        0X56,
        0X8B, 0X74, 0X24, 0X08,
        0X8B, 0X46, 0X04,
        0X8B, 0X56, 0X1C,
        0X8B, 0X0E,
        0X57,
        0X03, 0XD0,
        0X52,
        0X8B, 0X56, 0X18,
        0X03, 0XD1,
        0X52, 0X50, 0X51,
        0XE8, ...XX4,
        0X8B, 0X7C, 0X24, 0X20,
        0X83, 0XC4, 0X10,
        0X80, 0X3F, 0X40,
        0X75, XX,
        0X80, 0X7F, 0X01, 0X73,
        0X75, XX,
        0XF6, 0X46, 0X08, 0X80,
        0X74, XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING | L.FULL_STRING | L.NO_CONTEXT,
        filter_fun(buffer) {
            const s = buffer.strA();
            if (setakushiCache.touch(s))
                buffer.clear();
        },
    }, 'dcold_setakushi');
}

function dcold_TEXT() {
    // if ( byte_8FA790[0] == 64 && byte_8FA791 == 75 ) dword_8FAB90 = 2; dword_8DBC38 = strlen(byte_8FA790);
    const sig = [
        0x80, 0x3d, ...XX4, 0x40,
        0x89, 0x35, ...XX4,
        0x75, 0x13,
        0x80, 0x3d, ...XX4, 0x4b,
        0x75, 0x0a,
        0xc7, 0x05, ...XX4, 0x02, 0x00, 0x00, 0x00,
        0xb8, ...XX4,
        0x8d, 0x50, 0x01,
        0xeb, XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    const byte_8FA790 = L.u32(addr + 2); // static char *
    const byte_8FA791 = L.u32(addr + 7 + 6 + 2 + 2);
    if (byte_8FA790 + 1 !== byte_8FA791)
        return false;
    // embed_fun (strcpy into byte_8FA790) is left out
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        text_fun(context, hp, buffer) {
            buffer.fromCharPtr(byte_8FA790);
        },
        filter_fun: commonfilter,
    }, 'dcold_TEXT');
}

function dcold() {
    let succ = dcold_name() && dcold_TEXT();
    if (succ)
        succ = dcold_setakushi() || succ;
    return succ;
}

function Circus1_attach_function() {
    return InsertCircusHook1() | (circus12() || dcold());
}

function Circus_old_attach_function() {
    const call = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!call)
        return false;
    let func = L.findEnclosingAlignedFunction(call);
    if (!func)
        return false;
    const sig = [
        // cmp edi, 8140h / jz / cmp edi, 20h / jz: if ( v14 == 33088 ) ... if ( v14 == 32 )
        0x81, 0xFF, 0x40, 0x81, 0x00, 0x00,
        0x0F, 0x84, ...XX4,
        0x83, 0xFF, 0x20,
        0x0F, 0x84, ...XX4];
    if (!L.findBytes(sig, func, call))
        return false;
    const refs = L.findxref_reverse_checkcallop(func, L.processStartAddress, L.processStopAddress, 0xe8);
    if (refs.length === 3) {
        func = L.findEnclosingAlignedFunction(refs[0]);
    }
    return L.NewHook({
        address: func,
        offset: L.stackoffset(4),
        split: L.stackoffset(1),
        type: L.USING_STRING | L.USING_SPLIT,
    }, 'Circus');
}

function filter(buffer) {
    L.StringFilterA(buffer, '@s');
    const data = buffer.strA();
    if (data.includes('@i') || data.includes('@y'))
        return buffer.clear();
    commonfilter(buffer);
}

function InsertCircusHook2() { // jichi 10/2/2013: Change return type to bool
    const m = imageReader();
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress - 4; i++)
        if ((m.u32(i) & 0xffffff) === 0x75243c) { // cmp al, 24; je
            const j = L.findEnclosingAlignedFunction(i, 0x80);
            if (j) {
                return L.NewHook({ address: j, offset: L.stackoffset(2), type: L.USING_STRING }, 'Circus');
            }
            break;
        }
    return false;
}

function c2() {
    const entry = L.FindImportEntry(L.processStartAddress, L.FindFunction('GetGlyphOutlineA'));
    if (!entry)
        return false;
    const addrs = L.SearchMemory(L.le32(entry), L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    if (!addrs.length)
        return false;
    const addr = addrs[addrs.length - 1];
    const _ = 0xCCCCCCCC;
    const SIG = [0x8B, 0xB4, 0x24, ...XX2, 0x00, 0x00, 0x80, 0x3E, 0x00];
    const funcaddr = L.reverseFindBytes(L.le32(_), addr - 0x1000, addr, 4, true);
    const funcaddr2 = L.reverseFindBytes(SIG, addr - 0x1000, addr);
    if (funcaddr) {
        L.NewHook({ address: funcaddr, offset: L.stackoffset(2), type: L.USING_STRING, filter_fun: filter }, 'Circus2_3');
    }
    if (funcaddr2) {
        L.NewHook({
            address: funcaddr2 + 7,
            offset: L.regoffset('esi'),
            type: L.USING_STRING | L.NO_CONTEXT,
            filter_fun: filter,
        }, 'Circus2_2');
    }
    return !!(funcaddr || funcaddr2);
}

function c3() {
    // sub_435C00 / sub_43FA40 (D.C. With You, DreamDays): SetStr, strlen(Str) > 0x104 shows a MessageBoxA.
    const check1 = () => {
        const overflow = L.aToBytes('\x53\x65\x74\x53\x74\x72\x95\xB6\x8E\x9A\x90\x94\x83\x49\x81\x5b\x83\x6f\x81\x5b\0'); // SetStr文字数オーバー
        const overflow2 = 'SetStr overflow';
        let addr = L.findBytes(overflow, L.processStartAddress, L.processStopAddress);
        if (!addr)
            addr = L.findBytes(L.aToBytes(overflow2), L.processStartAddress, L.processStopAddress);
        if (!addr)
            return 0;
        addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
        if (!addr)
            return 0;
        return addr;
    };
    let addr = check1();
    if (!addr) {
        const bytes = [
            // if ( strlen(Str) > 0x104 ) return MessageBoxA(0,。。。)
            0x8a, 0x08,
            0x40,
            0x84, 0xc9,
            0x75, 0xf9,
            0x2b, 0xc2,
            0x3d, 0x04, 0x01, 0x00, 0x00,
            0x76, XX,
            0x68, 0x00, 0x20, 0x04, 0x00,
            0x68, ...XX4,
            0x68, ...XX4,
            0x6a, 0x00,
            0xff, 0x15, ...XX4];
        addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    }
    if (!addr)
        return false;
    const _check1 = [
        0x81, 0XEC, 0X08, 0X01, 0X00, 0X00];
    const nearstartcheck = L.reverseFindBytes(_check1, addr - 0x40, addr, 0, true);
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    if (nearstartcheck && nearstartcheck > addr)
        addr = nearstartcheck;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING, filter_fun: filter }, 'Circus2_1');
}

// ScenarioHook (EmbedCircus): only the text is read; hookafter (embedding) and the scenario/name role
// guess from return addresses (iterNearCallAddress) are left out.
function ltrim(s) { // skip a leading '@' command: returns the start index
    let t = 0;
    if (s && s.charCodeAt(0) === 0x40) // '@'
        while (++t < s.length && s.charCodeAt(t) > 0 && s.charCodeAt(t) < 0x80);
    return t;
}

function ScenarioHookFindFunctionAddress(startAddress, stopAddress) { // find the function to hook
    const m = imageReader();
    for (let i = startAddress + 0x1000; i < stopAddress - 4; i++)
        if ((m.u32(i) & 0xffffff) === 0x75243c) { // cmp al, 24; je
            const range = 0x80; // the range is small, since it is a small function
            const addr = L.findEnclosingAlignedFunction(i, range);
            if (addr)
                return addr;
        }
    return 0;
}

function ScenarioHookAttach(startAddress, stopAddress) {
    const addr = ScenarioHookFindFunctionAddress(startAddress, stopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        filter_fun: filter,
        text_fun(s, hp, buffer) {
            const text = s.stack[2]; // arg2
            const str = L.readA(text);
            const trimmed = str.substr(ltrim(str));
            if (!trimmed)
                return;
            buffer.fromA(trimmed);
        },
        type: L.USING_STRING | L.NO_CONTEXT,
    }, 'EmbedCircus');
}

function c4() {
    const bytes = [
        // char __cdecl sub_428180(char *a1, const char *a2): expands $n, $f, $t ... in the script string
        0x8b, 0x7c, 0x24, XX,
        0x8a, 0x07,
        0x84, 0xc0,
        0x0f, 0x84, ...XX4,
        0x53,
        0x55,
        0x3c, 0x24,
        0x0f, 0x85, ...XX4,
        0x8a, 0x47, 0x01,
        0x47,
        0x3c, 0x6e,
        0x75, XX,
        0xa0, ...XX4,
        0xb9, ...XX4,
        0x84, 0xc0,
        0x0f, 0x84, ...XX4,
        0x41,
        0x88, 0x06,
        0x8a, 0x01,
        0x46,
        0x84, 0xc0];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x20);
    if (!addr)
        return false;
    const last = lruCache(2); // static lru_cache<std::string> last(2)
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING | L.NO_CONTEXT, // 将历史过滤掉后，可以nocontext
        filter_fun(buffer) {
            const s = buffer.strA();
            if (last.touch(s))
                return buffer.clear();
            commonfilter(buffer);
        },
    }, 'Circus2_4');
}

function nightshade() {
    const bytes = [
        0x8b, 0x44, 0x24, 0x04,
        0x56,
        0x8b, 0x74, 0x24, 0x0c,
        0x8a, 0x0e,
        0x57,
        0x33, 0xff,
        0x84, 0xc9,
        0x0f, 0x84, ...XX4,
        0x80, 0xf9, 0x40,
        0x75, XX,
        0x80, 0x7e, 0x01, 0x69,
        0x75, XX,
        0x80, 0x7e, 0x02, 0x24,
        0x75, XX,
        0x80, 0x7e, 0x03, 0x6e,
        0x75, XX,
        0x83, 0xc6, 0x02,
        0xbf, 0x01, 0x00, 0x00, 0x00];

    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING | L.FULL_STRING | L.NO_CONTEXT,
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`(\x81\x40)*\n(\x81\x40)*`);
            s = L.strReplace(s, '$n', '\x9e\xc5');
            buffer.fromA(s);
        },
    }, 'nightshade');
}

function Circus2_attach_function() {
    const ch2 = InsertCircusHook2();
    const _1 = ch2 || c3() || c4() || nightshade() || c2();
    const embed = ScenarioHookAttach(L.processStartAddress, L.processStopAddress);
    return _1 || embed;
}

let c1 = false, old = false, c2flag = false; // set by the check, as the C++ members
const E = L.engine({
    name: 'Circus',
    check: () => {
        c1 = L.CheckFile('AdvData\\DAT\\NAMES.DAT');
        //[041213][CIRCUS]最終試験くじら
        old = L.CheckFileAll(['Pack/Bg.pak', 'Pack/Bustup.pak', 'Pack/Cg.pak',
            'Pack/Movie*.pak', 'Pack/Script.pak', 'Pack/Sound.pak',
            'Pack/System.pak', 'Pack/Thumbnail.pak']) &&
            L.SearchResourceString('Circus');
        c2flag = L.CheckFileAny(['AdvData\\GRP\\NAMES.DAT', 'AdvData\\GRP\\Circus2.CRX']);
        return c1 || old || c2flag;
    },
    files: ['AdvData\\DAT\\NAMES.DAT', 'AdvData\\GRP\\NAMES.DAT', 'AdvData\\GRP\\Circus2.CRX'],
    attach() {
        let succ = false;
        succ = (c1 && !!Circus1_attach_function()) || succ;
        succ = (c2flag && Circus2_attach_function()) || succ;
        succ = (old && Circus_old_attach_function()) || succ;
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
