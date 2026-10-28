#!/usr/bin/env python3
"""Checks JS engine ports against LunaHook's engine32 C++ sources: every byte pattern, number, and
string literal in the C++ code (comments dropped) should show up in the port. Run with -I.

  LUNA=<LunaTranslator clone> python3 -I check-port.py <engines dir> [Name ...]     (default: every <Name>.js that has a C++ source)

Byte patterns: each run of 3+ fixed bytes (split at XX wildcards) must appear in the port's byte stream
(hex numbers in the JS, in order, from arrays or "55 8b ??" strings). Numbers: hex constants >= 0x10
and decimal offsets/sizes. Strings: L"..."/"..." literals (file checks, exe strings). Exit 1 if any port
misses something; a miss can be fine (dead code, embed parts) and the PR must say why.
"""
import re
import sys
from pathlib import Path

import os

# A LunaTranslator clone (https://github.com/HIllya51/LunaTranslator, commit be625f4) in $LUNA.
CPP = Path(os.environ.get('LUNA', 'LunaTranslator')) / 'src/NativeImpl/LunaHook/LunaHook/engine32'


def strip_comments(code):
    code = re.sub(r'/\*.*?\*/', ' ', code, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', code)


def byte_runs(code):
    """Runs of 3+ fixed bytes from each `bytes[] = {...}`-style array."""
    runs = []
    for body in re.findall(r'(?:BYTE|char)\s+\w+\[\]\s*=\s*\{(.*?)\}', code, re.S):
        run = []
        for tok in (t.strip() for t in body.split(',')):
            if re.fullmatch(r'0x[0-9a-fA-F]{1,2}', tok):
                run.append(int(tok, 16))
                continue
            if len(run) >= 3:
                runs.append(run)
            run = []
        if len(run) >= 3:
            runs.append(run)
    return runs


def js_bytes(js):
    """All byte-sized hex values in the JS, in order (arrays and pattern strings)."""
    return [int(h, 16) for h in re.findall(r'(?<![0-9a-fA-Fx])(?:0x)?([0-9a-fA-F]{2})(?![0-9a-fA-F])', js)]


def contains(seq, run):
    n = len(run)
    return any(seq[i:i + n] == run for i in range(len(seq) - n + 1))


def numbers(code):
    nums = {int(h, 16) for h in re.findall(r'\b0x([0-9a-fA-F]+)\b', code)}
    nums |= {int(d) for d in re.findall(r'(?<![\w.])(\d{2,})(?![\w.])', code)}
    return {n for n in nums if n >= 0x10}


def js_numbers(js):
    return {int(h, 16) for h in re.findall(r'\b0x([0-9a-fA-F]+)\b', js)} | {
        int(d) for d in re.findall(r'(?<![\w.])(\d+)(?![\w.])', js)}


def strings(code):
    code = re.sub(r'^\s*#include[^\n]*', ' ', code, flags=re.M)
    return {s for s in re.findall(r'L?"((?:[^"\\]|\\.)+)"', code) if len(s) > 1 and not s.startswith('%')}


def check(name, js_path):
    cpp = strip_comments((CPP / f'{name}.cpp').read_text(encoding='utf-8', errors='replace'))
    js = strip_comments(js_path.read_text(encoding='utf-8'))
    jsb, jsn = js_bytes(js), js_numbers(js)
    missing_runs = [r for r in byte_runs(cpp) if not contains(jsb, r)]
    missing_nums = sorted(n for n in numbers(cpp) - jsn if not any(contains(jsb, r) and n in r for r in byte_runs(cpp)))
    missing_strs = sorted(s for s in strings(cpp) if s.replace('\\\\', '\\') not in js and s not in js)
    return missing_runs, missing_nums, missing_strs


def main():
    folder = Path(sys.argv[1])
    names = sys.argv[2:] or sorted(p.stem for p in folder.glob('*.js') if (CPP / f'{p.stem}.cpp').exists())
    bad = 0
    for name in names:
        runs, nums, strs = check(name, folder / f'{name}.js')
        if runs or nums or strs:
            bad += 1
            print(f'{name}:')
            for r in runs:
                print('  pattern', ' '.join(f'{b:02x}' for b in r))
            if nums:
                print('  numbers', ' '.join(hex(n) for n in nums[:30]), '...' if len(nums) > 30 else '')
            for s in strs[:20]:
                print('  string ', s)
    print(f'{len(names) - bad}/{len(names)} ports carry every pattern, number and string')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
