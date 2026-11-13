export type DocumentPage = { page:number; pageSize:number; total:number; hasMore:boolean }

export function readDocumentPage(params:URLSearchParams, defaultSize=40) {
  const integer=(key:string,fallback:number,max:number)=>{
    const value=Number(params.get(key))
    return Number.isSafeInteger(value)&&value>0?Math.min(max,value):fallback
  }
  const page=integer('page',1,1_000_000)
  const pageSize=integer('pageSize',defaultSize,200)
  return {page,pageSize,skip:(page-1)*pageSize,take:pageSize,
    q:(params.get('q')??'').trim().slice(0,100)}
}

export function documentPagination(page:number,pageSize:number,total:number):DocumentPage {
  return {page,pageSize,total,hasMore:page*pageSize<total}
}
