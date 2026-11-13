import path from 'node:path'
import { mkdir } from 'node:fs/promises'

// External to project/public: do not distribute or serve through static Next.js assets.
export function offerDocumentsRoot(){
  return path.resolve(process.env.GOCMD_DOCUMENTS_DIR?.trim() || path.join(process.cwd(),'..','gocmd-private-documents'))
}
export async function ensureOfferDocumentsRoot(){
  const folder=offerDocumentsRoot()
  await mkdir(folder,{recursive:true,mode:0o700})
  return folder
}
export function safeDocumentName(storedName:string):boolean{
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}\.pdf$/.test(storedName) && path.basename(storedName)===storedName
}
export function safeOriginalFilename(name:string){
  const cleaned=name.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,150)
  return cleaned.toLowerCase().endsWith('.pdf')?cleaned:`${cleaned}.pdf`
}
