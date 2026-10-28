// RPGMakerRGSS3.js: LunaHook's RPGMakerRGSS3 engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RPGMakerRGSS3.cpp and RPGMakerRGSS3.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// getDllModuleName(): the loaded System/RGSS3*.dll (found among the loaded modules, not by globbing the folder)
function getDllModule() {
    const m = Process.enumerateModules().find((x) => /^RGSS3.*\.dll$/i.test(x.name));
    return m ? L.GetModuleHandle(m.name) : 0;
}

function getMemoryRange() {
    const hmod = getDllModule();
    if (!hmod) return null;
    return L.QueryModuleLimits(hmod);
}

// ---- ScenarioHook ----
// struct HookArgument { LPDWORD type; LPDWORD unknown; size_t size; LPCSTR text; } (0x0, 0x4, 0x8, 0xc)
function scenarioArgValid(arg) {
    if (!L.isAddressReadable(arg, 0x10)) return false;
    const type = L.u32(arg), size = L.u32(arg + 8), text = L.u32(arg + 0xc);
    return L.isAddressReadable(type) && L.u32(type) && size && size < 1500 &&
        L.isAddressReadable(text, size + 1) && L.u8(text) && L.u8(text + size) === 0 &&
        L.strlen(text) === size && !L.all_ascii(L.readA(text, size));
}

const _trims = (ch) => ch.charCodeAt(0) <= 127 || /\s/.test(ch);

function trim(text) {
    if (!text.length || (!_trims(text[0]) && !_trims(text[text.length - 1]))) return text;
    let ret = text;
    if (_trims(ret[0])) {
        let pos = 1;
        while (pos < ret.length && _trims(ret[pos])) pos++;
        ret = ret.substr(pos);
    }
    if (ret.length && _trims(ret[ret.length - 1])) {
        let pos = ret.length - 2;
        while (pos >= 0 && _trims(ret[pos])) pos--;
        ret = ret.substr(0, pos + 1);
    }
    return ret;
}

// texts_ is only filled by the skipped embed_fun, so it stays empty; recentTexts_ is never read.
function scenarioHookBefore(context, hp, buffer) {
    const arg = context.stack[0]; // arg1
    if (arg && scenarioArgValid(arg)) {
        const oldText = L.StringToWideString(L.readA(L.u32(arg + 0xc), L.u32(arg + 8)), L.CP_UTF8);
        const trimmedText = trim(oldText);
        if (trimmedText.length) buffer.fromW(trimmedText);
    }
}

function scenarioAttach(startAddress, stopAddress) {
    const bytes = [
        0x8b, 0x54, 0x24, 0x24, // 1004155c   8b5424 24        mov edx,dword ptr ss:[esp+0x24]
        0x8b, 0x02, // 10041560   8b02             mov eax,dword ptr ds:[edx]
        0x8b, 0xc8, // 10041562   8bc8             mov ecx,eax
        0x83, 0xc4, 0x0c, // 10041564   83c4 0c          add esp,0xc
        0x81, 0xe1, 0x00, 0x20, 0x00, 0x00, // 10041567   81e1 00200000    and ecx,0x2000
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    addr = L.findNearCallAddress(addr, startAddress, stopAddress);
    if (!addr) return false;
    // embed_fun, embed_hook_font and the second hook at addr + 5 (hookAfter, it only undoes the embed) left out
    return L.NewHook({
        address: addr,
        text_fun: scenarioHookBefore,
        type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT,
    }, 'EmbedRGSS3');
}

// ---- ChoiceHook ----
let choiceFunctionAddress = 0; // the function address being hooked

// struct HookArgument { LPDWORD unknown1, unknown2, unknown3; LPSTR text; } (text at +0xc)
function choiceHookBefore(context, hp, buffer) {
    const arg = context.stack[2]; // arg2
    const text = L.u32(arg + 0xc);
    if (text && L.isAddressReadable(text) && L.u8(text)) {
        buffer.fromW(L.StringToWideString(L.readA(text), L.CP_UTF8));
    }
}

function choiceAttach(startAddress, stopAddress) {
    const bytes = [
        0x89, 0x45, 0xfc, // 100075b5   8945 fc          mov dword ptr ss:[ebp-0x4],eax
        0x8b, 0x4d, 0xfc, // 100075b8   8b4d fc          mov ecx,dword ptr ss:[ebp-0x4]
        0x8b, 0x51, 0x10, // 100075bb   8b51 10          mov edx,dword ptr ds:[ecx+0x10]
        0x89, 0x55, 0xe8, // 100075be   8955 e8          mov dword ptr ss:[ebp-0x18],edx
        0x8b, 0x45, 0xe8, // 100075c1   8b45 e8          mov eax,dword ptr ss:[ebp-0x18]
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (addr) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (addr) {
            choiceFunctionAddress = addr;
            return L.NewHook({
                address: addr,
                text_fun: choiceHookBefore,
                type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT,
            }, 'EmbedRGSS3Choice');
        }
    }
    return false;
}

// ---- OtherHook ----
function otherHookBefore(context, hp, buffer) {
    const retaddr = context.stack[0];
    if (retaddr > choiceFunctionAddress && retaddr - choiceFunctionAddress < 0xff) return; // skip translate already-hooked function
    const text = context.stack[1]; // arg1
    if (text && L.u16(text)) {
        const oldText = L.readW(text);
        if (oldText.length > 1) buffer.fromW(oldText);
    }
}

function otherAttach(startAddress, stopAddress) {
    const addr = L.findCallerAddressAfterInt3(L.FindFunction('GetGlyphOutlineW'), startAddress, stopAddress);
    if (!addr) return 0;
    return L.NewHook({
        address: addr,
        text_fun: otherHookBefore,
        type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT,
    }, 'EmbedRGSS3Other');
}

const E = L.engine({
    name: 'RPGMakerRGSS3',
    check: { FILE_ALL: ['*.rgss3a', 'System/RGSS3*.dll'] },
    certain: false,
    attach() {
        const range = getMemoryRange();
        if (!range) return false;
        const [startAddress, stopAddress] = range;
        if (!scenarioAttach(startAddress, stopAddress)) return false;
        choiceAttach(startAddress, stopAddress);
        otherAttach(startAddress, stopAddress);
        return true;
    },
});

const E2 = L.engine({
    name: 'RPGMakerRGSS300',
    check: { FILE_ANY: ['System/RGSS300.dll', 'System/RGSS301.dll'] },
    certain: false,
    attach() {
        L.hookGDIFunctions();
        // trigger_fun (hook the caller of GetGlyphOutlineW's function as 'RGSS30x.dll') is not supported: left out
        return !!(L.GetModuleHandle('RGSS300.dll') || L.GetModuleHandle('RGSS301.dll'));
    },
});

module.exports = [E, E2];
if (!module.parent) { L.run(E); L.run(E2); }
