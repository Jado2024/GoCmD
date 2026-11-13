// Unit tests on real TypeScript validation logic, no Next/Prisma runtime required.
const fs=require('node:fs'), path=require('node:path'), Module=require('node:module'),cp=require('node:child_process');
let ts;
try { ts=require('typescript') } catch { ts=require(path.join(cp.execSync('npm root -g',{encoding:'utf8'}).trim(),'typescript')) }
const filename=path.join(__dirname,'../src/lib/product-taxonomy.ts');
const source=fs.readFileSync(filename,'utf8');
const js=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(js,filename);
const {validateTechnicalSpecs:validate,unitForFamily}=mod.exports;
const layers=JSON.stringify([{nature:'PURE',densityKgM3:28,thicknessCm:6},{nature:'AGGLO',densityKgM3:60,thicknessCm:10}]);
let passes=0;
function check(cond,reason){if(!cond)throw Error(reason);passes++}
for(const family of ['MATELAS','BANQUETTE']){
 for(const coreType of ['SANS_RESSORTS','BONNELL','ENSACHES']){
  for(const foamComposition of ['PURE','MELANGE','AGGLO']){
   const p={family,coreType,foamComposition,foamLayers:foamComposition==='MELANGE'?layers:null,foamDensity:foamComposition==='MELANGE'?null:28,
      ...(family==='MATELAS'?{mattressFinish:'SANS'}:{upholstery:'NUE'})};
   check(validate(p)===null,'Valid rejected: '+JSON.stringify(p));
  }
 }
}
check(validate({family:'MATELAS',coreType:'BONNELL',foamComposition:'PURE',foamDensity:28,mattressFinish:'TOPPER'})===null,'topper valid');
check(validate({family:'MATELAS',coreType:'ENSACHES',foamComposition:'PURE',foamDensity:28,mattressFinish:'ALESE'})===null,'alese valid');
check(validate({family:'MATELAS',coreType:'ENSACHES',foamComposition:'PURE',foamDensity:28,mattressFinish:'TOPPER,ALESE'})!==null,'topper+alese invalid');
check(validate({family:'BANQUETTE',coreType:'BONNELL',foamComposition:'AGGLO',foamDensity:70,upholstery:'TISSU'})===null,'banquette tissu valid');
check(validate({family:'BANQUETTE',coreType:'BONNELL',foamComposition:'AGGLO',foamDensity:70,upholstery:'TISSU',mattressFinish:'ALESE'})!==null,'alese banned for banquette');
check(validate({family:'MATELAS',coreType:'BONNELL',foamComposition:'MELANGE',foamLayers:JSON.stringify([{nature:'PURE',densityKgM3:28,thicknessCm:6}]),mattressFinish:'SANS'})!==null,'must contain pure+agglo');
check(validate({family:'PLAQUE_MOUSSE',foamNature:'PURE',foamGrade:'QUALITE DEMO',foamDensity:28})===null,'plaque valid');
check(validate({family:'PLAQUE_MOUSSE',foamNature:'AGGLO',foamGrade:'QUALITE DEMO',foamDensity:80})===null,'plaque agglo valid');
check(validate({family:'PLAQUE_MOUSSE',foamNature:'PURE',foamGrade:'QUALITE DEMO',foamDensity:0})!==null,'zero density invalid');
check(validate({family:'GAUFRETTE',coreType:'BONNELL'})!==null,'unsupported classification prohibited');
check(unitForFamily('PLAQUE_MOUSSE')==='u'&&unitForFamily('SALON')==='ml','unit mapping');
check(validate({family:'BANQUETTE',height:10,coreType:'BONNELL',foamComposition:'MELANGE',foamLayers:JSON.stringify([{nature:'PURE',densityKgM3:30,thicknessCm:5},{nature:'AGGLO',densityKgM3:70,thicknessCm:8}]),upholstery:'NUE'})!==null,'13 cm foam invalid in a 10 cm banquette');
check(validate({family:'BANQUETTE',height:10,coreType:'BONNELL',foamComposition:'MELANGE',foamLayers:JSON.stringify([{nature:'PURE',densityKgM3:30,thicknessCm:4},{nature:'AGGLO',densityKgM3:70,thicknessCm:5}]),upholstery:'NUE'})===null,'9 cm foam valid in a 10 cm banquette');
console.log('PASS V16 taxonomy: '+passes+' direct TypeScript validations (9 core/foam combinations per family, finishes, mixtures, plaques, units)');
