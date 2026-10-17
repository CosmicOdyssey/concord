"""Regenerate the Sponsor budget test fixtures from a running Concord API (docs/financial/CONTRACT.md).

usage: python make_financial_fixtures.py [api_base]   (default http://localhost:8000)

Writes financial_demo.json and three trimmed comparisons next to this file: the default request, a capacity-short
variant (SYN-A and SYN-B at 20 stated places each, so A, B and D are not costed and C/E add SYN-C) and a commercial
payer without the rate assumption (insurer and participant amounts UNKNOWN). Trimming keeps every scenario field and
drops only bulk (all but three worksheet lines, long assumption lists, most evidence keys).
"""
import json
import pathlib
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000').rstrip('/')
OUT = pathlib.Path(__file__).resolve().parent


def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def trim(r):
    cov = dict(r['coverage'])
    items = cov['items']
    cov['items'] = [items[0]] + [i for i in items if i['status'] == 'SPONSOR'][:1] + [i for i in items if i['status'] == 'UNKNOWN'][:1]
    r['coverage'] = cov
    r['evidence'] = {k: r['evidence'][k] for k in ('commit', 'financial_input_kind', 'cache_policy')}
    for s in r['scenarios']:
        s['plan']['assumptions'] = s['plan']['assumptions'][:1]
        if s['economics']:
            s['economics']['resource_assumptions'] = s['economics']['resource_assumptions'][:1]
    return r


def write(name, obj):
    with open(OUT / f'{name}.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')


demo = get('/api/financial/demo')
default = demo['request']
short = json.loads(json.dumps(default))
for site in short['sites']:
    if site['baseline_active']:
        site['capacity'] = 20
commercial = dict(default, payer_kind='commercial')

write('financial_default', trim(post('/api/financial/compare', default)))
write('financial_capacity_short', trim(post('/api/financial/compare', short)))
write('financial_commercial', trim(post('/api/financial/compare', commercial)))
demo['coverage']['items'] = demo['coverage']['items'][:2]
write('financial_demo', demo)
print('wrote', ', '.join(p.name for p in sorted(OUT.glob('financial_*.json'))))
