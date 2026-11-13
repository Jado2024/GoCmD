/** PDF natif minimal pour documents d'achats SODEPI. Aucune dépendance / aucun accès réseau.
 * Polices standard PDF: WinAnsi (français et chiffres). Les caractères hors Windows-1252 sont translittérés.
 * Les documents sont générés exclusivement côté serveur, après authentification.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const PAGE_W=595.28, PAGE_H=841.89, MARGIN=42;
const RED='#bd202a';
export type PdfDocument={
 title:string;reference:string;subtitle:string;
 details?:Array<[string,string]>;
 columns:string[];rows:string[][];
 note?:string; footer?:string; status?:string;
};
type Page={commands:string[];y:number};
const CP1252:Record<string,number>={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
function octalText(value:unknown){
 const src=String(value??'').replace(/\r?\n/g,' ').replace(/[\u200b-\u200f\u202a-\u202e]/g,'').replace(/[\u0300-\u036f]/g,'');
 let out='';
 for(const ch of src){const code=ch.codePointAt(0)!;const byte=CP1252[ch]??(code>=32&&code<=255?code:63);
  if(byte===40||byte===41||byte===92)out+='\\'+String.fromCharCode(byte);
  else if(byte<32||byte>=127)out+='\\'+byte.toString(8).padStart(3,'0');
  else out+=String.fromCharCode(byte);
 }
 return out;
}
function rgb(hex:string){const h=hex.replace('#','');return [0,2,4].map(x=>(parseInt(h.slice(x,x+2),16)/255).toFixed(3)).join(' ')}
function drawText(p:Page,s:unknown,x:number,y:number,size=10,bold=false,color='#202936'){
 p.commands.push(`${rgb(color)} rg BT /F${bold?2:1} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${octalText(s)}) Tj ET`);
}
function rect(p:Page,x:number,y:number,w:number,h:number,fill:string){p.commands.push(`${rgb(fill)} rg ${x} ${y} ${w} ${h} re f`)}
function rule(p:Page,y:number){rect(p,MARGIN,y,PAGE_W-2*MARGIN,0.6,'#D9DEE5')}
function wrap(text:string,maxChars:number){const words=String(text).split(/\s+/);const lines:string[]=[];let line='';for(const w of words){if((line+' '+w).trim().length>maxChars&&line){lines.push(line);line=w}else line=(line+' '+w).trim();if(line.length>maxChars){while(line.length>maxChars){lines.push(line.slice(0,maxChars-1)+'-');line=line.slice(maxChars-1)}}}if(line)lines.push(line);return lines.length?lines:[''];}
function header(p:Page,d:PdfDocument,index:number,hasLogo:boolean){
 rect(p,0,PAGE_H-17,PAGE_W,17,RED);
 if(hasLogo)p.commands.push(`q 44 0 0 52 ${MARGIN} ${PAGE_H-91} cm /Brand Do Q`);
 drawText(p,'SODEPI',hasLogo?97:MARGIN,PAGE_H-59,24,true,RED);
 drawText(p,'SERVICE ACHATS',hasLogo?97:MARGIN,PAGE_H-75,9,true,'#5A6573');
 drawText(p,d.title,MARGIN,PAGE_H-110,16,true);
 drawText(p,`${d.reference}  |  Page ${index}`,MARGIN,PAGE_H-128,10,false,'#5A6573');
 rule(p,PAGE_H-140);p.y=PAGE_H-160;
}
function pageBottom(p:Page,d:PdfDocument,index:number){rule(p,58);drawText(p,d.footer??'SODEPI - Document généré depuis GoCmd - Traçabilité conservée',MARGIN,42,8,false,'#5A6573');drawText(p,String(index),PAGE_W-MARGIN-14,42,8,false,'#5A6573')}
/** Génère de vrais octets PDF paginés A4; jamais une page HTML renommée en PDF. */
export function renderProcurementPdf(d:PdfDocument):Uint8Array {
 let logoHex='';try{logoHex=readFileSync(join(process.cwd(),'public','branding','sodepi-print.jpg')).toString('hex').toUpperCase()+'>'; }catch{/* Logo facultatif, texte SODEPI conserve. */}
 const pages:Page[]=[];const page=()=>{const p:Page={commands:[],y:0};pages.push(p);header(p,d,pages.length,Boolean(logoHex));return p};
 let p=page();
 const ensure=(h:number)=>{if(p.y-h<82)p=page()};
 const block=(label:string,value:string)=>{const ls=wrap(`${label} : ${value}`,98);ensure(ls.length*14+3);for(const t of ls){drawText(p,t,MARGIN,p.y,9);p.y-=14;}};
 if(d.subtitle){const lines=wrap(d.subtitle,95);ensure(lines.length*15+6);for(const l of lines){drawText(p,l,MARGIN,p.y,10,false,'#5A6573');p.y-=15;}p.y-=8;}
 for(const [k,v] of d.details??[])block(k,v);
 if(d.status)block('Statut',d.status);
 p.y-=12;
 const width=PAGE_W-2*MARGIN;
 const n=d.columns.length;
 if(n<1||n>8)throw Error('Colonnes PDF invalides');
 const cellW=width/n;
 const tableHeader=()=>{ensure(29);rect(p,MARGIN,p.y-18,width,26,'#EDEFF2');for(let i=0;i<n;i++)drawText(p,d.columns[i],MARGIN+i*cellW+6,p.y-9,8,true);p.y-=30;};
 tableHeader();
 for(const raw of d.rows){
  const cols=Array.from({length:n},(_,i)=>wrap(raw[i]??'',Math.max(10,Math.floor((cellW-10)/5.1))));
  const lines=Math.max(1,...cols.map(x=>x.length));const h=Math.max(25,lines*13+9);
  if(p.y-h<86){p=page();tableHeader();}
  for(let i=0;i<n;i++)for(let j=0;j<cols[i].length;j++)drawText(p,cols[i][j],MARGIN+i*cellW+5,p.y-12-j*13,8,false);
  rect(p,MARGIN,p.y-h,width,0.5,'#E2E5E9');p.y-=h;
 }
 if(d.note){p.y-=14;const lines=wrap(d.note,97);ensure(lines.length*14+8);for(const l of lines){drawText(p,l,MARGIN,p.y,9,false,'#495566');p.y-=14;}}
 for(let i=0;i<pages.length;i++)pageBottom(pages[i],d,i+1);
 // Assembleur PDF 1.4, offsets calculés sur les octets réels. Les chaînes sont ASCII + octal.
 const objects:string[]=[''];
 const add=(value:string)=>{objects.push(value);return objects.length-1};
 const catalog=add('');const pageRoot=add('');
 const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 const fontBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const logoId=logoHex?add(`<< /Type /XObject /Subtype /Image /Width 100 /Height 120 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${Buffer.byteLength(logoHex,'ascii')} >>\nstream\n${logoHex}\nendstream`):0;
 const ids:number[]=[];
 for(const pageData of pages){
  const content=pageData.commands.join('\n')+'\n';const contentId=add(`<< /Length ${Buffer.byteLength(content,'ascii')} >>\nstream\n${content}endstream`);
  ids.push(add(`<< /Type /Page /Parent ${pageRoot} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> ${logoId?`/XObject << /Brand ${logoId} 0 R >>`:''} >> /Contents ${contentId} 0 R >>`));
 }
 objects[catalog]=`<< /Type /Catalog /Pages ${pageRoot} 0 R >>`;
 objects[pageRoot]=`<< /Type /Pages /Kids [${ids.map(i=>`${i} 0 R`).join(' ')}] /Count ${ids.length} >>`;
 let pdf='%PDF-1.4\n%GoCmd SODEPI\n';const offsets=[0];
 for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'ascii'));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
 const start=Buffer.byteLength(pdf,'ascii');pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
 for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
 pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return Buffer.from(pdf,'ascii');
}
export function pdfDownload(bytes:Uint8Array,filename:string){
 const name=filename.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,150);
 const body=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
 return new Response(body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'}});
}
