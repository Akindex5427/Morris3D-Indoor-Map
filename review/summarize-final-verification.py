from pathlib import Path
import json, statistics, hashlib
root=Path('docs/stage-6-final')
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
median=statistics.median
result={}
unit=read(root/'unit-tests.json')
result['unit']={k:unit[k] for k in ['numTotalTests','numPassedTests','numFailedTests']}
result['unit']['failures']=[t['fullName'] for s in unit['testResults'] for t in s['assertionResults'] if t['status']=='failed']
old_unit=read('docs/stage-7-performance/unit-results.json')
old_failures={t['fullName'] for s in old_unit['testResults'] for t in s['assertionResults'] if t['status']=='failed'}
result['unit']['newFailuresComparedWithHistorical']=sorted(set(result['unit']['failures'])-old_failures)
result['browserSuites']=[read(p) for p in root.glob('*/status.json')]
start=read(root/'start-hashes.json')
result['changedApplicationOrDataFiles']=[p for p,h in start.items() if not Path(p).exists() or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
result['unchangedGeoJSONFiles']=sum(p.startswith('public/') and p.endswith('.geojson') for p in start if p not in result['changedApplicationOrDataFiles'])
p=root/'cinematic-performance.json'
if p.exists():
 d=read(p);result['cinematicConditions']={k:v for k,v in d.items() if k!='runs'}
 result['renderers']=list({r['renderer'] for r in d['runs']})
 result['cinematic']=[]
 for name in {s['name'] for r in d['runs'] for s in r['scenarios']}:
  rows=[s for r in d['runs'] for s in r['scenarios'] if s['name']==name]
  result['cinematic'].append({'name':name,'runs':len(rows),**{k:{'median':median(s[k] for s in rows),'min':min(s[k] for s in rows),'max':max(s[k] for s in rows)} for k in ['elapsedMs','p50','p95','p99','drawCalls','drawCallsPerDrawnFrame','rootCommits','rootCommitsPerSecond','blendEnabledDrawCalls']}})
 result['memory']=[]
 for r in d['runs']:
  cycles=r['cycles']
  if cycles:
   result['memory'].append({'run':r['run'],'cycles':len(cycles)-1,'startHeapMiB':cycles[0]['heapBytes']/2**20,'endHeapMiB':cycles[-1]['heapBytes']/2**20,
    'lastFiveGrowthMiB':(cycles[-1]['heapBytes']-cycles[5]['heapBytes'])/2**20,'lightRequests':r['lightRequests'],
    'resourceLiveCounts':{kind:sorted({c['resources'][kind]['live'] for c in cycles}) for kind in cycles[0]['resources']},
    'resourceCreationsDuringCycles':{kind:cycles[-1]['resources'][kind]['created']-cycles[0]['resources'][kind]['created'] for kind in cycles[0]['resources']}})
 old_path=root/'pre-fix/cinematic-performance.json'
 if old_path.exists():
  old=read(old_path);result['allocationComparison']=[]
  for name in dict.fromkeys(s['name'] for r in d['runs'] for s in r['scenarios']):
   before=[s for r in old['runs'] for s in r['scenarios'] if s['name']==name]
   after=[s for r in d['runs'] for s in r['scenarios'] if s['name']==name]
   result['allocationComparison'].append({'name':name,
    'beforeP95':median(s['p95'] for s in before),'afterP95':median(s['p95'] for s in after),
    'beforeCreated':{kind:median(s['resourcesAfter'][kind]['created']-s['resourcesBefore'][kind]['created'] for s in before) for kind in before[0]['resourcesBefore']},
    'afterCreated':{kind:median(s['resourcesAfter'][kind]['created']-s['resourcesBefore'][kind]['created'] for s in after) for kind in after[0]['resourcesBefore']}})
workloads=[read(p) for p in root.glob('workload-*.json')]
result['workloadFailures']=[d.get('failure') for d in workloads if d.get('failure')]
if workloads:
 runs=[r for d in workloads if not d.get('failure') for r in d['runs']]
 old=read('docs/stage-7-performance/after.json')['runs']
 result['workload']=[]
 for name in dict.fromkeys(s['name'] for r in runs for s in r['scenarios']):
  rows=[s for r in runs for s in r['scenarios'] if s['name']==name]
  previous=[s for r in old for s in r['scenarios'] if s['name']==name]
  keys=['elapsedMs','p50FrameMs','p95FrameMs','p99FrameMs','drawCalls','deckDrawCalls','wallMeshReplacements','heapMB']
  result['workload'].append({'name':name,'runs':len(rows),'current':{k:median(s[k] for s in rows) for k in keys},'historical':{k:median(s[k] for s in previous) for k in keys} if previous else None})
 result['workloadConditions']=[{k:d.get(k) for k in ['chrome','viewport','rendering','cpu']} for d in workloads]
(root/'summary.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
