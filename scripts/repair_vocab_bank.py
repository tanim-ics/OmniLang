#!/usr/bin/env python3
"""
repair_vocab_bank.py
Repairs src/data/vocabBank15k.json in place.

Stages (run in order, all by default):
  1. curated   - hand-written glosses/examples for function words and the most
                 frequent entries (scripts/vocab_bank_curated.tsv), plus
                 additions for pronouns, articles, prepositions and numbers.
  2. prune     - removes nominalisations whose frequency rank was borrowed from a
                 function word or verb ("das Ich", "das Aber", "das Gehen"), proper
                 names glossed as themselves ("die Oder") and rare-sense duplicates.
  3. glosses   - for every other entry, collects candidate glosses from the TU
                 Chemnitz dictionary and asks the local Ollama model (temperature 0,
                 JSON schema) for the most common everyday meaning. Answers must
                 be well-formed; for the rare tail (rank >= 10000) they must also
                 match a dictionary candidate unless the current gloss is suspicious.
  4. examples  - replaces the generated template sentences ("Hier ist das Ich.")
                 with authentic dictionary examples that contain the headword, or
                 with LLM-written sentences (validated to contain the headword) for
                 the most frequent entries. Template sentences that cannot be
                 replaced are dropped - the UI hides empty examples.

Article+noun pairs ("das Haus") are never rewritten: genders come from the
dictionary and src/routes/reading.js relies on them.

LLM answers are cached in .cache/vocab-bank/, so re-runs are cheap and the
example stage can be resumed with a larger --examples-limit later.

Usage:
  python3 scripts/repair_vocab_bank.py [--stages curated,prune,glosses,examples]
                                       [--examples-limit 3000] [--dry-run]
"""

import os
import re
import sys
import json
import math
import time
import argparse
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from vocab_bank_lib import (BANK_PATH, CACHE_DIR, ARTICLES, FUNCTION_WORDS, LEGIT_HOMOGRAPH_NOUNS,
                            MARKUP_RE, TEMPLATE_RE, load_bank, save_bank, load_freq, build_index,
                            split_headword, english_rank, headword_forms, example_has_headword,
                            build_sentence_index)

CURATED_PATH = os.path.join(os.path.dirname(__file__), 'vocab_bank_curated.tsv')
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434') + '/api/chat'
MODEL = os.environ.get('OLLAMA_MODEL', 'mistral-nemo:12b')

stats = Counter()


# ---------------------------------------------------------------------------
# Ollama helpers
# ---------------------------------------------------------------------------

def ollama_json(system, user, schema, num_predict=1024):
    body = {
        'model': MODEL,
        'stream': False,
        'format': schema,
        'options': {'temperature': 0, 'num_ctx': 4096, 'num_predict': num_predict},
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
    }
    req = urllib.request.Request(OLLAMA_URL, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=600) as r:
        resp = json.load(r)
    return json.loads(resp['message']['content'])


class Cache:
    def __init__(self, name):
        self.path = os.path.join(CACHE_DIR, name)
        self.data = {}
        if os.path.exists(self.path):
            with open(self.path, encoding='utf-8') as f:
                self.data = json.load(f)

    def save(self):
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False)
        os.replace(tmp, self.path)


# ---------------------------------------------------------------------------
# Stage 1: curated entries
# ---------------------------------------------------------------------------

def load_curated(path=CURATED_PATH):
    entries, removals = {}, []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('- '):
                removals.append(line[2:].strip())
                continue
            cols = [c.strip() for c in line.split(' | ')]
            word, wtype, translation, example, example_en = cols[:5]
            entries[word] = {'type': wtype, 'translation': translation, 'example': example,
                             'exampleEn': example_en, 'level': cols[5] if len(cols) > 5 else None}
    return entries, removals


def stage_curated(bank):
    entries, removals = load_curated()
    by_word = {e['word']: e for e in bank}
    for word, fields in entries.items():
        level = fields.pop('level')
        if word in by_word:
            by_word[word].update(fields)
            if level:
                by_word[word]['level'] = level
            stats['curated_fixed'] += 1
        else:
            entry = {'word': word, 'translation': '', 'level': level or 'A1', 'type': fields['type'],
                     'example': '', 'exampleEn': '', 'topic': 'General'}
            entry.update(fields)
            entry['_added'] = True
            bank.append(entry)
            by_word[word] = entry
            stats['curated_added'] += 1
        by_word[word]['_curated'] = True
    removed = set(removals)
    before = len(bank)
    bank[:] = [e for e in bank if e['word'] not in removed]
    stats['curated_removed'] += before - len(bank)
    return bank


