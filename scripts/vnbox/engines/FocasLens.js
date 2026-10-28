// FocasLens.js: LunaHook's FocasLens engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/FocasLens.cpp and FocasLens.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** jichi 2/6/2015 FocasLens (Touhou)
 *  Sample game: [141227] [FocasLens] 幻想人形演舞
 *  The game also invokes GDI functions (GetGlyphOutlineA), where the access is cached and looped.
 *  Issues: this hook cannot find name thread; selected character name is hard-coded to the thread.
 *
 *  001fabb9   8a1402           mov dl,byte ptr ds:[edx+eax]
 *  001fabbc   881406           mov byte ptr ds:[esi+eax],dl    ; jichi: text is in dl in byte
 */
function SpecialHookFocasLens(context, hp, buffer, split) {
    // LunaHook reads the byte of the saved edx in the register frame: that is dl
    const dl = context.edx & 0xff;
    if (dl) {
        buffer.from_t(dl, 1);
        split.value = L.FIXED_SPLIT_VALUE;
    }
}

function InsertFocasLensHook() {
    const bytes = [
        0x8a, 0x14, 0x02, // 001fabb9   8a1402           mov dl,byte ptr ds:[edx+eax]
        0x88, 0x14, 0x06, // 001fabbc   881406           mov byte ptr ds:[esi+eax],dl    ; jichi: text is in dl in byte
        0x40, // 001fabbf   40               inc eax
        0x3b, 0xc3, // 001fabc0   3bc3             cmp eax,ebx
    ];
    const addr_offset = 0x001fabbc - 0x001fabb9;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        text_fun: SpecialHookFocasLens, // use special hook to force byte access
        type: L.USING_STRING | L.USING_SPLIT | L.FIXING_SPLIT | L.NO_CONTEXT, // no context to get rid of relative function address
    }, 'FocasLens');
}

const E = L.engine({
    name: 'FocasLens',
    certain: false,
    check: { FILE: 'dat\\*.arc' },
    attach() { return InsertFocasLensHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
