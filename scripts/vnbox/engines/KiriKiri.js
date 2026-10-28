// KiriKiri.js: LunaHook's KiriKiri engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/KiriKiri.cpp and KiriKiri.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the embed_fun/hook-after parts (we only read text); #if 0 code (KAGParser hooks).
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// kirikiri::tTJSVariantString (pack 4): RefCount, LongString, ShortString[21 + 1], Length
const ttstrText = (ttstr) => {
    const p = L.live.u32(ttstr);
    const long = L.live.u32(p + 4);
    const TJS_VS_SHORT_LEN = 21;
    return { at: long ? long : p + 8, length: L.live.i32(p + 8 + (TJS_VS_SHORT_LEN + 1) * 2) };
};

function FindKiriKiriHook(fun, size, pt, flag) {
    const kirikiri1_sig = 0xec8b55, kirikiri2_sig = 0x575653;
    const StartAddress = 0x1000, StartRange = 0x6000, StopRange = 0x8000;
    const sig = flag ? kirikiri2_sig : kirikiri1_sig;
    const { bytes: b } = L.region(pt, pt + size);
    const d = new DataView(b.buffer, b.byteOffset, b.length);
    const dw = (i) => (i >= 0 && i + 4 <= b.length ? d.getUint32(i, true) : 0);
    let t = 0;
    for (let i = StartAddress; i < size - 4; i++) {
        if ((dw(i) & 0xffff) !== 0x15ff) continue; // call dword ptr ds
        const addr = dw(i + 2);
        if (addr >= pt && addr <= pt + size - 4 && dw(addr - pt) === (fun >>> 0)) t++;
        if (t !== flag + 1) continue; // the call to GetGlyphOutlineW or GetTextExtentPoint32W
        for (let j = i; j > i - StartAddress; j--) {
            if ((dw(j) & 0xffffff) !== sig) continue;
            if (flag) { // KiriKiri2: find the second call to this function
                t = 0;
                for (let k = j + StartRange; k < j + StopRange; k++) {
                    if (b[k] !== 0xe8) continue;
                    if (((k + 5 + dw(k + 1)) >>> 0) === j) t++;
                    if (t === 2) {
                        if (!L.NewHook({
                            address: pt + k + 0x14, offset: L.regoffset('ebx'), index: -0x2, split: L.regoffset('ecx'),
                            type: L.CODEC_UTF16 | L.NO_CONTEXT | L.USING_SPLIT | L.DATA_INDIRECT,
                        }, 'KiriKiri2')) return false;
                        const addr = pt + k + 0x14 - 5;
                        if (L.MatchPattern(addr, [0x66, 0x85, 0xC0, 0x75])) { // mov ax,[ebx]; test ax,ax; jnz
                            L.NewHook({
                                address: addr, type: L.CODEC_UTF16 | L.NO_CONTEXT | L.USING_CHAR,
                                text_fun(context, hp, buffer, split) {
                                    split.value = context.ecx;
                                    if (split.value !== 0x16) return;
                                    buffer.from_t(L.live.u16(context.ebx - 2), 2);
                                },
                            }, 'KiriKiri2X');
                        }
                        return true;
                    }
                }
            } else {
                if (!L.NewHook({
                    address: pt + j, offset: L.regoffset('eax'), index: 0x14, split: L.regoffset('eax'),
                    type: L.CODEC_UTF16 | L.DATA_INDIRECT | L.USING_SPLIT | L.SPLIT_INDIRECT,
                }, 'KiriKiri1')) return false;
                let xrefs = L.findxref_reverse_checkcallop(pt + j, L.processStartAddress, L.processStopAddress, 0xe8);
                if (xrefs.length === 4) {
                    for (let addr of xrefs) {
                        addr = L.findfuncstart(addr, 0x300); // DrawTextMultiple or 2, DrawTextSingle
                        if (!addr) continue;
                        xrefs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
                        if (xrefs.length !== 1) continue;
                        addr = L.findfuncstart(xrefs[0], 0x300); // DrawText
                        if (!addr) continue;
                        L.NewHook({
                            address: addr, type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT,
                            text_fun(context, hp, buffer, split) {
                                const text = ttstrText(context.stack[9]);
                                split.value = context.ecx; // y
                                buffer.from(text.at, text.length * 2);
                            },
                        }, 'tTVPNativeBaseBitmap::DrawText');
                        return true;
                    }
                }
                return true;
            }
            return false;
        }
    }
    return false;
}
function InsertKiriKiriHook() {
    const size = L.processStopAddress - L.processStartAddress;
    const k1 = FindKiriKiriHook(L.FindFunction('GetGlyphOutlineW'), size, L.processStartAddress, 0); // KiriKiri1
    const k2 = FindKiriKiriHook(L.FindFunction('GetTextExtentPoint32W'), size, L.processStartAddress, 1); // KiriKiri2
    return k1 || k2;
}

