"use client";
import { useEffect, useRef, useState } from "react";
import { fetchMemberPhoneSuggestions } from "@/lib/services/memberPhoneSearchService";
import type { MemberPhoneSuggestion } from "@/lib/types/memberPhoneSearch";

export function useMemberPhoneSuggestions(query: string, shopId: number, warehouseId: string, userId: string, enabled: boolean, cacheVersion = "") {
  const [result, setResult] = useState<{ key: string; items: MemberPhoneSuggestion[]; loading: boolean; error: string | null }>({key:"",items:[],loading:false,error:null});
  const cache = useRef(new Map<string, {items: MemberPhoneSuggestion[]; expires: number}>());
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const prefix = query.replace(/\s/g, "");
  const key = `${userId}:${shopId}:${warehouseId}:${cacheVersion}:${prefix}`;
  const valid = enabled && !!warehouseId && !!userId && /^\d{3,15}$/.test(prefix);
  useEffect(() => {
    const attempt = ++sequence.current;
    if (!valid) return;
    const cached = cache.current.get(key);
    if (cached && cached.expires > Date.now()) {
      setResult({key,items:cached.items,loading:false,error:null});
      return;
    }
    setResult({key,items:[],loading:true,error:null});
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchMemberPhoneSuggestions({shopId,warehouseId,prefix}).then(items => {
        if (cancelled || attempt !== sequence.current) return;
        // Pending recovery must be queried afresh instead of hiding completion.
        if (!items.some(item => item.state !== "READY")) {
          if (cache.current.size >= 30) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(key,{items,expires:Date.now()+15_000});
        }
        setResult({key,items,loading:false,error:null});
      }).catch((error: unknown) => {
        if (cancelled || attempt !== sequence.current) return;
        console.error("[Gợi ý thành viên] Không thể tìm số điện thoại:",error);
        setResult({key,items:[],loading:false,error:error instanceof Error ? error.message : "Không thể tìm số điện thoại. Vui lòng thử lại."});
      });
    },350);
    return () => { cancelled = true; clearTimeout(timer); };
  },[key,valid,shopId,warehouseId,prefix,retry]);
  // Never render previous-prefix or previous-user results during effect cleanup.
  return { items: valid && result.key === key ? result.items : [], loading: valid && (result.key !== key || result.loading), error: valid && result.key === key ? result.error : null, valid,
    retry: () => { cache.current.delete(key); setRetry(value=>value+1); } };
}
