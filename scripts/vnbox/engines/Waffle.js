// Waffle.js: LunaHook's Waffle engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Waffle.cpp and Waffle.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// TextUnionA (util/textunion.h): union { char *text; char chars[16]; } at 0, size at 0x10, capacity at 0x14;
// view() is size bytes at (capacity < 0x10 ? chars : text)
const textUnionAView = (p) => {
    const size = L.u32(p + 0x10), capacity = L.u32(p + 0x14);
    return { at: capacity < 0x10 ? p : L.u32(p), size };
};
const textUnionAValid = (p) => {
    const { at, size } = textUnionAView(p);
    const capacity = L.u32(p + 0x14);
    return !(size <= 0 || size > capacity) && L.isAddressReadable(at, size) && L.strlen(at) === size; // isAddressWritable
};

// Left out: InsertWaffleDynamicHook (a trigger_fun on GetTextExtentPoint32A that walks the SEH chain), and its
// PcHooks::hookGDIFunctions fallback is kept in attach().

function waffleoldhook() {
    let found = false;
    const start = L.processStartAddress + 0x1000, stop = L.processStopAddress;
    const { bytes: b, base } = L.region(start, stop);
    for (let i = start; i < stop - 4; i++) {
        const o = i - base;
        if (b[o] === 0x68 && b[o + 1] === 0xac && b[o + 2] === 0 && b[o + 3] === 0 && b[o + 4] === 0) { // *(DWORD *)i == 0xac68 && *(BYTE *)(i + 4) == 0
            found = L.NewHook({
                address: i,
                offset: L.stackoffset(2),
                index: 4,
                split: 0x1e8,
                type: L.DATA_INDIRECT | L.USING_SPLIT,
            }, 'WAFFLE') || found;
        }
    }
    return found;
}

function InsertWaffleHook() {
    const bytes = [
        0x50, // 50         push eax
        0x8b, 0xce, // 8BCE mov   ecx,esi
        0xc6, 0x45, 0xfc, XX, // C645 FC 01 move byte ptr ss:[ebp-4],?
        0x89, 0x75, 0xd4, // 8975 D4    move dword ptr ss:[ebp-0x2c],esi
        0xe8, ...XX4, // E8 ??      call ??
        0x8d, 0x45, 0xdc, // 8D45 DC    lea eax,dword ptr ss:[ebp-0x24]
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (addr) {
        return L.NewHook({
            address: addr,
            offset: L.regoffset('eax'),
            type: L.DATA_INDIRECT,
        }, 'WAFFLE2');
    }
    return false;
}

function InsertWaffleHookx() {
    const bytes = [
        0xFF, 0x75, 0x40,
        0x8D, 0x8D, 0xDC, 0x00, 0x00, 0x00,
        0xE8, 0x72, 0x53, 0xF4, 0xFF,
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr += bytes.length;
    return L.NewHook({
        address: addr,
        type: L.NO_CONTEXT | L.DATA_INDIRECT,
        offset: L.regoffset('eax'),
        index: 0,
    }, 'waffle');
}

// ---- ScenarioHook (embed_fun, hookafter, hookAfter1 and the "EmbedWaffle_clear" hook left out) ----
function scenarioHookBefore(s, hp, buffer) {
    const arg = s.stack[0] + 4; // TextUnionA *
    if (!arg || !textUnionAValid(arg)) return;
    const { at, size } = textUnionAView(arg);
    buffer.from(at, size);
}

function scenarioAttach(startAddress, stopAddress) {
    const bytes = [
        0x8b, 0xf1, // 009e5a0c   8bf1             mov esi,ecx
        0x39, 0x6b, 0x14, // 009e5a0e   396b 14          cmp dword ptr ds:[ebx+0x14],ebp
        0x73, 0x05, // 009e5a11   73 05            jnb short play.009e5a18
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    let count = 0;
    const fun = (a) => {
        let isName;
        if (L.u32(a - 8) === 0x248c8d50) isName = false; // ScenarioRole
        else if ((L.u32(a - 11) & 0x00ffffff) === 0x002484c7) isName = true; // NameRole
        else return true;
        if (L.NewHook({
            address: a,
            text_fun: scenarioHookBefore,
            index: 4,
            type: L.DATA_INDIRECT | L.USING_STRING | L.NO_CONTEXT,
        }, isName ? 'EmbedWaffle_name' : 'EmbedWaffle_Scenario')) count++;
        return true;
    };
    L.iterNearCallAddress(fun, addr, startAddress, stopAddress);
    return count;
}

let h1str = ''; // static std::string str
function h1() {
    const bytes = [
        0x8b, 0x5d, 0x08,
        0x42,
        0x8b, 0xc3,
        0x2b, 0xc7,
        0x03, 0xd0,
        0x8b, 0x45, 0x14,
        0x8d, 0x0c, 0x33,
        0x89, 0x55, 0x18,
        0x2b, 0xd1,
        0x52,
        0x0f, 0xbe, 0x30,
        0x56,
        0x89, 0x75, 0x0c,
        0x51];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x200);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING,
        filter_fun(buffer) {
            const cur = buffer.strA();
            if (L.all_ascii(cur)) return buffer.clear();
            if (h1str === cur) return buffer.clear();
            h1str = cur;
        },
    }, 'waffle3');
}

