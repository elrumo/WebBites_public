#!/usr/bin/env python3
"""Translation helper for i18n/locales.

  i18n-tool.py todo  <lang> [chunk]   write /tmp/i18n-tr/<lang>/todo-N.json (flat key -> English; es-419 also gets "_es" reference)
  i18n-tool.py apply <lang>           merge existing <lang>.json + /tmp/i18n-tr/<lang>/done-N.json into i18n/locales/<lang>.json
  i18n-tool.py check [lang...]        report missing keys / placeholder + plural mismatches against en.json
"""
import json, os, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LOC = os.path.join(ROOT, 'i18n/locales')
FILES = {'en': 'en', 'es': 'es', 'es-419': 'es-419', 'ca': 'ca', 'zh': 'zh', 'ja': 'ja', 'ko': 'ko', 'fr': 'fr', 'de': 'de'}
TMP = '/tmp/i18n-tr'

def load(l):
    p = f'{LOC}/{FILES[l]}.json'
    return json.load(open(p)) if os.path.exists(p) else {}

def flat(o, p=''):
    out = {}
    for k, v in o.items():
        if isinstance(v, dict): out.update(flat(v, p + k + '.'))
        else: out[p + k] = v
    return out

def unflat_like(template, f):
    """Rebuild nested dict following `template` (en) key order from flat dict f; skips keys absent from f."""
    out = {}
    for k, v in template.items():
        if isinstance(v, dict):
            sub = unflat_like(v, {kk[len(k) + 1:]: vv for kk, vv in f.items() if kk.startswith(k + '.')})
            if sub: out[k] = sub
        elif k in f: out[k] = f[k]
    return out

def ph(s):
    return sorted(re.findall(r'\{[^}]*\}', s)) if isinstance(s, str) else []

def problems(en_f, f):
    out = []
    for k, ev in en_f.items():
        if k not in f: out.append(('missing', k)); continue
        v = f[k]
        if not isinstance(v, str) or not v.strip(): out.append(('empty', k)); continue
        if ph(ev) != ph(v): out.append(('placeholders', k, ph(ev), ph(v)))
        if ev.count(' | ') != v.count(' | ') and ev.count('|') != v.count('|'): out.append(('plural-pipes', k))
        if re.search(r'(?<!\{\')@', ev.replace("{'@'}", '')) is None and re.search(r"(?<!\{')@(?!')", v.replace("{'@'}", '')): out.append(('raw-@', k))
    for k in f:
        if k not in en_f: out.append(('extra', k))
    return out

def main():
    cmd, *a = sys.argv[1:]
    en_f = flat(load('en'))
    if cmd == 'todo':
        lang = a[0]; size = int(a[1]) if len(a) > 1 else 150
        have = flat(load(lang))
        keys = [k for k in en_f if k not in have]
        d = f'{TMP}/{lang}'; os.makedirs(d, exist_ok=True)
        es_f = flat(load('es')) if lang == 'es-419' else None
        for i in range(0, len(keys), size):
            chunk = {k: en_f[k] for k in keys[i:i + size]}
            if es_f: chunk = {k: {'en': en_f[k], 'es': es_f.get(k)} for k in chunk}
            json.dump(chunk, open(f'{d}/todo-{i // size + 1}.json', 'w'), ensure_ascii=False, indent=1)
        print(f'{lang}: {len(keys)} keys to translate in {-(-len(keys) // size)} chunks -> {d}')
    elif cmd == 'apply':
        lang = a[0]; f = flat(load(lang)); d = f'{TMP}/{lang}'
        for n in sorted(os.listdir(d)):
            if n.startswith('done-'): f.update(json.load(open(f'{d}/{n}')))
        f = {k: v for k, v in f.items() if k in en_f}
        out = unflat_like(load('en'), f)
        open(f'{LOC}/{FILES[lang]}.json', 'w').write(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
        print('applied', lang, len(f), 'keys')
        for p in problems(en_f, f)[:40]: print(p)
    elif cmd == 'check':
        langs = a or [l for l in FILES if l != 'en']
        bad = 0
        for l in langs:
            pr = problems(en_f, flat(load(l)))
            bad += len(pr); print(l, len(pr), 'problems')
            for p in pr[:15]: print('  ', p)
        sys.exit(1 if bad else 0)
main()