# ---------------------------------------------------------------------------
# Stage 2: prune nominalisations, proper names and rare duplicates
# ---------------------------------------------------------------------------

# Glossed as themselves but ordinary German nouns, not place or person names
COMMON_CAPITALISED = set('''Delta Copyright Renaissance Index Islam Mafia Derby Imam Hindu Buddhist Parmesan
Beagle Rottweiler Hindi Orient Koran Talmud Reichstag Berliner Albino Gouda Brie Chardonnay Beaujolais
Roquefort Sherpa Tory Junker Ebola Heparin Gulag Chihuahua Nemesis Eldorado Gestapo Bingo
Lady Madame April August September November England China Halloween T-shirt Darling Satan Passion Mars
Alpha Internet'''.split())


def prune_reason(entry, rank, en_freq, verbs, non_nouns, best_gloss_rank):
    art, lemma = split_headword(entry['word'])
    if not art or entry.get('_curated') or entry['word'] in LEGIT_HOMOGRAPH_NOUNS:
        return None
    low = lemma.lower()
    gloss = entry['translation']
    er = english_rank(gloss, en_freq)
    if low in FUNCTION_WORDS:
        return 'function_word_noun'
    if art == 'das' and low.endswith(('en', 'ern', 'eln')) and low in verbs:
        # Transparent nominalised infinitive ("das Gehen" = walking): the verb entry covers it.
        # Lexicalised ones with a plain noun gloss ("das Lächeln" = smile) stay.
        if gloss.endswith('ing') or er > 15000:
            return 'nominalised_infinitive'
    if gloss[:1].isupper() and gloss.lower() == low and lemma not in COMMON_CAPITALISED:
        return 'proper_name'
    if low in non_nouns and er > 20000:
        return 'rare_homograph_noun'
    if best_gloss_rank.get(lemma, (None, 0))[0] not in (None, entry['word']) and er > 12000:
        return 'rare_gender_duplicate'
    return None


def stage_prune(bank, en_freq):
    verbs = {e['word'] for e in bank if e['type'] == 'verb'}
    non_nouns = {e['word'] for e in bank if e['type'] != 'noun'}
    # For lemmas listed with several genders, remember the one with the most common gloss
    best = {}
    for e in bank:
        art, lemma = split_headword(e['word'])
        if art:
            er = english_rank(e['translation'], en_freq)
            if lemma not in best or er < best[lemma][1]:
                best[lemma] = (e['word'], er)
    kept, removed = [], []
    for i, e in enumerate(bank):
        reason = prune_reason(e, i, en_freq, verbs, non_nouns, best)
        if reason:
            removed.append((e['word'], e['translation'], reason))
            stats['pruned_' + reason] += 1
        else:
            kept.append(e)
    bank[:] = kept
    return removed


# ---------------------------------------------------------------------------
# Stage 3: glosses
# ---------------------------------------------------------------------------

def valid_gloss(g, wtype):
    if not g or len(g) > 32 or MARKUP_RE.search(g) or len(g.split()) > 4:
        return False
    if re.search(r'[^A-Za-z \'\-,.éè]', g):
        return False
    if wtype == 'verb':
        return g.startswith('to ')
    return not g.startswith('to ') or wtype == 'preposition'


def gloss_candidates(entry, senses, en_freq):
    art, lemma = split_headword(entry['word'])
    t = entry['type']
    scored = {}
    for s in senses:
        if art:
            if s.pos != 'noun' or s.tag != ARTICLES[art]:
                continue
        elif t == 'verb':
            if s.pos != 'verb':
                continue
        elif s.pos in ('noun', 'verb'):
            continue
        for gi, g in enumerate(s.glosses):
            g = re.sub(r'^(a|an|the) ', '', g) if art else g
            if not valid_gloss(g, t):
                continue
            score = math.log10(english_rank(g, en_freq) + 10)
            score += 1.5 * s.qualified + 0.4 * min(s.syn_index, 3) + 0.3 * min(gi, 3)
            score += 0.4 * (s.subentries == 1) + 0.4 * (len(g.split()) - 1 - (t == 'verb'))
            if t == 'adverb' and s.pos == 'adverb' and g.endswith('ly'):
                score += 0.3
            key = g.lower()
            if key not in scored or score < scored[key][0]:
                scored[key] = (score, g, s.pos)
    return [(g, pos) for _, g, pos in sorted(scored.values())][:6]


