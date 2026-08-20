'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

type AdminPaletteRow={
  shareCode?:unknown;
  name?:unknown;
  ownerName?:unknown;
  themePalette?:unknown;
};

type PaletteItem={
  shareCode:string;
  name:string;
  ownerName:string;
  palette:CharacterThemePalette|null;
};

function sourceLabel(source:CharacterThemePalette['source']){
  if(source==='text')return '텍스트 설정';
  if(source==='image')return '이미지 관찰';
  return '텍스트 + 이미지';
}

function parseRows(value:unknown):PaletteItem[]{
  if(!value||typeof value!=='object')return[];
  const chars=(value as {characters?:unknown}).characters;
  if(!Array.isArray(chars))return[];
  return chars.map(raw=>{
    const row=raw&&typeof raw==='object'?raw as AdminPaletteRow:{};
    const parsed=themePaletteSchema.safeParse(row.themePalette);
    return {
      shareCode:typeof row.shareCode==='string'?row.shareCode:'',
      name:typeof row.name==='string'&&row.name.trim()?row.name.trim():'이름 없음',
      ownerName:typeof row.ownerName==='string'?row.ownerName.trim():'',
      palette:parsed.success?parsed.data:null,
    };
  }).filter(row=>row.shareCode);
}

function Swatch({label,color}:{label:string;color:string}){
  return <div style={{display:'grid',gridTemplateColumns:'26px minmax(0,1fr)',gap:9,alignItems:'center',minWidth:0}}>
    <span aria-hidden="true" style={{width:26,height:26,borderRadius:7,background:color,border:'1px solid rgba(23,24,22,.18)',boxShadow:'inset 0 0 0 1px rgba(255,255,255,.3)'}}/>
    <span style={{minWidth:0}}>
      <strong style={{display:'block',fontSize:11,lineHeight:1.2}}>{label}</strong>
      <code style={{display:'block',marginTop:2,fontSize:10,color:'var(--muted)',whiteSpace:'nowrap'}}>{color}</code>
    </span>
  </div>;
}

export function AdminThemePaletteAudit(){
  const pathname=usePathname();
  const [authorized,setAuthorized]=useState(false);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [rows,setRows]=useState<PaletteItem[]>([]);
  const [error,setError]=useState('');
  const active=pathname==='/admin/console';

  const load=useCallback(async()=>{
    if(!active)return;
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/admin/data',{cache:'no-store'});
      if(response.status===401){setAuthorized(false);setRows([]);return}
      const body=await response.json().catch(()=>({}));
      if(!response.ok){setAuthorized(false);setError('팔레트 데이터를 불러오지 못했어요.');return}
      setAuthorized(true);
      setRows(parseRows(body));
    }catch{setAuthorized(false);setError('팔레트 데이터를 불러오지 못했어요.')}
    finally{setLoading(false)}
  },[active]);

  useEffect(()=>{
    if(!active){setAuthorized(false);setOpen(false);setRows([]);return}
    void load();
  },[active,load]);

  const withPalette=useMemo(()=>rows.filter(row=>row.palette),[rows]);
  const missing=rows.length-withPalette.length;
  if(!active||!authorized)return null;

  return <>
    <button
      type="button"
      onClick={()=>{setOpen(value=>!value);if(!open)void load()}}
      style={{position:'fixed',right:18,top:88,zIndex:85,border:'1px solid var(--ink)',borderRadius:999,padding:'9px 13px',background:'var(--paper)',color:'var(--ink)',fontSize:12,fontWeight:900,boxShadow:'0 8px 24px rgba(23,24,22,.12)'}}
    >
      팔레트 확인{withPalette.length?` ${withPalette.length}`:''}
    </button>

    {open&&<aside aria-label="캐릭터 테마 팔레트 확인" style={{position:'fixed',right:18,top:132,zIndex:84,width:'min(430px,calc(100vw - 36px))',maxHeight:'calc(100vh - 154px)',overflow:'auto',border:'1px solid var(--line)',borderRadius:18,background:'var(--paper)',boxShadow:'0 24px 70px rgba(23,24,22,.2)',padding:18}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',position:'sticky',top:-18,margin:'-18px -18px 12px',padding:'18px 18px 12px',background:'var(--paper)',zIndex:1,borderBottom:'1px solid var(--line)'}}>
        <div>
          <strong style={{fontSize:15}}>캐릭터 팔레트</strong>
          <p className="muted" style={{margin:'5px 0 0',fontSize:11,lineHeight:1.45}}>저장된 실제 UI 색상 · 없는 캐릭터 {missing}개</p>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button className="btn" type="button" disabled={loading} onClick={()=>void load()} style={{padding:'6px 9px',fontSize:11}}>{loading?'…':'새로고침'}</button>
          <button className="btn" type="button" onClick={()=>setOpen(false)} style={{padding:'6px 9px',fontSize:11}}>닫기</button>
        </div>
      </div>

      {error&&<p className="error" style={{margin:'0 0 12px'}}>{error}</p>}
      {!loading&&!rows.length&&!error&&<p className="muted" style={{margin:0}}>표시할 캐릭터가 없어요.</p>}
      <div style={{display:'grid',gap:10}}>
        {rows.slice(0,100).map(row=><section key={row.shareCode} style={{border:'1px solid var(--line)',borderRadius:14,padding:13,background:'rgba(255,255,255,.45)'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'baseline'}}>
            <strong style={{fontSize:13}}>{row.name}</strong>
            <code style={{fontSize:10,color:'var(--muted)'}}>{row.shareCode}</code>
          </div>
          {row.ownerName&&<div className="muted" style={{fontSize:10,marginTop:3}}>오너 · {row.ownerName}</div>}
          {row.palette?<>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px 14px',marginTop:13}}>
              <Swatch label="메인" color={row.palette.main}/>
              <Swatch label="메인서브" color={row.palette.mainSub}/>
              <Swatch label="포인트" color={row.palette.point}/>
              <Swatch label="포인트서브" color={row.palette.pointSub}/>
            </div>
            <div className="muted" style={{fontSize:10,marginTop:11}}>{sourceLabel(row.palette.source)} · 신뢰도 {row.palette.confidence}</div>
          </>:<p className="muted" style={{margin:'10px 0 0',fontSize:11}}>팔레트 없음 · 기존 캐릭터 또는 테마 저장 전 생성본</p>}
        </section>)}
      </div>
    </aside>}
  </>;
}
