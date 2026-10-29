#!/usr/bin/env python3
"""Freezes the 1-10 book difficulty scale (../core-scale.json) from a reference set of V98s (core.py):
a sten-style bell curve, mean 5.5 and SD 2, so a score s sits at the reference's quantile
Φ((s - 5.5) / 2). The file keeps one anchor [score, V98] per quarter step from 1 to 10; core.score
interpolates between them in log V98. Made once and versioned: scores never move as books are
added. A new reference means a new `version` (and every shown score changes).

  core_scale.py RESULTS.json [--version N]

RESULTS.json: the difficulty service's difficulty.json (its books' core.v98), or a JSON list of
V98s (null: beyond the frequency list). Only the anchors are written, never anything of a book.
Not upstream."""
import argparse
import json
import math
import os
from statistics import NormalDist

HERE = os.path.dirname(os.path.realpath(__file__))
OUT = os.path.join(HERE, '..', 'core-scale.json')
# Beyond the list: past every ranked V98 (the list's ranks end near 400,000).
BEYOND = 500_000


def anchors(values: list) -> list:
    logs = sorted(math.log(v or BEYOND) for v in values)
    result = []
    for step in range(37):
        s = 1 + step / 4
        p = NormalDist().cdf((s - 5.5) / 2)
        at = p * (len(logs) - 1)
        low = int(at)
        x = logs[low] + (logs[min(low + 1, len(logs) - 1)] - logs[low]) * (at - low)
        v = round(math.exp(x))
        # Strictly rising, so the mapping is monotone and invertible.
        if result and v <= result[-1][1]:
            v = result[-1][1] + 1
        result.append([s, v])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('results')
    parser.add_argument('--version', type=int, default=1)
    args = parser.parse_args()
    with open(args.results, encoding='utf-8') as f:
        data = json.load(f)
    values = data if isinstance(data, list) else [
        book['core']['v98'] for book in data['books'].values() if book.get('core')]
    with open(OUT, encoding='utf-8') as f:
        scale = json.load(f) if os.path.getsize(OUT) else {}
    scale.update(version=args.version, reference=f'{len(values)} books', anchors=anchors(values))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(scale, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