GLOSS_SYSTEM = """You are an expert German-English lexicographer writing a learner dictionary (CEFR A1-B1).
For each German headword give its most common everyday English translation, as a learner would expect it:
1-2 short glosses separated by ", " (2 only if the word has two equally common, different meanings,
e.g. "die Bank" -> "bank, bench"). Verbs start with "to ". Nouns without article. Dictionary hints are
given, but they may list rare, archaic or technical senses first - ignore those.
Answer with a JSON object mapping each item number to its gloss."""


def keyed_schema(n):
    """{"1": str, "2": str, ...} keeps answers aligned with the batch and output short."""
    keys = [str(i + 1) for i in range(n)]
    return keys, {'type': 'object', 'properties': {k: {'type': 'string'} for k in keys}, 'required': keys}


def needs_llm_gloss(e, rank, flags_current):
    """Frequent words, all non-nouns and anything with a suspicious gloss get an LLM review."""
    return rank < 6000 or e['type'] != 'noun' or flags_current


def spelling_variants(a, b):
    """honor/honour, color/colour, realize/realise, center/centre."""
    a, b = a.lower(), b.lower()
    if a == b:
        return True
    for x, y in (('or', 'our'), ('ize', 'ise'), ('er', 're'), ('og', 'ogue'), ('yze', 'yse')):
        if a.replace(y, x) == b.replace(y, x):
            return True
    return False


def accept_gloss(proposal, e, cands, current_ok, rank):
    """
    Validate an LLM gloss. Each comma-separated part must be a well-formed gloss and not just the
    untranslated headword. Frequent words (rank < 10000) take the model's answer; for the rare tail,
    where a 12B model is more likely to guess, the answer must match a dictionary candidate unless
    the current gloss is itself suspicious.
    """
    _, lemma = split_headword(e['word'])
    proposal = re.sub(r'^.*->\s*', '', proposal).strip().strip('"\'')
    parts = [p.strip().strip('"\'') for p in proposal.split(',') if p.strip()][:2]
    if len(parts) == 2 and spelling_variants(*parts):
        parts = parts[1:] if parts[1].endswith('our') or 'ise' in parts[1] else parts[:1]
    if not parts or not all(valid_gloss(p, e['type']) for p in parts):
        return None
    if any(p.lower() == lemma.lower() for p in parts) and not lemma[:1].isupper():
        return None
    if rank < 10000 or not current_ok:
        return ', '.join(parts)
    known = {c.lower() for c, _ in cands} | {c.strip().lower() for c in e['translation'].split(',')}
    known_heads = {re.sub(r'^to ', '', k).split()[0] for k in known if k}
    for p in parts:
        low = p.lower()
        if low in known or re.sub(r'^to ', '', low).split()[0] in known_heads:
            return ', '.join(parts)
    return None


def stage_glosses(bank, index, en_freq, batch_size=20, limit=None):
    cache = Cache('llm-glosses.json')
    todo = []
    for rank, e in enumerate(bank):
        if e.get('_curated'):
            continue
        _, lemma = split_headword(e['word'])
        cands = gloss_candidates(e, index.get(lemma, []), en_freq)
        current = e['translation']
        current_ok = (valid_gloss(current.split(',')[0].strip(), e['type'])
                      and english_rank(current, en_freq) < (8000 if rank < 3000 else 20000))
        if not cands and current_ok:
            continue
        if needs_llm_gloss(e, rank, not current_ok):
            todo.append((rank, e, cands, current_ok))
        elif not current_ok and cands:
            e['translation'] = cands[0][0]
            stats['gloss_fixed_heuristic'] += 1
    print(f"  {len(todo)} entries qualify for LLM review")
    if limit is not None:
        todo = todo[:limit]

    pending = [t for t in todo if cache_key(t[1]) not in cache.data]
    print(f"  gloss review: {len(todo)} entries, {len(pending)} not cached")
    t0 = time.time()
    for b in range(0, len(pending), batch_size):
        batch = pending[b:b + batch_size]
        lines = []
        for i, (_, e, cands, _) in enumerate(batch):
            hints = '; '.join(g for g, _ in cands) or '-'
            lines.append(f"{i + 1}. {e['word']} ({e['type']}) hints: {hints}")
        keys, schema = keyed_schema(len(batch))
        try:
            out = ollama_json(GLOSS_SYSTEM, '\n'.join(lines), schema, num_predict=16 * len(batch) + 160)
        except Exception as err:
            print(f"  ! batch {b} failed: {err}")
            continue
        for k, (_, e, _, _) in zip(keys, batch):
            if isinstance(out.get(k), str):
                cache.data[cache_key(e)] = out[k].strip()
        cache.save()
        done = b + len(batch)
        rate = (time.time() - t0) / done
        print(f"  {done}/{len(pending)}  ({rate:.2f}s/entry, ~{rate * (len(pending) - done) / 60:.0f} min left)", flush=True)

    for rank, e, cands, current_ok in todo:
        proposal = cache.data.get(cache_key(e))
        new = accept_gloss(proposal, e, cands, current_ok, rank) if proposal else None
        if not new:
            if proposal:
                stats['gloss_llm_rejected'] += 1
            if current_ok or not cands:
                continue
            new = cands[0][0]
            stats['gloss_fixed_heuristic'] += 1
        if new.lower() != e['translation'].lower():
            e['translation'] = new
            stats['gloss_changed_llm'] += 1
        pos = dict(cands).get(new.split(',')[0])
        if e['type'] in ('adverb', 'adjective') and pos in ('adverb', 'adjective') and pos != e['type']:
            e['type'] = pos
            stats['type_changed'] += 1