function NewKiriKiriZHook(addr) {
    return L.NewHook({
        address: addr, offset: L.regoffset('ecx'), split: L.regoffset('ecx'), index: 0x14,
        type: L.CODEC_UTF16 | L.DATA_INDIRECT | L.USING_SPLIT | L.SPLIT_INDIRECT,
    }, 'KiriKiriZ');
}
function InsertKiriKiriZHook1() {
    const addr = L.findCallerAddressAfterInt3(L.FindFunction('GetGlyphOutlineW'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun(context, hp) {
            hp.text_fun = null;
            hp.type = L.HOOK_EMPTY;
            const a = L.findEnclosingAlignedFunction(context.stack[0], 0x400); // retaddr
            if (a) NewKiriKiriZHook(a);
        },
    }, 'KiriKiriZ Hook');
}
function InsertKiriKiriZHook2() {
    const bytes = [
        0x38, 0x4b, 0x21, // cmp byte ptr ds:[ebx+0x21],cl
        0x0f, 0x95, 0xc1, // setne cl
        0x33, 0xc0, // xor eax,eax
        0x38, 0x43, 0x20, // cmp byte ptr ds:[ebx+0x20],al
        0x0f, 0x95, 0xc0, // setne al
        0x33, 0xc8, // xor ecx,eax
        0x33, 0x4b, 0x10, // xor ecx,dword ptr ds:[ebx+0x10]
        0x0f, 0xb7, 0x43, 0x14]; // movzx eax,word ptr ds:[ebx+0x14]
    const MAX_REL_ADDR = 0x00300000;
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x100);
    const push_ebp = 0x55;
    if (!addr || L.u8(addr) !== push_ebp) return false;
    NewKiriKiriZHook(addr);
    return true;
}

