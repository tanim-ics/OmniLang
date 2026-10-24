#!/usr/bin/env python3
"""
audit_vocab_bank.py
Flags suspicious entries in src/data/vocabBank15k.json with heuristics:
  - function_word_noun / verb_form_noun / nominalised_infinitive / homograph_noun:
    nouns whose frequency rank was borrowed from a function word or verb form
    ("das Ich", "die Habe", "das Können")
  - gloss_markup: dictionary markup left in the gloss ("to eat {ate", "sth.")
  - rare_sense: frequent German word glossed with a rare English word
    ("richtig = duly", "rein = chastely")
  - verb_gloss_form / pos_gloss_mismatch / gloss_is_headword
  - template_example / example_missing_headword / example_en_markup

Usage:
  python3 scripts/audit_vocab_bank.py [--bank PATH] [--out report.json] [--show FLAG] [--limit N]
"""

import sys
import json
import argparse
from collections import Counter

sys.path.insert(0, __import__('os').path.dirname(__file__))
from vocab_bank_lib import (BANK_PATH, load_bank, load_freq, build_index, split_headword,
                            headword_forms, audit_entry)


def audit(bank):
    en_freq = load_freq('en_50k.txt')
    index = build_index({split_headword(e['word'])[1] for e in bank})
    verb_forms = set()
    for e in bank:
        if e['type'] == 'verb':
            for sense in index.get(e['word'], []):
                if sense.pos == 'verb' and sense.subentries > 3:  # main conjugation entries only
                    verb_forms.update(f for f in sense.forms if ' ' not in f)
    bank_words = {e['word']: e['type'] for e in bank if e['type'] != 'noun'}
    results = []
    for i, e in enumerate(bank):
        forms = headword_forms(e, index.get(split_headword(e['word'])[1], []))
        flags = audit_entry(e, i, en_freq, verb_forms, bank_words, forms)
        if flags:
            results.append({'index': i, 'word': e['word'], 'translation': e['translation'],
                            'level': e['level'], 'flags': flags})
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', default=BANK_PATH)
    ap.add_argument('--out')
    ap.add_argument('--show', help='print entries carrying this flag')
    ap.add_argument('--limit', type=int, default=40)
    args = ap.parse_args()

    bank = load_bank(args.bank)
    results = audit(bank)
    counts = Counter(f for r in results for f in r['flags'])
    content_flags = [r for r in results if set(r['flags']) - {'template_example'}]

    print(f"Entries: {len(bank)}")
    print(f"Flagged: {len(results)} ({len(content_flags)} excluding template-only examples)")
    for flag, n in counts.most_common():
        print(f"  {flag:26} {n}")

    if args.show:
        shown = [r for r in results if args.show in r['flags']][:args.limit]
        for r in shown:
            print(f"  [{r['level']}] {r['word']} = {r['translation']}  {r['flags']}")

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump({'counts': counts, 'entries': results}, f, ensure_ascii=False, indent=2)
        print(f"Report written to {args.out}")


if __name__ == '__main__':
    main()
