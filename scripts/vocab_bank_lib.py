#!/usr/bin/env python3
"""
vocab_bank_lib.py
Shared helpers for auditing and repairing src/data/vocabBank15k.json:
source downloads (TU Chemnitz dictionary, frequency lists), a sense index over
the dictionary, and the heuristics that flag suspicious bank entries.
"""

import os
import re
import json
import urllib.request
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BANK_PATH = os.path.join(ROOT, 'src/data/vocabBank15k.json')
CACHE_DIR = os.path.join(ROOT, '.cache/vocab-bank')

SOURCES = {
    'de-en.txt': 'https://ftp.tu-chemnitz.de/pub/Local/urz/ding/de-en-devel/de-en.txt',
    'de_50k.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt',
    'en_50k.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
}


def source_path(name):
    """Return a cached copy of a source file, downloading it on first use."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    if not os.path.exists(path):
        print(f"Downloading {SOURCES[name]} ...")
        req = urllib.request.Request(SOURCES[name], headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def load_bank(path=BANK_PATH):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_bank(words, path=BANK_PATH):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(words, f, ensure_ascii=False, indent=2)
        f.write('\n')


def load_freq(name):
    ranks = {}
    with open(source_path(name), encoding='utf-8', errors='ignore') as f:
        for rank, line in enumerate(f):
            parts = line.split()
            if parts and parts[0] not in ranks:
                ranks[parts[0]] = rank
    return ranks


# ---------------------------------------------------------------------------
# Headword helpers
# ---------------------------------------------------------------------------

ARTICLES = {'der': 'm', 'die': 'f', 'das': 'n'}


def split_headword(word):
    """'das Haus' -> ('das', 'Haus'); 'gehen' -> (None, 'gehen')."""
    parts = word.split(' ', 1)
    if len(parts) == 2 and parts[0] in ARTICLES:
        return parts[0], parts[1]
    return None, word


def pos_class(tag):
    if tag in ('m', 'f', 'n'):
        return 'noun'
    if tag.startswith('v'):
        return 'verb'
    if tag == 'adj':
        return 'adjective'
    if tag == 'adv':
        return 'adverb'
    if tag in ('prp', 'prep'):
        return 'preposition'
    if tag == 'conj':
        return 'conjunction'
    if tag in ('pron', 'ppron', 'art', 'num', 'interj', 'Partikel'):
        return 'word'
    return None


# ---------------------------------------------------------------------------
# English gloss cleanup
# ---------------------------------------------------------------------------

QUALIFIER_RE = re.compile(r'\[(archaic|obs\.|old|poet\.|rare|dated|Sc\.|Irish|Austr\.|NZ|slang|vulg\.|pej\.|humor\.|euphem\.|dial\.|fig\.|jur\.|adm\.|techn\.|chem\.|math\.|med\.|biol\.|bot\.|zool\.|mil\.|naut\.|aviat\.|relig\.|phil\.|psych\.|ling\.|comp\.|econ\.|fin\.|geol\.|phys\.|electr\.|mus\.|sport|cook\.|textil\.|mach\.|constr\.|agr\.|print|photo\.|statist\.|pol\.|soc\.|hist\.|lit\.|art|min\.|anat\.|astron\.|geogr\.|transp\.|auto|railw\.|envir\.|insur\.|ornith\.|ichth\.|entom\.|archit\.|telco\.|school|sociol\.|geh\.)\]')


def clean_gloss(text):
    """Strip dictionary markup from a single English gloss."""
    t = re.sub(r'\{.*?\}|\[.*?\]|<.*?>|/[^/ ]+/', '', text)
    t = re.sub(r'\([^)]*\)', '', t)
    t = re.sub(r'\b(sb\.|sth\.|sb\'s|sth\'s|oneself|one\'s)\s*', '', t)
    t = t.replace('…', '').replace('...', '')
    t = re.sub(r'\s+', ' ', t).strip(' ,;:-')
    return t


def clean_de(text):
    t = re.sub(r'\{.*?\}|\(.*?\)|\[.*?\]|<.*?>|/[^/ ]+/', '', text)
    t = re.sub(r'\b(jdm\.|jdn\.|jds\.|etw\.|einer Sache|eine Sache|sich)\s*', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def clean_example_en(en):
    """'Don't let him escape!; Don't let him get away!' -> first variant; 'disregarded/ignored' -> 'disregarded'."""
    en = en.split('; ')[0]
    en = re.sub(r"\b([\w’']+)/[\w’']+", r'\1', en)
    en = re.sub(r'\s*\((?:a|an|the|Br\.|Am\.)\)', '', en)
    en = re.sub(r'\s*\[[^\]]*\]', '', en)
    return re.sub(r'\s+', ' ', en).strip()


def is_sentence(de):
    words = de.split()
    return (3 <= len(words) <= 14 and de[:1].isupper() and de[-1:] in '.!?'
            and '…' not in de and '/' not in de and ';' not in de and '(' not in de)


# ---------------------------------------------------------------------------
# Dictionary sense index
# ---------------------------------------------------------------------------

PRONOUNS = {'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man', 'habe', 'hatte', 'hat', 'ist', 'war', 'bin',
            'sind', 'waren', 'werde', 'wird', 'würde', 'nicht', 'mich', 'dich', 'sich', 'uns', 'euch'}


SYN_SPLIT_RE = re.compile(r'; (?![^{]*\})')


class Sense:
    __slots__ = ('lemma', 'pos', 'tag', 'glosses', 'qualified', 'syn_index', 'syn_count',
                 'subentries', 'line_no', 'forms', 'examples')

    def to_dict(self):
        return {k: getattr(self, k) for k in self.__slots__ if k not in ('examples', 'forms')}


def build_index(lemmas):
    """
    Index every dictionary line whose primary German entry lists one of
    `lemmas` (exact surface string, case-sensitive) as a synonym.
    Returns lemma -> [Sense].
    """
    wanted = set(lemmas)
    index = defaultdict(list)
    with open(source_path('de-en.txt'), encoding='utf-8', errors='ignore') as f:
        for line_no, line in enumerate(f):
            line = line.rstrip('\n')
            if not line or line.startswith('#') or ' :: ' not in line:
                continue
            de_part, en_part = line.split(' :: ', 1)
            de_subs = de_part.split(' | ')
            en_subs = en_part.split(' | ')
            synonyms = SYN_SPLIT_RE.split(de_subs[0])
            en_raw = SYN_SPLIT_RE.split(re.sub(r'\{.*?\}', '', en_subs[0]))
            for syn_i, syn in enumerate(synonyms):
                m = re.search(r'\{([^}]+)\}', syn)
                if not m:
                    continue
                tags = [t.strip() for t in re.split(r'[;,]', m.group(1))]
                lemma = clean_de(syn)
                if lemma not in wanted:
                    continue
                for tag in tags:
                    pc = pos_class(tag)
                    if not pc:
                        continue
                    s = Sense()
                    s.lemma = lemma
                    s.pos = pc
                    s.tag = tag
                    s.glosses = [g for g in (clean_gloss(x) for x in en_raw) if g]
                    s.qualified = bool(QUALIFIER_RE.search(de_subs[0] + ' ' + en_subs[0]))
                    s.syn_index = syn_i
                    s.syn_count = len(synonyms)
                    s.subentries = len(de_subs)
                    s.line_no = line_no
                    s.forms = []
                    s.examples = []
                    in_forms = True
                    for k in range(1, min(len(de_subs), len(en_subs))):
                        de_k, en_k = de_subs[k].strip(), en_subs[k].strip()
                        if is_sentence(de_k) and en_k[-1:] in '.!?' and not re.search(r'\b(sb|sth)\.', en_k):
                            s.examples.append((de_k, clean_example_en(en_k)))
                        # Inflected forms directly follow the headword ('gebend | gegeben | er/sie gibt',
                        # 'Haus {n} | Häuser {pl}'); with synonyms they are listed in parallel.
                        if not in_forms or k > 8:
                            continue
                        parts = de_k.split('; ')
                        if len(synonyms) > 1:
                            if len(parts) != len(synonyms):
                                in_forms = False
                                continue
                            part = parts[syn_i]
                        else:
                            part = parts[0]
                        toks = re.findall(r"[A-Za-zÄÖÜäöüß]+", clean_de(part.replace('/', ' ')))
                        if pc == 'verb' and toks and len(toks) <= 4 and '{' not in part \
                                and all(t.islower() for t in toks):
                            # 'er/sie steht auf' -> the form 'steht auf' (all its words must appear)
                            form = ' '.join(t for t in toks if t not in PRONOUNS)
                            if form and form not in FUNCTION_WORDS:
                                s.forms.append(form)
                        elif pc == 'noun' and '{pl}' in part and len(toks) == 1:
                            s.forms.append(toks[0])
                        else:
                            in_forms = False
                    index[lemma].append(s)
                    break
    return index


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------

# Closed-class words. When one of these shows up capitalised as a noun
# ("das Ich", "das Aber") the entry is a nominalisation whose frequency rank
# was borrowed from the function word.
FUNCTION_WORDS = set("""
ich du er sie es wir ihr mich dich sich uns euch mir dir ihm ihn ihnen mein dein sein unser euer
der die das den dem des ein eine einer eines einem einen kein keine dieser diese dieses jener jene
man jemand niemand nichts etwas alles alle jeder jede jedes welcher welche welches wer was wo wie
und oder aber denn sondern doch ob dass weil wenn als falls obwohl damit bis seit während nachdem
in an auf aus bei mit nach von zu vor hinter über unter neben zwischen durch für gegen ohne um
ja nein nicht nur noch schon mal mehr weniger sehr so auch dann da hier dort heute gestern morgen
eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf hundert tausend einer
habe hast hat haben bin bist ist sind war waren werde wirst wird würde würden kann können muss
müssen soll sollen will wollen darf dürfen mag mögen möchte weiß wissen tu tun
""".split())

# Real everyday nouns whose lowercase form also happens to be a function word
# or verb form; these keep their place.
LEGIT_HOMOGRAPH_NOUNS = {
    'der Morgen', 'das Leben', 'das Essen', 'das Wissen', 'das Recht', 'die Arbeit',
    'die Bitte', 'der Abend', 'das Gut', 'die Macht', 'das Interesse', 'das Treffen',
    'das Vertrauen', 'das Verhalten', 'das Verfahren', 'das Unternehmen', 'das Vergnügen',
    'das Schreiben', 'das Wesen', 'das Vermögen', 'das Ergebnis', 'die Angst', 'der Wille',
}

MARKUP_RE = re.compile(r'[{}\[\]<>]|\bsth\.|\bsb\.|/\w+/|\.\.\.|…')

TEMPLATE_RE = re.compile(
    r"^(Hier ist (der|die|das) |Ich habe (der|die|das) neuen? .* gestern gesehen\.|Wir müssen prüfen, ob "
    r"|Ich möchte heute \w+\.$|Wir haben gestern beschlossen, zusammen zu |Es ist ratsam, diese Angelegenheit "
    r"|Das ist wirklich sehr \w+\.$|Das Ergebnis war überraschend |Unter diesen Umständen scheint die Entscheidung "
    r"|Sie spricht \w+ mit ihren Kollegen\.|Bitte verwende das Wort )")


def gloss_head(gloss):
    """The content word of a gloss used for English-frequency lookups."""
    g = gloss.lower()
    g = re.sub(r'^(to be |to get |to |a |an |the )', '', g)
    words = re.findall(r"[a-z']+", g)
    return words[0] if words else ''


def english_rank(gloss, en_freq):
    words = [w for w in re.findall(r"[a-z']+", re.sub(r'^(to |a |an |the )', '', gloss.lower()))
             if w not in ('to', 'a', 'an', 'the', 'of', 'be', 'get', 'one', 'out', 'up', 'in', 'on')]
    if not words:
        return 999999
    return max(en_freq.get(w, 999999) for w in words)


def headword_forms(entry, senses):
    """Surface forms that count as the headword appearing in an example."""
    _, lemma = split_headword(entry['word'])
    forms = {lemma.lower()}
    for s in senses:
        forms.update(f.lower() for f in s.forms)
    return forms


def example_has_headword(example, entry, forms):
    tokens = [t.lower() for t in re.findall(r"[A-Za-zÄÖÜäöüß]+", example)]
    if not tokens:
        return False
    _, lemma = split_headword(entry['word'])
    low = lemma.lower()
    token_set = set(tokens)
    if any(all(part in token_set for part in f.split()) for f in forms):
        return True
    # Inflection fallback: a shared stem of at least 4 letters (gehe, ging -> not caught, but forms cover those)
    stem = low[:-2] if entry['type'] == 'verb' and low.endswith('en') else low.rstrip('e')
    if len(stem) >= 4 and any(t.startswith(stem) for t in tokens):
        return True
    # Separable verbs: 'aufstehen' -> 'steht ... auf'
    if entry['type'] == 'verb':
        for pre in ('ab', 'an', 'auf', 'aus', 'bei', 'ein', 'fest', 'fort', 'her', 'hin', 'los', 'mit', 'nach',
                    'vor', 'weg', 'weiter', 'zu', 'zurück', 'zusammen', 'um', 'durch', 'über', 'statt', 'teil'):
            if low.startswith(pre) and len(low) > len(pre) + 3 and pre in tokens:
                rest = low[len(pre):]
                rstem = rest[:-2] if rest.endswith('en') else rest
                if any(t.startswith(rstem[:max(3, len(rstem) - 1)]) for t in tokens):
                    return True
    return False


def audit_entry(entry, rank_in_bank, en_freq, verb_forms, bank_words, forms=None):
    """Return a list of flag strings for one bank entry."""
    flags = []
    art, lemma = split_headword(entry['word'])
    gloss = entry['translation']
    low = lemma.lower()

    if entry['type'] == 'noun' and entry['word'] not in LEGIT_HOMOGRAPH_NOUNS:
        if low in FUNCTION_WORDS:
            flags.append('function_word_noun')
        elif low in verb_forms and low not in bank_words:
            flags.append('verb_form_noun')
        elif low in bank_words and bank_words[low] in ('verb',):
            flags.append('nominalised_infinitive')
        elif low in bank_words and bank_words[low] in ('adjective', 'adverb', 'conjunction'):
            flags.append('homograph_noun')

    if MARKUP_RE.search(gloss):
        flags.append('gloss_markup')
    if entry['type'] == 'verb' and not gloss.startswith('to ') and gloss not in ('must', 'shall', 'will', 'may', 'can'):
        flags.append('verb_gloss_form')
    if entry['type'] != 'verb' and gloss.startswith('to ') and entry['type'] != 'preposition':
        flags.append('pos_gloss_mismatch')
    if gloss.lower() == low or (art and gloss == lemma):
        flags.append('gloss_is_headword')

    er = english_rank(gloss, en_freq)
    if rank_in_bank < 10000 and er > 20000:
        flags.append('rare_sense')
    elif rank_in_bank < 3000 and er > 8000:
        flags.append('rare_sense')

    ex = entry.get('example', '')
    if TEMPLATE_RE.search(ex):
        flags.append('template_example')
    if ex and not example_has_headword(ex, entry, forms or {low}):
        flags.append('example_missing_headword')
    if MARKUP_RE.search(entry.get('exampleEn', '')):
        flags.append('example_en_markup')
    return flags


def build_sentence_index():
    """All short example sentence pairs in the dictionary, indexed by lowercase German token."""
    by_token = defaultdict(list)
    seen = set()
    with open(source_path('de-en.txt'), encoding='utf-8', errors='ignore') as f:
        for line in f:
            if ' :: ' not in line or line.startswith('#'):
                continue
            de_part, en_part = line.rstrip('\n').split(' :: ', 1)
            de_subs, en_subs = de_part.split(' | '), en_part.split(' | ')
            for k in range(min(len(de_subs), len(en_subs))):
                de, en = de_subs[k].strip(), en_subs[k].strip()
                if de in seen or not is_sentence(de) or en[-1:] not in '.!?' or re.search(r'\b(sb|sth)\.', en):
                    continue
                seen.add(de)
                pair = (de, clean_example_en(en))
                for tok in set(t.lower() for t in re.findall(r"[A-Za-zÄÖÜäöüß]+", de)):
                    by_token[tok].append(pair)
    return by_token


# ---------------------------------------------------------------------------
# Wiktionary (kaikki.org extract of English Wiktionary, CC BY-SA)
# ---------------------------------------------------------------------------

WIKTIONARY_URL = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz'
WIKTIONARY_DIR = os.path.join(CACHE_DIR, 'wiktionary')
WIKT_POS = {'noun': 'noun', 'verb': 'verb', 'adj': 'adjective', 'adv': 'adverb', 'prep': 'preposition',
            'postp': 'preposition', 'conj': 'conjunction', 'pron': 'word', 'det': 'word', 'article': 'word',
            'num': 'word', 'intj': 'word', 'particle': 'word', 'phrase': 'phrase', 'prep_phrase': 'phrase'}
RARE_SENSE_TAGS = {'archaic', 'obsolete', 'dated', 'rare', 'poetic', 'historical', 'regional', 'dialectal',
                   'Austria', 'Switzerland', 'Swiss', 'Bavaria', 'vulgar', 'slang', 'derogatory', 'literary',
                   'nonstandard', 'Early-New-High-German', 'Middle-High-German'}


def wiktionary_index():
    """
    word -> [{'pos', 'gender', 'plural', 'senses': [{'gloss', 'tags'}]}] for real lemmas
    (entries whose senses are all inflected forms are skipped). Built once and cached.
    """
    path = os.path.join(WIKTIONARY_DIR, 'index.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    import gzip
    os.makedirs(WIKTIONARY_DIR, exist_ok=True)
    src = os.path.join(WIKTIONARY_DIR, 'kaikki-German.jsonl.gz')
    if not os.path.exists(src):
        print(f"Downloading {WIKTIONARY_URL} (~100 MB) ...")
        req = urllib.request.Request(WIKTIONARY_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=600) as r, open(src, 'wb') as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    index = defaultdict(list)
    with gzip.open(src, 'rt', encoding='utf-8') as f:
        for line in f:
            e = json.loads(line)
            pos = WIKT_POS.get(e.get('pos'))
            if not pos:
                continue
            senses = []
            for s in e.get('senses', []):
                if s.get('form_of') or s.get('alt_of') or not s.get('glosses'):
                    continue
                tags = s.get('tags') or []
                if 'form-of' in tags or 'alt-of' in tags or 'abbreviation' in tags:
                    continue
                senses.append({'gloss': s['glosses'][0], 'tags': [t for t in tags if t in RARE_SENSE_TAGS]})
                if len(senses) == 6:
                    break
            if not senses:
                continue
            gender = None
            plural = None
            for h in e.get('head_templates') or []:
                if h.get('name') == 'de-noun':
                    g = (h.get('args') or {}).get('1', '')
                    gender = g.split(',')[0].split('.')[0].split('<')[0][:1] or None
            for fm in e.get('forms') or []:
                if 'plural' in (fm.get('tags') or []) and not fm.get('source'):
                    plural = fm.get('form')
                    break
            index[e['word']].append({'pos': pos, 'gender': gender, 'plural': plural, 'senses': senses})
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    return index


def wiktionary_gloss(sense_gloss, wtype, en_freq=None):
    """
    'to give (changing ownership)' -> 'to give'; 'train station, railway station' -> both;
    'female singer, singeress, songstress' -> 'female singer' (rare English words are dropped).
    """
    g = sense_gloss
    while True:  # nested brackets: "projector (device (onto a screen))"
        stripped = re.sub(r'\([^()]*\)|\[[^\[\]]*\]', '', g)
        if stripped == g:
            break
        g = stripped
    g = re.sub(r'[()\[\]]', '', g)
    items = []
    for part in re.split(r'[,;]', g.split('.')[0]):
        part = re.sub(r'\s+', ' ', part).strip(' :')
        if not part:
            continue
        if part.startswith('To '):
            part = 'to ' + part[3:]
        if wtype == 'verb' and not part.lower().startswith('to '):
            part = 'to ' + part
        if items:
            # a second variant only when it is short and common English ("railway station", not "singeress")
            words = re.findall(r"[a-z']+", part.lower().replace('to ', '', 1))
            if len(words) > 3 or not en_freq or any(en_freq.get(w, 999999) > 15000 for w in words):
                break
        items.append(part)
        if len(items) == 2:
            break
    return ', '.join(items)
