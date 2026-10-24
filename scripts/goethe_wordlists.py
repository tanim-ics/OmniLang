#!/usr/bin/env python3
"""
goethe_wordlists.py
Extracts headwords from the official Goethe-Institut word lists (A1 Start Deutsch 1,
A1 Fit in Deutsch 1, Goethe-Zertifikat A2 and B1) into .cache/vocab-bank/goethe/levels.json:

  {"A1": [{"lemma": "Adresse", "article": "die", "plural": "-n", "raw": "die Adresse, -n"}, ...], ...}

The PDFs are copyrighted and are NOT committed: they are downloaded into the git-ignored
cache, and only the CEFR level each word receives ends up in src/data/vocabBank15k.json.

Requires pypdf (pure Python). Run with the cache virtualenv:
  python3 -m venv .cache/vocab-bank/venv && .cache/vocab-bank/venv/bin/pip install pypdf
  .cache/vocab-bank/venv/bin/python scripts/goethe_wordlists.py [--show A2]
"""

import os
import re
import sys
import json
import argparse
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GOETHE_DIR = os.path.join(ROOT, '.cache/vocab-bank/goethe')
OUT_PATH = os.path.join(GOETHE_DIR, 'levels.json')

LISTS = [
    ('A1', 'https://www.goethe.de/pro/relaunch/prf/ca/A1_SD1_Wortliste_02.pdf'),
    ('A1', 'https://www.goethe.de/pro/relaunch/prf/sw/Goethe-Zertifikat_A1_Fit1_Wortliste.pdf'),
    ('A2', 'https://www.goethe.de/pro/relaunch/prf/en/Goethe-Zertifikat_A2_Wortliste.pdf'),
    ('B1', 'https://www.goethe.de/pro/relaunch/prf/da/Goethe-Zertifikat_B1_Wortliste.pdf'),
]

GAP_RE = re.compile(r'\S(?:.*?\S)?(?=\s{3,}|$)')
NOUN_RE = re.compile(
    r'^(?P<art>der|die|das|r|e|s)(?:/(?:der|die|das|r|e|s))*\s+(?P<lemma>[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]*)'
    r'(?:\s*,\s*(?P<plural>(?:[äöü],\s*)?(?:-?¨?-?[a-zäöüß]*|–|-|[A-ZÄÖÜ][a-zäöüß]+)))?')
# Fit in Deutsch 1 abbreviates the articles
SHORT_ARTICLES = {'r': 'der', 'e': 'die', 's': 'das'}
BARE_NOUN_RE = re.compile(r'^(?P<lemma>[A-ZÄÖÜ][a-zäöüß][A-Za-zÄÖÜäöüß-]*)(?:\s*,\s*(?P<plural>-?¨?-?[a-zäöüß]*|–|-))?')
WORD_RE = re.compile(r'^(?P<lemma>[a-zäöüß][a-zäöüß-]*(?: [a-zäöüß][a-zäöüß-]*)?)(?P<sich> \(sich\))?')
FORM_LINE_RE = re.compile(r'^(hat|ist|hatte|war|wurde|habe|bin|er|sie|es)\s|^[a-zäöüß]+t\s+\w+,$|^[a-zäöüß]+t,$')
# Section headings of the word-group pages, not vocabulary entries
HEADINGS = set('''inhalt vorwort themen wortgruppen wortgruppenliste anglizismen anweisungssprache alphabetischer
alphabetische grammatik zeitmaße wochentage tageszeiten monatsnamen ländernamen himmelsrichtungen nationalitäten
familienmitglieder familienstand feiertage maße schulen schulfächer zeitangaben währungen jahreszeiten farben
länder berufe abkürzungen zahlen wortliste uhrzeit monat'''.split())
PREFIX_STEMS = {'dein-': 'dein', 'mein-': 'mein', 'unser-': 'unser', 'euer-': 'euer', 'ihr-': 'ihr',
                'sein-': 'sein', 'ein-': 'ein', 'kein-': 'kein', 'lieb-': 'lieb', 'Feier-': 'Feiertag',
                'Lieblings-': 'Lieblings-'}
STEM_FIXES = {'all-': 'alle', 'ander-': 'andere', 'manch-': 'manche', 'dies-': 'dieser', 'jed-': 'jeder',
              'welch-': 'welcher', 'beid-': 'beide', 'einig-': 'einige', 'mehrer-': 'mehrere'}


def download():
    os.makedirs(GOETHE_DIR, exist_ok=True)
    paths = []
    for level, url in LISTS:
        path = os.path.join(GOETHE_DIR, os.path.basename(url))
        if not os.path.exists(path):
            print(f"Downloading {url}")
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
                f.write(r.read())
        paths.append((level, path))
    return paths


def page_lines(path):
    import logging
    import pypdf
    logging.getLogger('pypdf').setLevel(logging.ERROR)  # "Rotated text discovered" on page headers
    reader = pypdf.PdfReader(path)
    for page in reader.pages:
        yield page.extract_text(extraction_mode='layout').split('\n')


def segments(line):
    """[(start_column, text)] for runs separated by 3+ spaces."""
    return [(m.start(), m.group(0)) for m in GAP_RE.finditer(line)]


