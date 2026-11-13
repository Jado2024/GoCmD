"use client"

import {useQuery} from "@tanstack/react-query"
import {useEffect,useState} from "react"
import type {DocumentPage} from "@/lib/document-register"
import {api} from "./hooks"

export function useDocumentRegister<T>(name:string,q:string,page:number,enabled:boolean,options:Record<string,string>={}) {
  const [search,setSearch]=useState(q)
  useEffect(()=>{
    const timer=setTimeout(()=>setSearch(q),250)
    return ()=>clearTimeout(timer)
  },[q])
  const params=new URLSearchParams({view:"register",page:String(page),q:search,...options})
  return useQuery({
    queryKey:[name,"register",params.toString()],
    queryFn:({signal})=>api<{items:T[];pagination:DocumentPage}>(`/api/${name}?${params}`,{signal}),
    enabled:enabled&&search===q,
  })
}
