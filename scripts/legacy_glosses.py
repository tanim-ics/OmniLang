#!/usr/bin/env python3
"""
legacy_glosses.py
Writes src/data/vocabBankLegacyGlosses.json: for every headword, the translations that earlier
versions of vocabBank15k.json shipped and the current file no longer uses. Deck cards copy their
translation from the bank, so the server uses this list to find cards that still show a
superseded meaning ("die Sängerin = songstress") and refresh them (see src/utils/seedVocabBank.js).

Usage: python3 scripts/legacy_glosses.py [git revisions of old bank versions ...]
"""

import os
import sys
import json
import subprocess

sys.path.insert(0, os.path.dirname(__file__))
from vocab_bank_lib import ROOT, BANK_PATH, load_bank

# 1d59094: original build; 3204f15: first repair (PR #2)
DEFAULT_REVISIONS = ['1d59094', '3204f15']
OUT_PATH = os.path.join(ROOT, 'src/data/vocabBankLegacyGlosses.json')


def main():
    revisions = sys.argv[1:] or DEFAULT_REVISIONS
    current = {e['word']: e['translation'] for e in load_bank(BANK_PATH)}
    legacy = {}
    for rev in revisions:
        raw = subprocess.check_output(['git', 'show', f'{rev}:src/data/vocabBank15k.json'], cwd=ROOT)
        for e in json.loads(raw):
            old = e['translation']
            if old != current.get(e['word']):
                legacy.setdefault(e['word'], [])
                if old not in legacy[e['word']]:
                    legacy[e['word']].append(old)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(legacy.items())), f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f"{len(legacy)} headwords with superseded translations -> {OUT_PATH} "
          f"({os.path.getsize(OUT_PATH) // 1024} KB)")


if __name__ == '__main__':
    main()
