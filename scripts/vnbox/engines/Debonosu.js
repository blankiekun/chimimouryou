// Debonosu.js: LunaHook's Debonosu engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Debonosu.cpp and Debonosu.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertDebonosuScenarioHook() {
    let addr = L.FindImportEntry(L.processStartAddress, L.FindFunction('lstrcatA'));
    if (!addr) return false;
    const search = (0x15ff | (addr << 16)) >>> 0; // jichi 10/20/2014: call dword ptr ds
    addr >>>= 16;
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    const ib = (a) => (a >= base && a - base < b.length ? b[a - base] : 0);
    const iw = (a) => (a >= base && a - base + 2 <= b.length ? dv.getUint16(a - base, true) : 0);
    const id = (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
    for (let i = L.processStartAddress; i < L.processStopAddress - 4; i++) {
        if (id(i) === search &&
            iw(i + 4) === addr && // call dword ptr lstrcatA
            ib(i - 5) === 0x68) { // push $
            const push = id(i - 4);
            for (let j = i + 6, k = j + 0x10; j < k; j++) {
                if (ib(j) === 0xb8 && id(j + 1) === push) {
                    const hook_addr = L.findEnclosingAlignedFunction(i, 0x200);
                    if (hook_addr) {
                        // embed_fun, embed_hook_font and embed flags left out (translation embedding)
                        return L.NewHook({
                            address: hook_addr,
                            text_fun: SpecialHookDebonosuScenario,
                            type: L.USING_STRING | L.NO_CONTEXT | L.USING_SPLIT | L.FIXING_SPLIT, // there is only one thread
                            filter_fun(buffer) {
                                buffer.fromA(L.re.sub(buffer.strA(), String.raw`\{(.*?)/(.*?)\}`, '$1'));
                            },
                        }, 'Debonosu');
                    }
                }
            }
        }
    }
    return false;
}

function SpecialHookDebonosuScenario(context, hp, buffer, split) {
    const retn = context.retaddr;
    if (L.u16(retn) === 0xc483) { // add esp, $  old Debonosu game
        hp.offset = L.stackoffset(1);
    } else { // new Debonosu game
        hp.offset = L.regoffset('eax');
    }
    hp.text_fun = null;
    split.value = L.FIXED_SPLIT_VALUE;
    // *(DWORD *)(context->base + hp->offset): the argument or the register just chosen
    buffer.fromCharPtr(hp.offset === L.stackoffset(1) ? context.stack[1] : context.eax);
}

function InsertDebonosuNameHook() {
    const bytes = [
        // 0032f659   32c0             xor al,al
        // 0032f65b   5b               pop ebx
        // 0032f65c   8be5             mov esp,ebp
        // 0032f65e   5d               pop ebp
        // 0032f65f   c3               retn
        0x55, // 0032f660   55               push ebp    ; jichi: name text in ecx, which could be zero though
        0x8b, 0xec, // 0032f661   8bec             mov ebp,esp
        0x81, 0xec, ...XX4, // 0032f663   81ec 2c080000    sub esp,0x82c
        0x8b, 0x45, 0x08, // 0032f669   8b45 08          mov eax,dword ptr ss:[ebp+0x8]
        0x53, // 0032f66c   53               push ebx
        0x56, // 0032f66d   56               push esi
        0x8b, 0xf1, // 0032f66e   8bf1             mov esi,ecx
        0x85, 0xc0, // 0032f670   85c0             test eax,eax
        0x8d, 0x4d, 0xf0, // 0032f672   8d4d f0          lea ecx,dword ptr ss:[ebp-0x10]
        0x0f, 0x45, 0xc8, // 0032f675   0f45c8           cmovne ecx,eax
        0x57, // 0032f678   57               push edi
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('ecx'),
        type: L.USING_STRING | L.NO_CONTEXT | L.USING_SPLIT, // there is only one thread
    }, 'DebonosuName');
}

// LunaHook's `attach(startAddress, stopAddress)`: nothing calls it, ported as it is
function attach(startAddress, stopAddress) {
    let addr = 0;
    {
        const msg = 'D3DFont::Draw';
        addr = L.findBytes(L.aToBytes(msg.slice(0, msg.length - 1)), startAddress, stopAddress); // ::strlen(msg + 1)
        if (addr) addr = L.findPushAddress(addr, startAddress, stopAddress);
    }
    if (!addr) {
        const bytes = [
            0x50, // 0010fb80   50               push eax
            0xff, 0x75, 0x14, // 0010fb81   ff75 14          push dword ptr ss:[ebp+0x14]
            0x8b, 0xce, // 0010fb84   8bce             mov ecx,esi
            0xff, 0x75, 0x10, // 0010fb86   ff75 10          push dword ptr ss:[ebp+0x10]
        ];
        addr = L.findBytes(bytes, startAddress, stopAddress);
    }
    if (!addr) return false;
    // This might not work as the address is not always aligned: findEnclosingAlignedFunction
    addr = L.findEnclosingFunctionAfterInt3(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: 20, type: L.USING_STRING | L.NO_CONTEXT }, 'Debonosu2');
}

function debox() {
    //[240726][1282636][でぼの巣製作所] 神楽漫遊記～桂香と初花～ DL版 (files)
    const lua51 = L.GetModuleHandle('lua5.1.dll');
    if (!lua51) return false;
    const lua_tolstring = L.GetProcAddress(lua51, 'lua_tolstring');
    if (!lua_tolstring) return false;
    const addrs = L.findiatcallormov_all(lua_tolstring, L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE);
    let succ = false;
    for (const addr of addrs) {
        succ = L.NewHook({
            address: addr + 6,
            type: L.USING_STRING | L.NO_CONTEXT,
            offset: L.regoffset('eax'),
            filter_fun(buffer, hp) {
                const str = buffer.strA();
                if (L.all_ascii(str)) return buffer.clear();
                const result1 = L.re.sub(str, String.raw`\{(.*?)/(.*?)\}`, '$1');
                buffer.fromA(result1);
                L.Utf8TypeChecker(buffer, hp);
            },
        }, 'debonosu') || succ;
    }
    return succ;
}

function InsertDebonosuHook() {
    const ok = InsertDebonosuScenarioHook();
    if (ok) InsertDebonosuNameHook();
    return ok;
}

const E = L.engine({
    name: 'Debonosu',
    check: () => (L.CheckFileAny(['bmp.pak', 'EN\\bmp.pak', 'ZHCN\\bmp.pak', 'ZHTW\\bmp.pak']) &&
        L.CheckFile('dsetup.dll')) ||
        L.SearchResourceString('でぼの巣製作所'),
    attach() {
        // 1/1/2016 jich: skip izumo4 from studio ego that is not supported by debonosu
        if (L.CheckFile('*izumo4*.exe')) {
            // LunaHook runs PcHooks::hookOtherPcFunctions() here, which libLuna has no equivalent of
            return false;
        }
        return InsertDebonosuHook() || debox();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
