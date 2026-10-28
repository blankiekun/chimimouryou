// Lightvn.js: LunaHook's Lightvn engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Lightvn.cpp and Lightvn.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: spDefault.boundaryModule, and the memory patch of IsDebuggerPresent (`mov ax, 0xc340` written over
// its first bytes so the game keeps printing its script lines to OutputDebugString): VNBox does not write memory,
// so the game must print them on its own.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// https://vndb.org/r?f=fwLight_evn-
const PATTERN1 = String.raw`\[PARSETOKENS\] line:[-"'\.]+(.*?)\(scenario:(.*?)`;
const PATTERN2 = String.raw`\[PARSETOKENS\] line:(.*?)backlogName = '(.*?)'(.*?)`;
const PATTERN3 = String.raw`\[Parser::ReadScriptBreak\] curline:[-"'\.]+(.*?)'(.*?)`;

function SpecialHookLightvnA(context, hp, buffer, split) {
    //[Parser::ReadScriptBreak] curline:'"「次は[水縹]<みはなだ>駅、水縹駅――お出口は左側です」'

    //[PARSETOKENS] line:.始発でここまで来ているのは俺くらいなものだろう。
    //(scenario:T) (script:00.txt, lineNo:30)
    //[PARSETOKENS] line:"電車には俺のほかに数人乗っている程度。\c
    //(scenario:F) (script:00.txt, lineNo:29)
    let s = L.readA(context.stack[1]);
    let match;
    if ((match = L.re.match(s, PATTERN1))) {
        s = match[1];
        split.value = 1;
    } else if ((match = L.re.match(s, PATTERN2))) {
        s = match[2];
        split.value = 2;
    } else if ((match = L.re.match(s, PATTERN3))) {
        s = match[1];
        split.value = 3;
    }
    s = L.re.sub(s, String.raw`\[(.*?)\]<(.*?)>`, '$1');
    s = L.strReplace(s, '\\c');
    s = L.strReplace(s, '\\w');
    buffer.fromA(s);
}

function SpecialHookLightvnW(context, hp, buffer, split) {
    let s = L.readW(context.stack[1]);
    s = L.strReplace(s, '\n');
    s = L.strReplace(s, '\r');
    let match;
    if ((match = L.re.match(s, PATTERN1))) {
        s = match[1];
        split.value = 1;
    } else if ((match = L.re.match(s, PATTERN2))) {
        s = match[2];
        split.value = 2;
    } else if ((match = L.re.match(s, PATTERN3))) {
        s = match[1];
        split.value = 3;
    }
    s = L.re.sub(s, String.raw`\[(.*?)\]<(.*?)>`, '$1');
    s = L.strReplace(s, '\\c');
    s = L.strReplace(s, '\\w');
    buffer.fromW(s);
}

function InsertLightvnHook() {
    let succ = L.NewHook({
        address: L.FindFunction('OutputDebugStringA'),
        type: L.CODEC_UTF8 | L.USING_STRING,
        offset: L.stackoffset(1),
        text_fun: SpecialHookLightvnA,
    }, 'OutputDebugStringA');
    succ = L.NewHook({
        address: L.FindFunction('OutputDebugStringW'),
        type: L.CODEC_UTF16 | L.USING_STRING,
        offset: L.stackoffset(1),
        text_fun: SpecialHookLightvnW,
    }, 'OutputDebugStringW') || succ;
    return succ;
}

let last_1 = ''; // static std::wstring last
function _1() {
    const [minAddress, maxAddress] = L.QueryModuleLimits(L.GetModuleHandle('Engine.dll'));
    const BYTES = [
        0x55, 0x8b, 0xec,
        0x83, 0xec, XX,
        0x8b, XX, 0x10,
        0x89, XX, XX,
        0x8b, XX, 0x0c,
        0x89, XX, XX,
        0x8b, XX, 0x08,
        0x89, XX, XX,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0x83, 0x7d, XX, 0x00,
        0x74, XX,
        0x8b, 0x45, XX,
        0x66, 0x8b, 0x08,
        0x66, 0x89, 0x4d, XX,
        0x8b, XX, XX,
        0x66, XX, XX,
        0x66, XX, XX, XX,
        0x66, XX, XX, XX,
        0x66, XX, XX, XX];
    let addr = L.findBytes(BYTES, minAddress, maxAddress);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, minAddress, maxAddress, 0xe8);
    if (addrs.length !== 3) return false;
    addr = addrs[0];
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        filter_fun(buffer) {
            let s = buffer.strW();
            if (s.startsWith('"-')) return buffer.clear();
            if (!(s.startsWith('"') || s.startsWith('.') || s.startsWith('-".'))) return buffer.clear();

            if (s.startsWith('"') || s.startsWith('.')) s = s.substr(1);
            else if (s.startsWith('-".')) s = s.substr(3);
            if (s === 'イン' || s === '拡大' || s === 'アウト' || s === 'インアウト' || s.startsWith('イン ') || s.startsWith('拡大 ') || s.startsWith('インアウト ') || s.startsWith('アウト ')) return buffer.clear();

            if (s === last_1) return buffer.clear();
            last_1 = s;
            buffer.fromW(s);
        },
        offset: L.stackoffset(1),
        type: L.CODEC_UTF16 | L.USING_STRING,
    }, 'Light.VN');
}

function veryold() {
    // https://vndb.org/v25877
    //  私のアリス
    // sub_10093E10 (_CancellationTokenRegistration::operator=, assigns a std::wstring)
    const [minAddress, maxAddress] = L.QueryModuleLimits(L.GetModuleHandle('Engine.dll'));
    const BYTES = [
        0x55, 0x8b, 0xec,
        0x83, 0xec, 0x08,
        0x89, 0x4d, 0xf8,
        0x8b, 0x45, 0xf8,
        0x3b, 0x45, 0x08,
        0x74, XX,
        0x8d, 0x4d, 0xff,
        0x51,
        0x8b, 0x4d, 0x08,
        0xe8, ...XX4,
        0x50,
        0x8d, 0x55, 0xfe,
        0x52,
        0x8b, 0x4d, 0xf8,
        0xe8, ...XX4,
        0x50,
        0xe8, ...XX4,
        0x83, 0xc4, 0x08,
        0x0f, 0xb6, 0xc0,
        0x85, 0xc0,
        0x74, XX,
        0x33, 0xc9,
        0x74, XX,
        0x6a, 0x00,
        0x6a, 0x01];
    const addr = L.findBytes(BYTES, minAddress, maxAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun(context, hp, buffer, split) {
            if (context.stack[1] !== context.argof_thiscall()) {
                // TextUnionW { union { wchar_t *text; wchar_t chars[8]; }; size_t size, capacity; }
                const t = context.stack[1];
                const size = L.u32(t + 0x10), capacity = L.u32(t + 0x14);
                buffer.from(capacity < 8 ? t : L.u32(t), size * 2);
            }
        },
        type: L.USING_STRING | L.CODEC_UTF16,
    }, 'Light.VN');
}

const E = L.engine({
    name: 'Lightvn',
    check: () => L.GetModuleHandleW('Engine.dll') && L.GetModuleHandleW('BugTrapU.dll'),
    attach() {
        return InsertLightvnHook() | (_1() || veryold());
    },
});

module.exports = E;
if (!module.parent) L.run(E);
