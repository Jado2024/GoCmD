// Preload only in the disposable test server. Database engine timestamps are independent.
const {readFileSync} = require('node:fs');
const clock = process.env.GOCMD_QA_CLOCK_FILE;
if (!clock) throw Error('Horloge de recette absente');
const SystemDate = Date;
const now = () => SystemDate.parse(readFileSync(clock,'utf8').trim());
global.Date = new Proxy(SystemDate,{
  construct(target,args,newTarget) {return Reflect.construct(target,args.length?args:[now()],newTarget)},
  apply() {return new SystemDate(now()).toString()},
  get(target,key,receiver) {return key==='now'?now:Reflect.get(target,key,receiver)},
});
