/** V2 — dictionnaire contrôlé, version de sérialisation et codification non-mousse.
 * Les valeurs de référence par famille sont des conventions DEMO à valider
 * par Achats/Qualité/Magasin avant usage avec des données réelles.
 */
export const ARTICLE_DICTIONARY = {
  "Tissu":{family:"TIS",required:["type","composition","couleur","piquage","format","laizeCm","grammageGM2"]},
  "Ressorts":{family:"RES",required:["technologie","longueurCm","largeurCm","hauteurCm","diametreFilMm"]},
  "Fibres & rembourrage":{family:"FIB",required:["type","composition","grammageGM2","largeurCm"]},
  "Mercerie":{family:"MER",required:["type","matiere","couleur","calibreMm"]},
  "Emballage & consommables":{family:"EMB",required:["type","matiere","longueurCm","largeurCm","epaisseurUm"]},
  "Colles":{family:"COL",required:["chimie","grade","conditionnement","capaciteKg"]},
} as const
export type NonFoamCategory=keyof typeof ARTICLE_DICTIONARY
export type ArticleAttributes=Record<string,string|number>
const OPTIONAL=new Set(["qualite","motif","finition","marquage","densite","longueurFixeCm","epaisseurCm","resilience","conditionnement","nuance","zones","typeTechnique","longueurCm","largeurCm","hauteurCm","calibreMm","laizeCm","grammageGM2","diametreFilMm","epaisseurUm","capaciteKg","type","matiere","composition","couleur","piquage","format","technologie","chimie","grade"])
const numFields=new Set(["longueurFixeCm","longueurCm","largeurCm","hauteurCm","calibreMm","laizeCm","grammageGM2","diametreFilMm","epaisseurUm","capaciteKg","densite","epaisseurCm","resilience"])
const token=(x:string)=>x.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"")
export function normalizedTechnicalAttributes(category:string,input:ArticleAttributes):{attributes:ArticleAttributes;errors:string[]} {
  const cfg=ARTICLE_DICTIONARY[category as NonFoamCategory]
  if(!cfg)return {attributes:{},errors:["Famille technique inconnue"]}
  const errors:string[]=[],attributes:ArticleAttributes={}
  for(const [key,val] of Object.entries(input)){
    if(!OPTIONAL.has(key)){errors.push(`Attribut non gouverné : ${key}`);continue}
    if(numFields.has(key)){
      const n=typeof val==="number"?val:Number(val)
      if(!Number.isFinite(n)||n<=0||n>100000||Math.round(n*1000)/1000!==n) errors.push(`Valeur numérique invalide : ${key}`)
      else attributes[key]=Number(n.toFixed(3))
    } else {
      const v=token(String(val))
      if(!v||v.length>32) errors.push(`Valeur technique invalide : ${key}`)
      else attributes[key]=v
    }
  }
  for(const key of cfg.required)if(attributes[key]===undefined)errors.push(`Champ distinctif obligatoire : ${key}`)
  return {attributes,errors}
}
export function technicalArticleIdentity(category:string,input:ArticleAttributes){
  const {attributes,errors}=normalizedTechnicalAttributes(category,input)
  if(errors.length)return {errors,identity:null,reference:null,attributes}
  const cfg=ARTICLE_DICTIONARY[category as NonFoamCategory]
  const pairs=Object.entries(attributes).sort(([a],[b])=>a.localeCompare(b))
  const identity=JSON.stringify({schema:"GOCMD-ARTICLE-V2",family:cfg.family,attributes:Object.fromEntries(pairs)})
  const aliases:Record<string,string>={type:"T",matiere:"MAT",composition:"CMP",couleur:"COU",piquage:"PIQ",format:"FMT",
    technologie:"TEC",longueurCm:"LG",largeurCm:"LR",hauteurCm:"HT",calibreMm:"CAL",laizeCm:"LZ",
    grammageGM2:"Q",diametreFilMm:"DIA",epaisseurUm:"EPUM",capaciteKg:"CAPKG",chimie:"CH",grade:"GR",conditionnement:"COND",
    qualite:"QL",motif:"MOT",finition:"FIN",marquage:"MAR",densite:"D",longueurFixeCm:"LF",epaisseurCm:"EPC",resilience:"RES",nuance:"NU",zones:"ZO",typeTechnique:"TT"}
  const codeParts=[...cfg.required,...pairs.map(([key])=>key).filter(k=>!cfg.required.some(req=>req===k))]
  const reference=`MP-${cfg.family}-`+codeParts.map(k=>`${aliases[k]??k}${String(attributes[k]).replace(".","P")}`).join("-")
  return {errors:reference.length>160?["Référence de plus de 160 caractères : réduire la nomenclature de variantes"]:[],identity,reference,attributes}
}
export function shortArticleAlias(v:string){return token(v).slice(0,24)}

/** Désignation technique complète : toutes les valeurs distinctives, unités explicites. */
export function technicalArticleDescription(category:string,attrs:ArticleAttributes):string {
 const units:Record<string,string>={longueurCm:" cm",largeurCm:" cm",hauteurCm:" cm",laizeCm:" cm",longueurFixeCm:" cm",epaisseurCm:" cm",calibreMm:" mm",diametreFilMm:" mm",epaisseurUm:" µm",capaciteKg:" kg",grammageGM2:" g/m²"}
 return `${category} — ${Object.entries(attrs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k} : ${v}${units[k]??""}`).join(" ; ")}`
}
