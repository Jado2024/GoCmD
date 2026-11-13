const fs=require('fs'),path=require('path'),ts=require('typescript');
let count=0,fail=[];
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.tsx?$/.test(f)){count++;const code=fs.readFileSync(f,'utf8');const st=ts.createSourceFile(f,code,ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const d of st.parseDiagnostics)fail.push(`${f}:${ts.getLineAndCharacterOfPosition(st,d.start||0).line+1}:${ts.flattenDiagnosticMessageText(d.messageText,' ')}`)}}}
walk('src');
console.log(`TS/TSX syntax: ${count} files; ${fail.length} parse errors`);for(const item of fail)console.error(item);process.exit(fail.length?1:0);
