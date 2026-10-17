"""Check real report HTTP responses for a browser-observed run; not a browser download test."""
import hashlib, html, json, re, sys, urllib.request
from pathlib import Path
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8004'
ident=sys.argv[2] if len(sys.argv)>2 else 'c6184699e99d58a5d3cf71d09fefc09e'
out=Path(__file__).parent
url=f'{base}/api/portfolio-command/runs/{ident}'
def read(url):
    with urllib.request.urlopen(url) as response:
        return response.read(),dict(response.headers)
body,headers=read(url)
result=json.loads(body)
report,jheaders=read(url+'/report/json')
page,hheaders=read(url+'/report/html')
assert json.loads(report)==result
embedded=json.loads(html.unescape(re.search(r'<pre>(.*?)</pre>',page.decode(),re.S)[1]))
assert embedded==result
copy=dict(result); expected=copy.pop('result_sha256');copy.pop('run_id')
canonical=json.dumps(copy,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
assert hashlib.sha256(canonical).hexdigest()==expected
assert headers.get('x-concord-delivery-mode')=='artifact-replay'
# Values actually observed in the browser's six-strategy table, whole USD display rounding.
assert [s['expected_makespan'] for s in result['scenarios']]==[15.13,15.13,9.94,15.13,9.94,9.53]
assert [round(s['ledger']['expected_commitment']) for s in result['scenarios']]==[1018305,943305,1050576,967305,1125576,1097830]
request=urllib.request.Request(base+'/api/portfolio-command/compare',data=json.dumps(result['request']).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request) as response: repeated=json.load(response)
assert repeated['scenarios']==result['scenarios']
for name,data in [('browser-run-api.json',body),('report-endpoint.json',report),('report-endpoint.html',page)]:
    (out/name).write_bytes(data)
evidence={'browser_run':ident,'saved_response_sha256':expected,'ui_values_match':True,'json_equals_api':True,'html_embedded_json_equals_api':True,'repeat_scenarios_identical':True,'browser_download':'BLOCKED: Chrome displayed Blocked by your organization; no downloaded audit file observed','api_report_headers':{'json':jheaders,'html':hheaders},'origin_evidence':result['evidence'],'repeated_run_id':repeated['run_id']}
(out/'delivery-verification.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps({k:v for k,v in evidence.items() if k not in {'origin_evidence','api_report_headers'}}))