def cache_key(e):
    return e['word'] + '\t' + e['type']


# ---------------------------------------------------------------------------
# Stage 4: examples
# ---------------------------------------------------------------------------

EXAMPLE_SYSTEM = """You write example sentences for a German learner dictionary.
For each headword write ONE short, natural, grammatically correct German sentence (5-10 words) that a native
speaker would really say in everyday life, at the given CEFR level, using the headword in the given meaning.
Vary the subjects and situations - do not reuse the same objects. Nouns must appear with their correct gender.
Also give a natural English translation. Answer with a JSON object mapping each item number to {"de", "en"}."""

# Cheap agreement checks for model output: "eine hübsches Kleid", "ein kleine Haus", "einen schöne Tag"
AGREEMENT_ERRORS = re.compile(r'\b(eine \w+(es|er)|ein \w+e|einen \w+(e|es|er)|einem \w+(e|es|er)) [A-ZÄÖÜ]')


def good_example(de, en, entry, forms):
    if not de or not en or MARKUP_RE.search(de + en) or AGREEMENT_ERRORS.search(de):
        return False
    words = de.split()
    if not (3 <= len(words) <= 16) or de[-1:] not in '.!?' or en[-1:] not in '.!?"':
        return False
    return example_has_headword(de, entry, forms)


def gloss_words(entry):
    return set(re.findall(r'[a-z]+', entry['translation'].lower())) - {'to', 'a', 'an', 'the', 'be', 'of', 'sth'}


def dictionary_example(entry, senses, forms):
    """Best authentic dictionary sentence containing the headword: (de, en, same_sense) or None."""
    gw = gloss_words(entry)
    best = None
    for s in senses:
        for de, en in s.examples:
            if not good_example(de, en, entry, forms):
                continue
            same_sense = bool(gw & set(re.findall(r'[a-z]+', en.lower())))
            score = (not same_sense, len(de))
            if best is None or score < best[0]:
                best = (score, de, en, same_sense)
    return best[1:] if best else None


def corpus_example(entry, forms, sentences):
    """Shortest dictionary-wide sentence with a headword form whose translation uses the gloss."""
    gw = gloss_words(entry)
    if not gw:
        return None
    best = None
    for form in forms:
        for de, en in sentences.get(form.split()[0], ()):
            if (best is None or len(de) < len(best[0])) and gw & set(re.findall(r'[a-z]+', en.lower())) \
                    and good_example(de, en, entry, forms):
                best = (de, en, True)
    return best


