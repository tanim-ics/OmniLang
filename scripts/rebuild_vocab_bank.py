#!/usr/bin/env python3
"""
rebuild_vocab_bank.py
Re-levels and re-glosses src/data/vocabBank15k.json (run after repair_vocab_bank.py):

  1. Levels come from the official Goethe-Institut word lists (A1 = Start Deutsch 1 +
     Fit in Deutsch 1, A2, B1; see goethe_wordlists.py). Goethe words missing from the
     bank are added. Every other word is labelled B2 ("B2+" in the UI): the old levels
     were subtitle-frequency bands, not CEFR.
  2. Meanings come from Wiktionary (kaikki.org extract): the first sense that is not
     archaic/regional/rare, which on Wiktionary is the main everyday sense. Feminine
     forms get "female <base meaning>".
  3. Entries that are neither Goethe words, curated, nor real Wiktionary lemmas (with
     the right gender for nouns) are dropped.
  4. Hand-curated entries (vocab_bank_curated.tsv) and the manual review of the A1-B1
     core (vocab_bank_review.tsv) override everything.
  5. With --check, the local LLM picks the everyday sense of B2+ words among their Wiktionary
     senses (it can only choose a real meaning, not invent one).
  6. Hand-written example sentences (vocab_bank_examples.tsv) are applied; A1-B1 words still
     without one get a dictionary or LLM-written sentence (validated, cached).

Duplicates are keyed by the displayed headword ("die See" and "der See" are different
words; "Sängerin" and "die Sängerin" are the same).

Usage:
  python3 scripts/rebuild_vocab_bank.py [--examples-limit N] [--dry-run] [--review-dump LEVEL]
"""

import os
import re
import sys
import json
import time
import argparse
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from vocab_bank_lib import (BANK_PATH, CACHE_DIR, load_bank, save_bank, load_freq, split_headword, wiktionary_index,
                            wiktionary_gloss, build_index, headword_forms)
from repair_vocab_bank import load_curated, stage_examples, CURATED_PATH

GOETHE_LEVELS = os.path.join(CACHE_DIR, 'goethe/levels.json')
REVIEW_PATH = os.path.join(os.path.dirname(__file__), 'vocab_bank_review.tsv')
EXAMPLES_PATH = os.path.join(os.path.dirname(__file__), 'vocab_bank_examples.tsv')
GENDER_ARTICLE = {'m': 'der', 'f': 'die', 'n': 'das', 'p': 'die'}
LEVEL_ORDER = {'A1': 0, 'A2': 1, 'B1': 2, 'B2': 3}

stats = Counter()


def wikt_entries(W, lemma, wtype=None, article=None):
    out = []
    for cand in dict.fromkeys([lemma, lemma.capitalize() if article else lemma]):
        for x in W.get(cand, []):
            if article:
                if x['pos'] != 'noun' or (x['gender'] and GENDER_ARTICLE.get(x['gender']) != article):
                    continue
            elif wtype and wtype != 'noun' and x['pos'] == 'noun':
                continue
            out.append(x)
    return out


EN_FREQ = None


def best_gloss(entries, wtype):
    """First everyday sense (skipping archaic/regional/rare and long definitions)."""
    global EN_FREQ
    if EN_FREQ is None:
        EN_FREQ = load_freq('en_50k.txt')
    glosses = []
    for x in entries:
        if wtype in ('adjective', 'adverb') and x['pos'] not in ('adjective', 'adverb'):
            continue
        if wtype == 'verb' and x['pos'] != 'verb':
            continue
        for s in x['senses']:
            if s['tags']:
                continue
            g = wiktionary_gloss(s['gloss'], x['pos'], EN_FREQ)
            if not g or len(g.split(',')[0].split()) > 5 \
                    or g.lower().startswith(('used ', 'indicates', 'expresses', 'denotes', 'to used')):
                continue
            return g
    return None


def feminine_gloss(W, lemma):
    """Lehrerin -> 'female teacher' (Wiktionary only says 'female equivalent of Lehrer')."""
    if not lemma.endswith('in'):
        return None
    base = lemma[:-2]
    for cand in (base, base.replace('ä', 'a').replace('ö', 'o').replace('ü', 'u'), base + 'e'):
        g = best_gloss(wikt_entries(W, cand, article='der'), 'noun')
        if g:
            return 'female ' + g.split(',')[0]
    return None


CHECK_SYSTEM = """You are an expert German-English lexicographer. For each German word you get its possible
English meanings, all taken from Wiktionary. Pick the meaning a German speaker most commonly means in
everyday language (e.g. "das Kätzchen": kitten, not catkin). Answer with a JSON object mapping each item
number to the number of the chosen meaning."""


def sense_options(entries, wtype):
    opts = []
    for x in entries:
        if wtype in ('adjective', 'adverb') and x['pos'] not in ('adjective', 'adverb'):
            continue
        if wtype == 'verb' and x['pos'] != 'verb':
            continue
        for s_ in x['senses']:
            if s_['tags']:
                continue
            g = wiktionary_gloss(s_['gloss'], x['pos'], EN_FREQ).split(',')[0].strip()
            if g and len(g.split()) <= 5 and g.lower() not in (o.lower() for o in opts):
                opts.append(g)
    return opts[:5]