function h2() {
    const bytes = [0x8a, 0x01, 0x41, 0x84, 0xc0, XX, XX, 0x2b, 0xca, 0x8d, 0x45, 0xec, 0x51, 0x50, 0x8b, 0xcf, 0xe8, ...XX4];
    let ok = false;
    for (const addr of L.SearchMemory(bytes, L.PAGE_EXECUTE_READWRITE, L.processStartAddress, L.processStopAddress)) {
        ok = L.NewHook({
            address: addr + bytes.length - 5,
            offset: L.regoffset('eax'),
            type: L.USING_STRING,
        }, 'waffle4') || ok;
    }
    return ok;
}

function hh() {
    let _ = h1();
    _ = h2() || _;
    return _;
}

function waffle3() {
    const bytes = [
        0xC7, ...XX2, 0x01, 0, 0, 0,
        0xe8, ...XX4,
        0xeb, XX,
        0x8d, 0x4d, XX,
        0xe8, ...XX4,
        0x8a, 0x08,
        0x88, 0x4d, XX,
        0xff, 0x75, XX,
        0xe8, ...XX4,
        0x83, 0xc4, 0x04,
        0x84, 0xc0,
        0x75, XX];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + bytes.length - 20,
        type: L.DATA_INDIRECT,
        offset: L.regoffset('eax'),
    }, 'waffle3');
}

function filterline(buffer) {
    let s = buffer.strA();
    s = L.re.sub(s, '[\n\r]+(\x81\x40)*');
    buffer.fromA(s);
}

function fantacyfhd() {
    const bytes = [
        0x33, 0XC9,
        0X6A, 0X04,
        0X5A,
        0XF7, 0XE2,
        0X0F, 0X90, 0XC1,
        0XF7, 0XD9,
        0X0B, 0XC8,
        0X51,
        0XE8, ...XX4,
        0X8B, 0X8B, ...XX4,
        0XC1, 0XE1, 0X02,
        0X51,
        0X6A, 0X00,
        0X50,
        0X89, 0X45, XX,
        0XE8, ...XX4];
    const bytes2 = [
        0X6A, 0X04,
        0X59,
        0XF7, 0XE1,
        0x6a, 0xff,
        0x59,
        0x0f, 0x42, 0xc1,
        0x50,
        0xe8, ...XX4,
        0X8B, 0X8B, ...XX4,
        0XC1, 0XE1, 0X02,
        0X51,
        0X6A, 0X00,
        0X50,
        0X89, 0X45, XX,
        0XE8, ...XX4];
    let range = 0x100;
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        range = 0x180;
    }
    if (!addr) return false;
    const START = [
        0X55,
        0X8D, 0XAC, 0X24, ...XX4];
    addr = L.reverseFindBytes(START, addr - range, addr);
    if (!addr) return false;
    // embed_fun (TextUnionA::setText) left out
    return L.NewHook({
        address: addr,
        text_fun(context, hp, buffer) {
            const { at, size } = textUnionAView(context.stack[1]);
            buffer.from(at, size);
        },
        filter_fun: filterline,
        type: L.USING_STRING,
    }, 'waffle5');
}

function waffle6() {
    const bytes = [
        0XC5, 0XF9, 0XEF, 0XC0,
        0XC5, 0XF9, 0X6E, 0XC9,
        0XC4, 0XE2, 0X71, 0X00, 0XC0,
        0XC4, 0XE3, 0X7D, 0X18, 0XD0, 0X01,
        0X03, 0XD0,
        0X66, 0X90];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const START = [
        0X55, 0x8b, 0xec,
        0x51,
        0x8b, 0x45, 0x08];
    addr = L.reverseFindBytes(START, addr - 0x40, addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        filter_fun: filterline,
        type: L.USING_STRING,
    }, 'waffle6');
}

function silklip() {
    const bytes = [
        0xc7, 0x45, 0xfc, 0x06, 0x00, 0x00, 0x00,
        0xe8, ...XX4, //->std::string::assign
        0x6a, 0xff,
        XX,
        0x8d, XX, ...XX4,
        XX,
        0x8d, 0x4d, XX,
        0xe8, ...XX4, //->std::string::assign
        0x6a, 0xff,
        XX,
        0x8d, XX, ...XX4,
        XX,
        0x8d, 0x4d, XX,
        0xe8, ...XX4, //->std::string::assign
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const hp = {
        offset: L.regoffset('edx'),
        type: L.USING_STRING | L.NO_CONTEXT,
        address: addr + 7 + 5,
        filter_fun: filterline,
    };
    let succ = L.NewHook(hp, 'waffle7');
    hp.address = addr + 7 + 5 + 2 + 1 + 6 + 1 + 3 + 5;
    succ = L.NewHook(hp, 'waffle7') && succ; // `succ &=`
    return succ;
}

const E = L.engine({
    name: 'Waffle',
    check: { FILE: 'cfg.pak' },
    attach() {
        const embed = scenarioAttach(L.processStartAddress, L.processStopAddress);
        const b1 = InsertWaffleHook();
        const b2 = InsertWaffleHookx();
        let b3 = hh();
        b3 = waffle3() || b3; // `b3 |= waffle3()`
        let succ = b1 || b2 || embed || b3 || fantacyfhd() || waffle6() || silklip();
        if (!succ) {
            succ = waffleoldhook();
            L.hookGDIFunctions(); // trigger_fun = InsertWaffleDynamicHook is left out
        }
        return !!succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
