"""Checks the estimates against how fast readers actually read: for each reader (sync
root), a book's reading speed relative to that reader's median speed, which falls as
books get harder. Prints the Spearman correlation with the 1-10 level (expected negative).

python3 validate_speed.py difficulty.json catalog.json SYNC_ROOT...
(e.g. /data/sync/ttu-reader-data and /data/accounts/*/account/sync/ttu-reader-data)
"""
import glob, json, os, statistics, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import core  # noqa: E402

# Books read for less than this give no reliable speed.
MIN_SECONDS = 20 * 60


def ranks(values):
    order = sorted(range(len(values)), key=values.__getitem__)
    result = [0.0] * len(values)
    for rank, i in enumerate(order):
        result[i] = rank
    return result


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    return statistics.correlation(ra, rb)


difficulty = json.load(open(sys.argv[1]))['books']
by_title = {b['title']: str(b['id']) for b in json.load(open(sys.argv[2]))['books']}
pairs = []
for root in sys.argv[3:]:
    speeds = {}
    for path in glob.glob(os.path.join(root, '*', 'statistics_*.json')):
        title = os.path.basename(os.path.dirname(path))
        days = json.load(open(path))
        seconds = sum(d.get('readingTime', 0) for d in days)
        characters = sum(d.get('charactersRead', 0) for d in days)
        if seconds >= MIN_SECONDS and characters and by_title.get(title) in difficulty:
            speeds[title] = characters / seconds * 3600
    if len(speeds) < 3:
        continue
    median = statistics.median(speeds.values())
    scale = core.load_scale()
    pairs += [(core.score(difficulty[by_title[t]]['core']['v98'], scale), s / median)
              for t, s in speeds.items() if difficulty[by_title[t]].get('core')]

print(len(pairs), 'books with enough reading time')
if len(pairs) >= 10:
    print(f'Spearman (difficulty, relative speed): {spearman(*zip(*pairs)):+.2f}')
else:
    print('Too few books to compare; read more with statistics on.')