let lastTextrender = null;
function KrkrtextrenderFilter(buffer) {
    let ws = buffer.strW();
    if (ws === lastTextrender) return buffer.clear();
    lastTextrender = ws;
    ws = L.re.sub(ws, '%p.*?;%f.*?;');
    ws = L.re.sub(ws, String.raw`\[.*?\]`);
    ws = L.re.sub(ws, String.raw`\$_censorship\("(.*?)","(.*?)"\);`, '$2');
    buffer.fromW(ws);
}
function findtextrender(minAddress, maxAddress) {
    const bytes = [
        0x8b, XX, XX, XX,
        0x8b, XX, XX, XX,
        XX,
        XX, XX,
        0xFF, XX,
        0x88, XX, XX, XX,
        XX, XX, XX, XX,
        XX, XX,
        0x74, XX,
        XX, XX, XX, XX,
        XX,
        XX,
        0xE8, XX, XX, XX, XX,
        0xB0, 0x01,
        0xC3];
    return L.findBytes(bytes, minAddress, maxAddress);
}
function findtextrender3(minAddress, maxAddress, rominAddress, romaxAddress) {
    let addr = L.findBytes(L.aToBytes('const tjs_char * tTJSVariant::GetString() const\0'), rominAddress, romaxAddress);
    if (!addr) return 0;
    const pushs = L.find_leaorpush_addr_all(addr, minAddress, maxAddress);
    if (pushs.length !== 3) return 0;
    for (const target of pushs) {
        addr = L.findEnclosingAlignedFunction(target);
        if (!addr) continue;
        if (L.findxref_reverse_checkcallop(addr, minAddress, maxAddress, 0xe8).length !== 1) continue;
        const sig = [
            0x68, ...XX4,
            0xe8, ...XX4,
            0x83, 0xc4, 0x04,
            XX, ...XX4,
            XX,
            0xff, XX];
        if (!L.MatchPattern(target, sig)) continue;
        return target + sig.length;
    }
    return 0;
}
function findtextrender2(minAddress, maxAddress) {
    const bytes = [
        0x83, XX, 0x52,
        0x0f, 0x87, ...XX4,
        0x0f, 0xb6, XX, ...XX4,
        0xff, 0x24, XX, ...XX4];
    const addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return 0;
    bytes[2] = 0x0f;
    if (!L.findBytes(bytes, addr + bytes.length, addr + bytes.length + 0x100)) return 0;
    return L.findfuncstart(addr, 0x400, true);
}
function Krkrtextrenderdll() {
    const module = L.GetModuleHandleW('textrender.dll');
    if (module === 0) return false;
    if (L.GetProcAddress(module, 'V2Link') === 0) return false;
    const [rominAddress, romaxAddress] = L.QueryModuleLimits(module, 0, L.PAGE_READONLY);
    const [minAddress, maxAddress] = L.QueryModuleLimits(module);
    const hp = { offset: L.regoffset('eax') };
    let addr = findtextrender(minAddress, maxAddress);
    if (!addr) addr = findtextrender3(minAddress, maxAddress, rominAddress, romaxAddress);
    if (!addr) {
        hp.offset = L.stackoffset(1);
        addr = findtextrender2(minAddress, maxAddress);
    }
    if (!addr) return false;
    hp.address = addr;
    hp.type = L.CODEC_UTF16 | L.NO_CONTEXT | L.USING_STRING;
    hp.lineSeparator = '\\n';
    hp.filter_fun = KrkrtextrenderFilter;
    return L.NewHook(hp, 'TextRender');
}