def stage_check(bank, W, batch_size=20):
    """mistral picks the everyday sense among Wiktionary's senses for B2+ words (cached)."""
    from repair_vocab_bank import Cache, ollama_json, keyed_schema
    cache = Cache('llm-sense-check.json')
    todo = []
    for e in bank:
        if e['level'] != 'B2' or e.get('_manual'):
            continue
        art, lemma = split_headword(e['word'])
        opts = sense_options(wikt_entries(W, lemma, e['type'], art), e['type'])
        if len(opts) >= 2:
            todo.append((e, opts))
    pending = [(e, o) for e, o in todo if e['word'] + '\t' + '|'.join(o) not in cache.data]
    print(f"  sense check: {len(todo)} entries with several senses, {len(pending)} not cached", flush=True)
    t0 = time.time()
    for b in range(0, len(pending), batch_size):
        batch = pending[b:b + batch_size]
        lines = [f"{i + 1}. {e['word']}: " + '; '.join(f"{k + 1}) {g}" for k, g in enumerate(o))
                 for i, (e, o) in enumerate(batch)]
        keys = [str(i + 1) for i in range(len(batch))]
        schema = {'type': 'object', 'properties': {k: {'type': 'integer'} for k in keys}, 'required': keys}
        try:
            out = ollama_json(CHECK_SYSTEM, '\n'.join(lines), schema, num_predict=8 * len(batch) + 80)
        except Exception as err:
            print(f"  ! batch {b} failed: {err}")
            continue
        for k, (e, o) in zip(keys, batch):
            if isinstance(out.get(k), int) and 1 <= out[k] <= len(o):
                cache.data[e['word'] + '\t' + '|'.join(o)] = out[k]
        cache.save()
        done = b + len(batch)
        rate = (time.time() - t0) / done
        print(f"  {done}/{len(pending)}  ({rate:.2f}s/entry, ~{rate * (len(pending) - done) / 60:.0f} min left)", flush=True)
    for e, o in todo:
        pick = cache.data.get(e['word'] + '\t' + '|'.join(o))
        if pick and pick != 1:
            e['translation'] = o[pick - 1]
            stats['sense_changed_by_check'] += 1


def headword_for(item, W):
    """Goethe item -> displayed headword and type."""
    lemma, art = item['lemma'], item.get('article')
    if art:
        return f"{art} {lemma}", 'noun'
    if lemma[:1].isupper() and ' ' not in lemma:
        genders = [x['gender'] for x in W.get(lemma, []) if x['pos'] == 'noun' and x['gender'] in GENDER_ARTICLE]
        if genders:
            return f"{GENDER_ARTICLE[genders[0]]} {lemma}", 'noun'
        if lemma.endswith('in') and feminine_gloss(W, lemma):
            return f"die {lemma}", 'noun'
        return lemma, 'noun'
    if ' ' in lemma:
        return lemma, 'phrase'
    poses = [x['pos'] for x in W.get(lemma, []) if x['pos'] != 'noun']
    return lemma, (poses[0] if poses else 'word')


def load_examples(path=EXAMPLES_PATH):
    """Hand-written example sentences: word | example | exampleEn."""
    out = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                cols = [c.strip() for c in line.split(' | ')]
                if len(cols) == 3 and cols[1] and cols[2]:
                    out[cols[0]] = (cols[1], cols[2])
    return out


