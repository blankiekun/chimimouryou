"""Builds the data tables of ../features.py:

- ../kanji-grades.json: 常用 kanji and their school grade (1-6 教育漢字, 8 the rest), from
  KANJIDIC2 (EDRDG, CC BY-SA 4.0, https://www.edrdg.org/kanjidic/kanjidic2.xml.gz).
- apps/web/src/lib/data/kanji-readings.json: on and kun readings (hiragana, okurigana
  dropped) of 常用 and 人名用 kanji, from KANJIDIC2, for the reader's "Known" furigana style.
- ../goshu.json.gz: word origin (語種: 和 wago, 漢 kango, 外 gairaigo, 混 mixed) of the
  kanji-spelled words in Jiten's frequency list, from UniDic (unidic-lite, BSD), for
  the jReadability kango/wago percentages.

Needs fugashi and unidic-lite: python make_tables.py kanjidic2.xml.gz frequency-dictionary.zip
"""
import gzip, json, os, re, sys
from xml.etree import ElementTree
import fugashi
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from frequency import load_yomitan_ranks  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HAS_KANJI = re.compile(r'[㐀-䶿一-鿿豈-﫿]')
# Words rarer than this are rare enough that their origin barely moves the percentages.
MAX_RANK = 120_000

def hiragana(text):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in text)


grades = {}
readings = {}
for char in ElementTree.parse(gzip.open(sys.argv[1])).getroot().iter('character'):
    grade = char.findtext('misc/grade')
    if grade and int(grade) <= 8:
        grades[char.findtext('literal')] = int(grade)
    if grade and int(grade) <= 10:
        found = []
        for r in char.iter('reading'):
            if r.get('r_type') in ('ja_on', 'ja_kun'):
                value = hiragana(r.text.split('.')[0].strip('-'))
                if value and value not in found:
                    found.append(value)
        if found:
            readings[char.findtext('literal')] = ' '.join(found)
web_data = os.path.join(OUT, '..', '..', '..', 'apps', 'web', 'src', 'lib', 'data', 'kanji-readings.json')
json.dump(readings, open(web_data, 'w'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(len(readings), 'kanji with readings')
json.dump(grades, open(os.path.join(OUT, 'kanji-grades.json'), 'w'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(len(grades), 'jōyō kanji')

tagger = fugashi.Tagger()
goshu = {}
for term, rank in load_yomitan_ranks(sys.argv[2]).items():
    if rank > MAX_RANK or not HAS_KANJI.search(term):
        continue
    origins = {n.feature.goshu for n in tagger(term)} - {None, '*', '記号', '固'}
    if origins == {'和'} or origins == {'漢'} or origins == {'外'}:
        goshu[term] = origins.pop()
    elif origins:
        goshu[term] = '混'
with gzip.open(os.path.join(OUT, 'goshu.json.gz'), 'wt', encoding='utf-8') as f:
    json.dump(goshu, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(len(goshu), 'words with an origin')
