import json,subprocess,time,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
old=json.load(open('/mnt/data/RESULTATS_TESTS_P51525.json'))
commands=['test:p51526']+[x['name'] for x in old['tests'] if x['name']!='test:rr19:hardening']
results=[]
for name in commands:
 start=time.time()
 try:
  r=subprocess.run(['npm','run',name],cwd=ROOT,capture_output=True,text=True,timeout=17)
  status='PASS' if r.returncode==0 else 'FAIL'
  log=r.stdout+'\n'+r.stderr
 except subprocess.TimeoutExpired as e:
  status='TIMEOUT';log=str(e)
 results.append(dict(name=name,status=status,seconds=round(time.time()-start,1),output_tail=log[-1800:]))
 print(f'{len(results):02d}/{len(commands)} {status:7s} {name}',flush=True)
 (ROOT/'RAPPORT_TESTS_P51526.json').write_text(json.dumps(results,indent=2,ensure_ascii=False))
