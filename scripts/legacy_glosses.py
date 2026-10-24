#!/usr/bin/env python3
"""
legacy_glosses.py
Writes src/data/vocabBankLegacyGlosses.json: for every headword, the translations and example
sentences that earlier versions of vocabBank15k.json shipped and the current file no longer uses.
Deck cards copy their translation and example from the bank, so the server uses these lists to find
cards that still show a superseded meaning ("die Sängerin = songstress") or an old machine-made
sentence, and refresh them (see src/utils/seedVocabBank.js). Sentences a user collected themselves
never appear in these lists, so their cards are left alone.

Output shape: {"translations": {word: [old, ...]}, "examples": {word: [old, ...]}}

Usage: python3 scripts/legacy_glosses.py [git revisions of old bank versions ...]
"""

import os
import sys
import json
import subprocess

sys.path.insert(0, os.path.dirname(__file__))
from vocab_bank_lib import ROOT, BANK_PATH, load_bank

# 1d59094 / 43d298f: original builds; 3204f15: first repair; a754ff2: Goethe rebuild
DEFAULT_REVISIONS = ['1d59094', '43d298f', '3204f15', 'a754ff2']
OUT_PATH = os.path.join(ROOT, 'src/data/vocabBankLegacyGlosses.json')


def main():
    revisions = sys.argv[1:] or DEFAULT_REVISIONS
    current = {e['word']: e for e in load_bank(BANK_PATH)}
    legacy = {'translations': {}, 'examples': {}}
    for rev in revisions:
        raw = subprocess.check_output(['git', 'show', f'{rev}:src/data/vocabBank15k.json'], cwd=ROOT)
        for e in json.loads(raw):
            now = current.get(e['word'], {})
            for field, key in (('translation', 'translations'), ('example', 'examples')):
                old = e.get(field) or ''
                if old and old != now.get(field):
                    olds = legacy[key].setdefault(e['word'], [])
                    if old not in olds:
                        olds.append(old)
    out = {key: dict(sorted(v.items())) for key, v in legacy.items()}
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f"{len(out['translations'])} headwords with superseded translations, "
          f"{len(out['examples'])} with superseded examples -> {OUT_PATH} "
          f"({os.path.getsize(OUT_PATH) // 1024} KB)")


if __name__ == '__main__':
    main()