def load_reviews():
    entries, removals = load_curated(REVIEW_PATH) if os.path.exists(REVIEW_PATH) else ({}, [])
    return entries, set(removals)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', default=BANK_PATH)
    ap.add_argument('--examples-limit', type=int, default=4000)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--check', action='store_true', help='let the local LLM pick the everyday sense for B2+ words')
    ap.add_argument('--review-dump', help='write A1/A2/B1 entries of this level to .cache for manual review')
    args = ap.parse_args()

    W = wiktionary_index()
    with open(GOETHE_LEVELS, encoding='utf-8') as f:
        goethe = json.load(f)
    bank = load_bank(args.bank)
    curated, curated_removed = load_curated(CURATED_PATH)
    reviewed, review_removed = load_reviews()
    removed = set(curated_removed) | review_removed
    by_word = {e['word']: e for e in bank}
    by_lemma = {}
    for e in bank:
        by_lemma.setdefault(split_headword(e['word'])[1].lower(), []).append(e)

    # 1. Goethe levels (lowest level wins; goethe_wordlists.py already deduplicated across levels)
    goethe_level = {}
    unresolved = []
    for level in ('A1', 'A2', 'B1'):
        for item in goethe[level]:
            word, wtype = headword_for(item, W)
            if word in removed:
                continue
            known = word in by_word or word in curated or word in reviewed
            in_wikt = bool(wikt_entries(W, split_headword(word)[1], wtype, split_headword(word)[0])) \
                or bool(feminine_gloss(W, split_headword(word)[1]))
            if not known and not in_wikt:
                unresolved.append((level, item['raw'], word))
                continue
            goethe_level.setdefault(word, level)
            if word not in by_word:
                e = {'word': word, 'translation': '', 'level': level, 'type': wtype,
                     'example': '', 'exampleEn': '', 'topic': 'General'}
                if item.get('plural'):
                    e['plural'] = item['plural']
                bank.append(e)
                by_word[word] = e
                stats['added_from_goethe'] += 1
            elif item.get('plural') and not by_word[word].get('plural'):
                by_word[word]['plural'] = item['plural']

    # 2./3. Levels, Wiktionary glosses, drop unverifiable entries
    kept = []
    for e in bank:
        word = e['word']
        if word in removed:
            stats['removed_manual'] += 1
            continue
        art, lemma = split_headword(word)
        e['level'] = goethe_level.get(word, 'B2')
        override = reviewed.get(word) or curated.get(word)
        entries = wikt_entries(W, lemma, e['type'], art)
        if not override and not entries and word not in goethe_level:
            if not feminine_gloss(W, lemma):
                stats['dropped_not_in_wiktionary'] += 1
                continue
        if override:
            for k in ('type', 'translation', 'example', 'exampleEn'):
                if override.get(k):
                    e[k] = override[k]
            if word in curated:
                # hand-curated core words default to A1; a Goethe level only wins when it is lower
                # (the B1 list mentions "fünf" inside a time phrase)
                own = curated[word].get('level') or 'A1'
                e['level'] = min(own, e['level'], key=LEVEL_ORDER.get)
            elif override.get('level') and word not in goethe_level:
                e['level'] = override['level']
            e['_manual'] = True
            stats['overridden_manual'] += 1
        else:
            g = best_gloss(entries, e['type']) or (feminine_gloss(W, lemma) if art == 'die' else None)
            if g and g.lower() != e['translation'].lower():
                e['translation'] = g
                stats['gloss_from_wiktionary'] += 1
            if not e['translation']:
                stats['dropped_no_gloss'] += 1
                continue
        if art and not e.get('plural'):
            plurals = [x['plural'] for x in entries if x.get('plural')]
            if plurals:
                e['plural'] = plurals[0]
        kept.append(e)
    bank = kept

    # Curated / reviewed entries that are new to the bank
    have = {e['word'] for e in bank}
    for source in (curated, reviewed):
        for word, fields in source.items():
            if word in have or word in removed or not fields.get('translation'):
                continue
            e = {'word': word, 'level': goethe_level.get(word, fields.get('level') or 'B2'), 'topic': 'General',
                 'type': fields['type'], 'translation': fields['translation'],
                 'example': fields.get('example', ''), 'exampleEn': fields.get('exampleEn', '')}
            bank.append(e)
            have.add(word)
            stats['added_manual'] += 1

    # Order: level, then the original frequency order
    order = {e['word']: i for i, e in enumerate(load_bank(args.bank))}
    bank.sort(key=lambda e: (LEVEL_ORDER[e['level']], order.get(e['word'], -1)))
    assert len({e['word'] for e in bank}) == len(bank), 'duplicate headwords'

    if args.review_dump:
        path = os.path.join(CACHE_DIR, f"review-{args.review_dump}.txt")
        with open(path, 'w', encoding='utf-8') as f:
            for e in bank:
                if e['level'] == args.review_dump:
                    f.write(f"{e['word']} | {e['type']} | {e['translation']}\n")
        with open(os.path.join(CACHE_DIR, 'review-unresolved.txt'), 'w', encoding='utf-8') as f:
            for lvl, raw, word in unresolved:
                f.write(f"{lvl} | {word} | {raw}\n")
        print(f"Review list written to {path}")

    if args.check:
        print('Sense check (B2+)')
        stage_check(bank, W)

    # 5. Examples: hand-written ones first, then dictionary/LLM sentences for the rest of the A1-B1 core
    handwritten = load_examples()
    for e in bank:
        if e['word'] in handwritten:
            e['example'], e['exampleEn'] = handwritten[e['word']]
            e['_curated'] = True
            stats['example_handwritten'] += 1
    core = [e for e in bank if e['level'] != 'B2']
    for e in core:
        e['_curated'] = e.get('_curated') or bool(reviewed.get(e['word'], {}).get('example')
                                                  or curated.get(e['word'], {}).get('example'))
    if args.examples_limit:
        index = build_index({split_headword(e['word'])[1] for e in core})
        stage_examples(core, index, args.examples_limit)
    for e in bank:
        e.pop('_curated', None)
        e.pop('_manual', None)

    levels = Counter(e['level'] for e in bank)
    print('\n=== REBUILD SUMMARY ===')
    print(f"Entries: {len(bank)}  levels: {dict(sorted(levels.items()))}")
    print(f"Unresolved Goethe items (not in Wiktionary, not curated): {len(unresolved)}")
    for k, v in sorted(stats.items()):
        print(f"  {k:28} {v}")
    with_ex = Counter(e['level'] for e in bank if e.get('example'))
    print(f"With examples: {dict(sorted(with_ex.items()))}")
    if not args.dry_run:
        save_bank(bank, args.bank)
        print(f"Saved {args.bank}")


if __name__ == '__main__':
    main()