function voiceLine(t, buffer) {
    const mc = L.re.search(t, String.raw`@voice.*?name='(.*?)'.*?word='(.*?)'`);
    if (!mc) return buffer.clear();
    const name = L.re.sub(mc[1], '（.*?）');
    return buffer.fromW(name + '「' + mc[2] + '」');
}
function KiriKiri4Filter(buffer) {
    let vw = buffer.viewW();
    if ((!vw.startsWith('[text]')) && (!(vw.endsWith('[c]') && (vw.startsWith('[>>]') || vw.startsWith('[地]')))) && (vw[0] === '[' && vw[vw.length - 1] === ']'))
        return buffer.clear();
    if (vw[0] === ' ' && vw.length <= 2) return buffer.clear();
    if (vw[0] === '@') return voiceLine(buffer.strW(), buffer);
    if (vw[0] === ']') return buffer.clear();
    if (vw.startsWith(' : ') && vw.endsWith(' : ')) return buffer.clear();
    if (vw === ' line offset ') return buffer.clear();
    L.StringReplacerW(buffer, '[>>]', '「');
    L.StringReplacerW(buffer, '[<<]', '」');
    L.StringFilterBetweenW(buffer, '[', ']');
    vw = buffer.viewW();
    if (vw.length <= 1) return buffer.clear();
}
function kagparser() {
    let succ = false;
    for (const dllname of ['KAGParser.dll', 'ExtKAGParser.dll']) {
        const hm = L.GetModuleHandle(dllname);
        if (!hm) continue;
        const [s, e] = L.QueryModuleLimits(hm, 0, L.PAGE_READONLY);
        let addr = L.findBytes(L.aToBytes('tTJSString tTJSString::operator +(const tjs_char *) const\0'), s, e);
        if (!addr) continue;
        addr = L.findBytes(L.le32(addr), s, e);
        if (!addr) continue;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        succ = L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.CODEC_UTF16 | L.USING_STRING, filter_fun: KiriKiri4Filter }, dllname) || succ;
    }
    return succ;
}
function filterkrkrz(ws) {
    ws = L.strReplace(ws, '／');
    ws = L.strReplace(ws, '　');
    ws = L.re.sub(ws, String.raw`\$r:(.*?),(.*?);`, '$1');
    ws = L.re.sub(ws, String.raw`\$(.*?);`);
    return ws;
}
function krkrzx() {
    const bytes = [
        0x8b, 0x4d, 0x10,
        0x66, 0x90,
        0x8b, 0x47, XX,
        0x48,
        0x83, 0xf8, 0x04,
        0x0f, 0x87, 0xaa, 0x00, 0x00, 0x00,
        0xff, 0x24, 0x85, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    let last = null;
    return L.NewHook({
        address: addr, offset: L.stackoffset(2), type: L.CODEC_UTF16 | L.USING_STRING,
        filter_fun(buffer) {
            const ws = buffer.strW();
            if (ws === last) return buffer.clear();
            last = ws;
            buffer.fromW(filterkrkrz(ws));
        },
    }, 'KiriKiriZX');
}
function layerExDraw() {
    const m = L.GetModuleHandle('layerExDraw.dll');
    if (!m) return false;
    const [s, e] = L.QueryModuleLimits(m, 0, L.PAGE_READONLY);
    let addr = L.findBytes(L.wToBytes('measureStringInternal\0'), s, e); // wchar_t[]: sizeof counts the NUL
    if (!addr) return false;
    addr = L.find_leaorpush_addr(addr, s, e);
    if (!addr) return false;
    const check = [
        0x68, ...XX4,
        0x68, ...XX4,
        0x8b, XX, XX,
        0xe8, ...XX4];
    if (!L.MatchPattern(addr - 5, check)) return false;
    return L.NewHook({ address: L.i32(addr - 4), offset: L.stackoffset(3), type: L.USING_STRING | L.CODEC_UTF16 }, 'measureStringInternal');
}
function InsertKiriKiriZHook() {
    let ok = Krkrtextrenderdll();
    ok = kagparser() || ok || layerExDraw();
    return krkrzx() | (InsertKiriKiriZHook2() || InsertKiriKiriZHook1()) || ok;
}

// EmbedKrkr2: LunaHook reads text here only after its own embed marked it ([plc]); kept for fidelity.
let type = 0;
function hookBefore(s, hp, buffer) {
    const text = s.esi;
    if (!text) return;
    let wstext = L.readW(text);
    if (!wstext) return;
    if (L.all_ascii(wstext)) return;
    if (wstext.length < 5 || wstext.slice(-5) !== '[plc]') return;
    type = 0;
    if (wstext.slice(0, 3) === '[x]') {
        type = 1;
        wstext = wstext.slice(3);
    } else if (wstext.slice(0, 3) === '[\u300c]') {
        type = 2;
        wstext = L.re.sub(wstext, '\\[\u300c\\]', '\u300c');
        wstext = L.re.sub(wstext, '\\[\u300d\\]', '\u300d');
    }
    if (type === 0) return;
    let innner = wstext.slice(0, wstext.length - 5);
    innner = L.re.sub(innner, '\\[eruby text=(.*?) str=(.*?)\\]', '$2');
    if (innner[innner.length - 1] === ']') {
        for (let i = innner.length; i > 0; i--) {
            if (innner[i] === '[') { innner = innner.slice(0, i); break; }
        }
    }
    buffer.fromW(innner);
}
function attachkr2(startAddress, stopAddress) {
    const addr = L.findBytes([0x66, 0x8B, 0x06, 0x66, 0x83, 0xF8, 0x3B, 0x0F, XX, ...XX4, 0x66, 0x83, 0xF8, 0x2A, 0x0F], startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.CODEC_UTF16 | L.NO_CONTEXT, text_fun: hookBefore }, 'EmbedKrkr2');
}