def looks_like_headword(text):
    t = text.strip()
    if not t or len(t) > 45 or t[-1] in '.?!:' or t.isdigit():
        return False
    return bool(NOUN_RE.match(t) or WORD_RE.match(t) or BARE_NOUN_RE.match(t))


def headword_columns(lines):
    """Start columns where headword-like segments cluster on this page (one per text column)."""
    starts, good = Counter(), Counter()
    for line in lines:
        for col, text in segments(line):
            key = col // 3
            starts[key] += 1
            good[key] += looks_like_headword(text)
    cols = [k for k, n in starts.items() if n >= 6 and good[k] / n >= 0.6]
    # merge neighbouring buckets
    merged = []
    for k in sorted(cols):
        if merged and k - merged[-1] <= 2:
            continue
        merged.append(k)
    return merged


def parse_headword(text):
    t = re.sub(r'\s+', ' ', text.strip())
    t = re.sub(r'\((?:Sg|Pl)\.\)', '', t).strip()
    items = []
    for part in re.split(r'\s*[/;]\s*(?=(?:der |die |das )?[A-ZÄÖÜa-zäöüß])', t):
        part = part.strip()
        m = NOUN_RE.match(part)
        if m:
            art = SHORT_ARTICLES.get(m.group('art'), m.group('art'))
            items.append({'lemma': m.group('lemma'), 'article': art, 'plural': m.group('plural') or ''})
            continue
        m = BARE_NOUN_RE.match(part)
        if m and not part.isupper():
            items.append({'lemma': m.group('lemma'), 'article': None, 'plural': m.group('plural') or ''})
            continue
        stem = part.split(',')[0].split(' (')[0].strip()
        if stem in STEM_FIXES:
            items.append({'lemma': STEM_FIXES[stem], 'article': None, 'plural': ''})
            continue
        m = WORD_RE.match(part)
        if m:
            items.append({'lemma': m.group('lemma'), 'article': None, 'plural': '',
                          'reflexive': bool(m.group('sich'))})
    clean = []
    for it in items:
        lemma = it['lemma']
        if lemma.endswith('-'):
            lemma = PREFIX_STEMS.get(lemma, lemma[:-1] + 'e')  # "letzt-" -> "letzte"
        if len(lemma) < 2 or lemma.lower() in HEADINGS or lemma.endswith('-'):
            continue
        it['lemma'] = lemma
        it['raw'] = t
        clean.append(it)
    return clean


def extract(path):
    entries = []
    started = False
    for lines in page_lines(path):
        if not started:
            # skip the introduction: start at the first page with word groups or the alphabetical list
            text = '\n'.join(lines)
            if not re.search(r'WORTGRUPPEN|Wortgruppen|ALPHABETISCHE|Alphabetische', text) \
                    or re.search(r'\bInhalt\b|INHALT|Vorwort|VORWORT', text):
                continue
            started = True
        cols = headword_columns(lines)
        if not cols:
            continue
        pending_forms = {}  # column -> True while a verb entry's forms continue ("gibt ab," / "hat abgegeben")
        pending_join = {}   # column -> "der Anruf-" waiting for its second line ("beantworter")
        for line in lines:
            for col, text in segments(line):
                key = col // 3
                if not any(abs(key - c) <= 2 for c in cols):
                    continue
                c = min(cols, key=lambda c: abs(key - c))
                text = text.strip()
                if c in pending_join:
                    head = pending_join.pop(c)
                    if re.match(r'[a-zäöüß]', text):
                        text = head[:-1] + text
                    else:
                        entries.extend(parse_headword(head))
                if pending_forms.get(c):
                    pending_forms[c] = text.endswith(',')
                    continue
                if FORM_LINE_RE.match(text) or not looks_like_headword(text):
                    continue
                if re.fullmatch(r'[A-ZÄÖÜ]', text) or text.isupper():
                    continue  # letter headings, section titles
                if re.search(r'[A-Za-zäöüß]-$', text) and (NOUN_RE.match(text) or text[:1].isupper()):
                    pending_join[c] = text  # hyphenated compound split over two lines
                    continue
                entries.extend(parse_headword(text))
                pending_forms[c] = text.endswith(',') and not NOUN_RE.match(text)
    return entries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', help='print the extracted entries of one level')
    args = ap.parse_args()

    by_level = defaultdict(dict)
    for level, path in download():
        found = extract(path)
        print(f"{os.path.basename(path)}: {len(found)} headwords")
        for e in found:
            key = (e['lemma'], e.get('article'))
            by_level[level].setdefault(key, e)

    # A word belongs to the lowest level that lists it
    seen = set()
    out = {}
    for level in ('A1', 'A2', 'B1'):
        out[level] = []
        for key, e in by_level[level].items():
            norm = key[0].lower()
            if norm in seen:
                continue
            seen.add(norm)
            out[level].append(e)
        print(f"{level}: {len(out[level])} new headwords")
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"Saved {OUT_PATH}")
    if args.show:
        print(' | '.join(f"{e.get('article') or ''} {e['lemma']}".strip() for e in out[args.show]))


if __name__ == '__main__':
    main()
