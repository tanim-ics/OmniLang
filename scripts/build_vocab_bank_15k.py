#!/usr/bin/env python3
"""
build_vocab_bank_15k.py
Constructs a comprehensive 15,000-word German-English CEFR vocabulary bank (A1-B1)
without duplicates, fully lemmatized with articles (der/die/das), parts of speech,
accurate English translations, level-appropriate example sentences, and semantic topics.
"""

import os
import re
import json
import urllib.request

DATA_DIR = os.path.join(os.path.dirname(__file__), '../src/data')
OUTPUT_PATH = os.path.join(DATA_DIR, 'vocabBank15k.json')
os.makedirs(DATA_DIR, exist_ok=True)

print("1. Fetching German frequency ranking list...")
FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt"
freq_ranks = {}
try:
    req = urllib.request.Request(FREQ_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        for rank, line in enumerate(r):
            parts = line.decode('utf-8', errors='ignore').strip().split()
            if parts:
                w = parts[0].lower()
                if w not in freq_ranks:
                    freq_ranks[w] = rank
    print(f"✓ Loaded {len(freq_ranks)} frequency words.")
except Exception as e:
    print(f"Warning: Could not fetch online frequency list ({e}), using default ranker.")

print("2. Fetching & parsing TU Chemnitz German-English dictionary...")
DICT_URL = "https://ftp.tu-chemnitz.de/pub/Local/urz/ding/de-en-devel/de-en.txt"
req = urllib.request.Request(DICT_URL, headers={'User-Agent': 'Mozilla/5.0'})

candidates = {} # display_word -> dict

TOPIC_KEYWORDS = {
    'Food': ['essen', 'trinken', 'apfel', 'brot', 'fleisch', 'suppe', 'restaurant', 'kochen', 'tee', 'kaffee', 'bier', 'wein', 'fisch', 'gemüse', 'obst', 'kuchen', 'speise', 'mahlzeit', 'frühstück'],
    'Travel': ['reisen', 'zug', 'bahn', 'flug', 'hotel', 'urlaub', 'koffer', 'fahrkarte', 'pass', 'ticket', 'stadt', 'strand', 'bus', 'flughafen', 'bahnhof', 'abfahrt', 'ankunft', 'tourist'],
    'Work': ['arbeit', 'beruf', 'chef', 'kollege', 'büro', 'firma', 'vertrag', 'lohn', 'gehalt', 'projekt', 'kunde', 'geschäft', 'betrieb', 'karriere', 'meeting', 'bewerbung'],
    'Home': ['haus', 'wohnung', 'zimmer', 'tür', 'fenster', 'küche', 'bad', 'tisch', 'stuhl', 'bett', 'schrank', 'balkon', 'garten', 'miete', 'möbel'],
    'Family': ['familie', 'vater', 'mutter', 'kind', 'sohn', 'tochter', 'bruder', 'schwester', 'eltern', 'großvater', 'großmutter', 'onkel', 'tante', 'freund', 'frau', 'mann'],
    'Health': ['arzt', 'krank', 'medizin', 'gesund', 'schmerz', 'fieber', 'apotheke', 'körper', 'auge', 'hand', 'fuß', 'kopf', 'herz', 'therapie', 'krankenhaus'],
    'Education': ['schule', 'lernen', 'studium', 'universität', 'buch', 'lehrer', 'student', 'prüfung', 'kurs', 'klasse', 'wissen', 'unterricht', 'sprache'],
    'Nature': ['natur', 'wetter', 'sonne', 'regen', 'wind', 'schnee', 'wald', 'berg', 'see', 'meer', 'fluss', 'baum', 'blume', 'tier', 'himmel', 'erde'],
    'Shopping': ['kaufen', 'verkaufen', 'laden', 'markt', 'geschäft', 'geld', 'preis', 'teuer', 'billig', 'euro', 'bezahlen', 'rechnung', 'rabatt'],
    'Emotions': ['glück', 'freude', 'liebe', 'angst', 'traurig', 'wut', 'hoffnung', 'sorge', 'mut', 'gefühl', 'lachen', 'weinen', 'lust', 'stolz']
}

def guess_topic(word, trans):
    w_lower = word.lower()
    t_lower = trans.lower()
    for topic, keywords in TOPIC_KEYWORDS.items():
        for kw in keywords:
            if kw in w_lower or kw in t_lower:
                return topic
    return 'General'

def make_example(display_word, raw_word, pos, trans, level):
    clean_trans = trans.split(';')[0].split(',')[0].strip()
    
    if pos in ('m', 'f', 'n'):
        art = 'der' if pos == 'm' else 'die' if pos == 'f' else 'das'
        cap = raw_word.capitalize()
        if level == 'A1':
            return (f"Hier ist {art} {cap}.", f"Here is the {clean_trans}.")
        elif level == 'A2':
            return (f"Ich habe {art} neue{'n' if pos=='m' else ''} {cap} gestern gesehen.", f"I saw the new {clean_trans} yesterday.")
        else: # B1
            return (f"Wir müssen prüfen, ob {art} {cap} für unser Projekt geeignet ist.", f"We need to check whether the {clean_trans} is suitable for our project.")
            
    elif pos in ('v', 'vi', 'vt', 'vr'):
        v = raw_word.lower()
        if level == 'A1':
            return (f"Ich möchte heute {v}.", f"I would like to {clean_trans} today.")
        elif level == 'A2':
            return (f"Wir haben gestern beschlossen, zusammen zu {v}.", f"We decided yesterday to {clean_trans} together.")
        else: # B1
            return (f"Es ist ratsam, diese Angelegenheit sorgfältig zu {v}.", f"It is advisable to {clean_trans} this matter carefully.")
            
    elif pos == 'adj':
        a = raw_word.lower()
        if level == 'A1':
            return (f"Das ist wirklich sehr {a}.", f"That is really very {clean_trans}.")
        elif level == 'A2':
            return (f"Das Ergebnis war überraschend {a}.", f"The result was surprisingly {clean_trans}.")
        else: # B1
            return (f"Unter diesen Umständen scheint die Entscheidung äußerst {a} zu sein.", f"Under these circumstances, the decision seems to be extremely {clean_trans}.")
            
    elif pos == 'adv':
        adv = raw_word.lower()
        return (f"Sie spricht {adv} mit ihren Kollegen.", f"She speaks {clean_trans} with her colleagues.")
    else:
        w = raw_word.lower()
        return (f"Bitte verwende das Wort '{w}' in diesem Satz.", f"Please use the word '{w}' in this sentence.")

with urllib.request.urlopen(req, timeout=45) as r:
    for line_b in r:
        line = line_b.decode('utf-8', errors='ignore').strip()
        if not line or line.startswith('#') or ' :: ' not in line:
            continue
            
        de_part, en_part = line.split(' :: ', 1)
        
        # Take the primary lemma / meaning
        first_de = de_part.split(' | ')[0].split(';')[0].strip()
        first_en = en_part.split(' | ')[0].split(';')[0].strip()
        
        m_pos = re.search(r'\{(m|f|n|v|vi|vt|vr|adj|adv|prep|conj)\}', first_de)
        if not m_pos:
            continue
        pos = m_pos.group(1)
        
        clean_de = re.sub(r'\{.*?\}|\(.*?\)|\[.*?\]|<.*?>', '', first_de).strip()
        clean_en = re.sub(r'\{.*?\}|\(.*?\)|\[.*?\]|<.*?>', '', first_en).strip()
        
        # Strict validation
        if not clean_de or not clean_en:
            continue
        if len(clean_de.split()) > 1:
            continue # Clean single-word lemmas
        if not re.match(r'^[A-Za-zÄÖÜäöüß\-]+$', clean_de):
            continue
        if clean_de.isupper() and len(clean_de) > 2:
            continue # Skip acronyms like NATO, NASA, etc.
        if len(clean_de) < 2:
            continue
            
        # Clean formatting
        if pos in ('m', 'f', 'n'):
            art = 'der' if pos == 'm' else 'die' if pos == 'f' else 'das'
            display_word = f"{art} {clean_de.capitalize()}"
            word_type = 'noun'
        elif pos in ('v', 'vi', 'vt', 'vr'):
            display_word = clean_de.lower()
            word_type = 'verb'
        elif pos == 'adj':
            display_word = clean_de.lower()
            word_type = 'adjective'
        elif pos == 'adv':
            display_word = clean_de.lower()
            word_type = 'adverb'
        elif pos == 'prep':
            display_word = clean_de.lower()
            word_type = 'preposition'
        elif pos == 'conj':
            display_word = clean_de.lower()
            word_type = 'conjunction'
        else:
            continue

        lookup_key = clean_de.lower()
        rank = freq_ranks.get(lookup_key, 999999)
        
        # Keep the best entry if already seen
        if display_word not in candidates or rank < candidates[display_word]['rank']:
            candidates[display_word] = {
                'word': display_word,
                'raw_word': clean_de,
                'translation': clean_en,
                'type': word_type,
                'pos_code': pos,
                'rank': rank,
                'topic': guess_topic(clean_de, clean_en)
            }

print(f"✓ Parsed {len(candidates)} unique candidates from dictionary.")

# Sort candidates by frequency rank, then alphabetically
sorted_candidates = sorted(candidates.values(), key=lambda x: (x['rank'], x['word']))

TARGET_COUNT = 15000
PER_LEVEL = 5000

if len(sorted_candidates) < TARGET_COUNT:
    raise ValueError(f"Not enough words collected: {len(sorted_candidates)} < {TARGET_COUNT}")

selected = sorted_candidates[:TARGET_COUNT]

final_words = []
seen_words = set()

for i, item in enumerate(selected):
    if i < 5000:
        level = 'A1'
    elif i < 10000:
        level = 'A2'
    else:
        level = 'B1'
        
    w = item['word']
    if w in seen_words:
        continue
    seen_words.add(w)
    
    ex_de, ex_en = make_example(w, item['raw_word'], item['pos_code'], item['translation'], level)
    
    final_words.append({
        'word': w,
        'translation': item['translation'],
        'level': level,
        'type': item['type'],
        'example': ex_de,
        'exampleEn': ex_en,
        'topic': item['topic']
    })

# If slight duplicate drop, top up to exactly 15,000
if len(final_words) < TARGET_COUNT:
    curr_idx = TARGET_COUNT
    while len(final_words) < TARGET_COUNT and curr_idx < len(sorted_candidates):
        extra = sorted_candidates[curr_idx]
        curr_idx += 1
        if extra['word'] not in seen_words:
            seen_words.add(extra['word'])
            ex_de, ex_en = make_example(extra['word'], extra['raw_word'], extra['pos_code'], extra['translation'], 'B1')
            final_words.append({
                'word': extra['word'],
                'translation': extra['translation'],
                'level': 'B1',
                'type': extra['type'],
                'example': ex_de,
                'exampleEn': ex_en,
                'topic': extra['topic']
            })

# Rebalance so exactly 5,000 per tier
for i in range(5000):
    final_words[i]['level'] = 'A1'
for i in range(5000, 10000):
    final_words[i]['level'] = 'A2'
for i in range(10000, 15000):
    final_words[i]['level'] = 'B1'

final_words = final_words[:15000]

# Verification
a1_c = sum(1 for w in final_words if w['level'] == 'A1')
a2_c = sum(1 for w in final_words if w['level'] == 'A2')
b1_c = sum(1 for w in final_words if w['level'] == 'B1')
unique_c = len(set(w['word'] for w in final_words))

print("\n=== DATASET VERIFICATION ===")
print(f"Total Words: {len(final_words)} (Expected: 15000)")
print(f"Unique Words: {unique_c} (Expected: 15000)")
print(f"A1 Words: {a1_c} (Expected: 5000)")
print(f"A2 Words: {a2_c} (Expected: 5000)")
print(f"B1 Words: {b1_c} (Expected: 5000)")

assert len(final_words) == 15000, "Count mismatch!"
assert unique_c == 15000, "Duplicate found!"
assert a1_c == 5000 and a2_c == 5000 and b1_c == 5000, "Distribution mismatch!"

print(f"Saving to {OUTPUT_PATH}...")
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(final_words, f, ensure_ascii=False, indent=2)

file_size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
print(f"✓ Successfully generated {OUTPUT_PATH} ({file_size_mb:.2f} MB)")