// Private::attach: `mov r32, r32` (8b c1/d9/e9/d1/f9/f1) followed within 0x10 by `mov r8, [esi]`
// (8a 06/1e/0e/16), then the UTF-8 lead byte compares 3c N / 80 ?? N in order within 0x1000.
function attachPrivate(startAddress, stopAddress) {
    const N = [0x80, 0xc2, 0xE0, 0xF0, 0xF8, 0xFC, 0xFE];
    const sigs = N.map((n) => [[0x3C, n], [0x80, XX, n]]);
    const { bytes: b, base } = L.region(startAddress, stopAddress);
    const at = (a) => b[a - base];
    let addr = startAddress, succ = false;
    const chatflags = ['（', '）', '。', '「', '」', '『', '』', '？', '！', '、', '―'].map(L.utf8A);
    while (addr) {
        addr = ((a) => {
            for (; a < stopAddress; a++) {
                if (at(a) === 0x8b && [0xc1, 0xd9, 0xe9, 0xd1, 0xf9, 0xf1].includes(at(a + 1))) return a;
            }
            return 0;
        })(addr + 1);
        if (!addr) continue;
        let check = ((a, stop) => {
            for (; a < stop; a++) if (at(a) === 0x8a && [0x06, 0x1e, 0x0e, 0x16].includes(at(a + 1))) return a;
            return 0;
        })(addr, addr + 0x10);
        if (check === 0) continue;
        let ok = true;
        for (const [first, second] of sigs) {
            const check1 = L.findBytes(first, check, check + 0x1000);
            const check2 = L.findBytes(second, check, check + 0x1000);
            check = Math.min(check1, check2);
            if (check === 0) check = Math.max(check1, check2);
            if (check === 0) { ok = false; break; }
        }
        if (!ok) continue;
        succ = L.NewHook({
            address: addr, offset: L.regoffset('ecx'), type: L.CODEC_UTF8 | L.NO_CONTEXT | L.USING_STRING,
            lineSeparator: '\\n',
            filter_fun(buffer) {
                let s = buffer.strA();
                if (s.length > 2000) return buffer.clear();
                if (L.all_ascii(s)) return buffer.clear();
                if (!chatflags.some((f) => s.includes(f))) return buffer.clear();
                s = L.re.sub(s, '%\\d+?;');
                s = L.re.sub(s, '#[0-9a-fA-F]*?;');
                s = L.re.sub(s, '%p.*?;%f.*?;');
                s = L.re.sub(s, String.raw`\[.*?\]`);
                s = L.re.sub(s, String.raw`\$_censorship\("(.*?)","(.*?)"\);`, '$2');
                s = L.re.sub(s, String.raw`\$\{_censorship\("(.*?)","(.*?)"\)\}`, '$2');
                buffer.fromA(s);
            },
        }, 'EmbedKrkrZ') || succ;
    }
    return succ;
}