def stage_examples(bank, index, limit, batch_size=8):
    cache = Cache('llm-examples.json')
    sentences = build_sentence_index()
    need_llm = []
    for e in bank:
        if e.get('_curated') and e.get('example'):
            continue
        ex = e.get('example', '')
        _, lemma = split_headword(e['word'])
        senses = index.get(lemma, [])
        forms = headword_forms(e, senses)
        if ex and not TEMPLATE_RE.search(ex) and not MARKUP_RE.search(e.get('exampleEn', '')) \
                and example_has_headword(ex, e, forms):
            continue
        found = dictionary_example(e, senses, forms)
        if not (found and found[2]):
            found = corpus_example(e, forms, sentences) or found
        key = e['word'] + '\t' + e['translation']
        if found and found[2]:
            e['example'], e['exampleEn'] = found[0], found[1]
            stats['example_from_dictionary'] += 1
        elif len(need_llm) < limit or key in cache.data:
            need_llm.append((e, forms))
        else:
            # A sentence for another sense, or a template, would contradict the gloss: drop it
            e['example'], e['exampleEn'] = '', ''
            stats['example_dropped'] += 1

    pending = [x for x in need_llm if x[0]['word'] + '\t' + x[0]['translation'] not in cache.data]
    print(f"  LLM examples: {len(need_llm)} entries, {len(pending)} not cached")
    t0 = time.time()
    for b in range(0, len(pending), batch_size):
        batch = pending[b:b + batch_size]
        lines = [f"{i + 1}. {e['word']} ({e['type']}, meaning: {e['translation']}, level {e['level']})"
                 for i, (e, _) in enumerate(batch)]
        keys = [str(i + 1) for i in range(len(batch))]
        pair = {'type': 'object', 'properties': {'de': {'type': 'string'}, 'en': {'type': 'string'}},
                'required': ['de', 'en']}
        schema = {'type': 'object', 'properties': {k: pair for k in keys}, 'required': keys}
        try:
            out = ollama_json(EXAMPLE_SYSTEM, '\n'.join(lines), schema, num_predict=60 * len(batch) + 80)
        except Exception as err:
            print(f"  ! batch {b} failed: {err}")
            continue
        for k, (e, _) in zip(keys, batch):
            got = out.get(k)
            if isinstance(got, dict):
                cache.data[e['word'] + '\t' + e['translation']] = [str(got.get('de', '')).strip(),
                                                                    str(got.get('en', '')).strip()]
        cache.save()
        done = b + len(batch)
        rate = (time.time() - t0) / done
        print(f"  {done}/{len(pending)}  ({rate:.2f}s/entry, ~{rate * (len(pending) - done) / 60:.0f} min left)", flush=True)

    for e, forms in need_llm:
        got = cache.data.get(e['word'] + '\t' + e['translation'])
        if got and good_example(got[0], got[1], e, forms):
            e['example'], e['exampleEn'] = got
            stats['example_from_llm'] += 1
        else:
            if got:
                stats['example_llm_rejected'] += 1
            e['example'], e['exampleEn'] = '', ''
            stats['example_dropped'] += 1


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stages', default='curated,prune,glosses,examples')
    ap.add_argument('--bank', default=BANK_PATH)
    ap.add_argument('--out')
    ap.add_argument('--gloss-limit', type=int)
    ap.add_argument('--examples-limit', type=int, default=3000,
                    help='max entries (most frequent first) that get LLM-written examples')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    stages = args.stages.split(',')

    bank = load_bank(args.bank)
    original = {e['word']: dict(e) for e in bank}
    en_freq = load_freq('en_50k.txt')

    if 'curated' in stages:
        print('Stage 1: curated entries')
        stage_curated(bank)
    removed = []
    if 'prune' in stages:
        print('Stage 2: prune')
        removed = stage_prune(bank, en_freq)
    index = None
    if 'glosses' in stages or 'examples' in stages:
        print('Indexing dictionary senses ...')
        index = build_index({split_headword(e['word'])[1] for e in bank})
    if 'glosses' in stages:
        print('Stage 3: glosses')
        stage_glosses(bank, index, en_freq, limit=args.gloss_limit)
    if 'examples' in stages:
        print('Stage 4: examples')
        stage_examples(bank, index, args.examples_limit)

    # Curated additions sit at the front so they keep A1 ordering in the browser
    bank.sort(key=lambda e: 0 if e.get('_added') else 1)
    for e in bank:
        e.pop('_curated', None)
        e.pop('_added', None)
        e['translation'] = e['translation'].strip()

    changed = sum(1 for e in bank if e['word'] in original and
                  (original[e['word']]['translation'] != e['translation']))
    print('\n=== REPAIR SUMMARY ===')
    print(f"Entries before: {len(original)}  after: {len(bank)}")
    print(f"Glosses changed: {changed}")
    for k, v in sorted(stats.items()):
        print(f"  {k:32} {v}")
    print(f"Levels: {Counter(e['level'] for e in bank)}")
    assert len({e['word'] for e in bank}) == len(bank), 'duplicate headwords'

    if not args.dry_run:
        save_bank(bank, args.out or args.bank)
        log_path = os.path.join(CACHE_DIR, 'removed.json')
        with open(log_path, 'w', encoding='utf-8') as f:
            json.dump(removed, f, ensure_ascii=False, indent=1)
        print(f"Saved {args.out or args.bank}; removed entries logged to {log_path}")


if __name__ == '__main__':
    main()
