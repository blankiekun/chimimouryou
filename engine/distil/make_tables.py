"""Builds ../kanji-grades.json: 常用 kanji and their school grade (1-6 教育漢字, 8 the rest), from
KANJIDIC2 (EDRDG, CC BY-SA 4.0, https://www.edrdg.org/kanjidic/kanjidic2.xml.gz).

kanji-readings.json, for the reader's "Known" furigana, is yurigana's (tools/kanji_readings.py there).

python make_tables.py kanjidic2.xml.gz
"""
import gzip, json, os, sys
from xml.etree import ElementTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

grades = {}
for char in ElementTree.parse(gzip.open(sys.argv[1])).getroot().iter('character'):
    grade = char.findtext('misc/grade')
    if grade and int(grade) <= 8:
        grades[char.findtext('literal')] = int(grade)
json.dump(grades, open(os.path.join(OUT, 'kanji-grades.json'), 'w'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(len(grades), 'jōyō kanji')