function wcslen_wcscpy() {
    const bytes2 = [
        0x55, 0x8b, 0xec,
        0x53, 0x56, 0x8b, 0x75, 0x0c, 0x56, 0xe8, XX, 0xFF, 0xFF, 0xFF,
        0x59, 0x8b, 0xd8, 0x33, XX, 0x8b, 0x45, 0x08];
    const bytes = [
        0x55, 0x8b, 0xec,
        0x33, XX,
        0x8b, 0x45, 0x08,
        0xeb, 0x04,
        XX,
        0x83, 0xc0, 0x02,
        0x66, 0x83, 0x38, 0x00,
        0x75, 0xf6,
        0x8b, XX,
        0x5d, 0xc3];
    let addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    let off = 8;
    if (!addr) {
        addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        off = 4;
    }
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: off === 8 ? L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT : L.CODEC_UTF16 | L.USING_STRING,
        offset: off,
        filter_fun(buffer) {
            let t = buffer.strW();
            if (L.all_ascii(t)) return buffer.clear();
            if (['.ks', '.tjs', '.xp3', '/', '\\'].some((x) => t.includes(x))) return buffer.clear();
            if (t[0] === '@') return voiceLine(t, buffer);
            if (t.includes('\u8aad\u307f\u8fbc\u307f')) return buffer.clear();
            if (t.length > 4 && t.slice(-4) === '[np]') t = t.slice(0, -4);
            if (t.length > 4 && t.slice(-3) === '[r]') t = t.slice(0, -3);
            t = L.re.sub(t, '\\[\ruby text="(.*?)"\\]');
            t = L.re.sub(t, '\\[ruby text="(.*?)"\\]');
            t = L.re.sub(t, '\\[ch text="(.*?)"\\]', '$1');
            // LunaHook's test (c <= 127 && (c != '[' || c != ']')) is true for any ASCII character
            if ([...t].some((c) => c.charCodeAt(0) <= 127)) return buffer.clear();
            buffer.fromW(t);
        },
    }, 'Krkr2wcs');
}

function InsertKiriKiri4Hook() {
    const bytes = [
        0x66, 0xc7, 0x45, XX, 0xa4, 0x00,
        XX, XX, XX,
        XX, XX, ...XX4,
        XX, XX, XX,
        0xe8, ...XX4,
        XX, XX, XX,
        XX, XX, XX,
        XX, XX, XX,
        0x8B, 0x53, XX,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + bytes.length - 5, offset: L.regoffset('edx'), type: L.NO_CONTEXT | L.CODEC_UTF16 | L.USING_STRING,
        filter_fun: KiriKiri4Filter,
    }, 'KiriKiri4');
}

function krkrz2() {
    const bytes = [
        0x3b, XX,
        0x73, 0x18,
        0x0f, 0x1f, 0x80, 0x00, 0x00, 0x00, 0x00,
        0x8b, 0x43, 0x38,
        0x56,
        0x8b, 0x00,
        0xff, 0xd0,
        0x03, 0xf0,
        0x83, 0xc4, 0x04,
        0x3b, 0xf7,
        0x72, XX,
        0x8b, 0x43, 0x4c,
        0x8b, 0xce,
        0x48,
        0x83, 0xf8, 0x04,
        0x0f, 0x87, ...XX4,
        0xff, 0x24, 0x85, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    let idx = 0;
    return L.NewHook({
        address: addr, offset: L.regoffset('edx'), type: L.CODEC_UTF16 | L.USING_STRING,
        filter_fun(buffer) {
            if (idx++ % 2 === 0) return buffer.clear();
            buffer.fromW(filterkrkrz(buffer.strW()));
        },
    }, 'krkrz2');
}

const E = L.engine({
    name: 'KiriKiri',
    check: () => L.CheckFile('*.xp3') || L.SearchResourceString('TVP(KIRIKIRI)'),
    files: ['*.xp3'], // for the page: any of these alone passes the check
    attach() {
        if (L.SearchResourceString('TVP(KIRIKIRI) Z ')) {
            const krz = attachPrivate(L.processStartAddress, L.processStopAddress);
            if (InsertKiriKiriZHook() | krkrz2() | krz) return true;
        }
        const b1 = attachkr2(L.processStartAddress, L.processStopAddress);
        const _3 = wcslen_wcscpy();
        const _ = InsertKiriKiriHook() || InsertKiriKiriZHook() || b1 || _3;
        return InsertKiriKiri4Hook() || _;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
