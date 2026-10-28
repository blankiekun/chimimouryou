// TamaokaSoft.js: LunaHook's TamaokaSoft engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TamaokaSoft.cpp and TamaokaSoft.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'TamaokaSoft',
    // 世界ノ全テノ全テ 通常版
    // https://vndb.org/r21299
    check: { FILE_ALL: ['ac.acv', 'bg.acv', 'char.acv', 'ed.acv', 'info.acv', 'op.acv', 'se.acv', 'snr.acv', 'voice.acv'] },
    attach() {
        return L.NewHook({
            address: L.FindFunction('TextOutA'),
            offset: L.stackoffset(4),
            split: L.stackoffset(4),
            type: L.USING_STRING | L.USING_SPLIT,
        }, 'TamaokaSoft');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
