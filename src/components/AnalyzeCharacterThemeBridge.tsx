'use client';

import { useEffect } from 'react';
import { applyCharacterThemePalette, resetCharacterThemePalette } from '@/lib/character-theme-client';
import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';

type SavedThemeSession={
  stage?:unknown;
  draft?:{themePalette?:unknown}|null;
};

function validPalette(value:unknown):CharacterThemePalette|null{
  const parsed=themePaletteSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}

function readSavedSession():SavedThemeSession|null{
  try{
    const raw=localStorage.getItem(ANALYSIS_SESSION_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw) as unknown;
    return parsed&&typeof parsed==='object'?parsed as SavedThemeSession:null;
  }catch{return null}
}

function visibleCharacterStage(){
  return Boolean(document.querySelector('#personality-tag-picker,.question-card,.report-mag'));
}

function paletteFromPayload(payload:unknown):CharacterThemePalette|null{
  if(!payload||typeof payload!=='object')return null;
  const record=payload as Record<string,unknown>;
  const directDraft=record.draft&&typeof record.draft==='object'?record.draft as Record<string,unknown>:null;
  const direct=validPalette(directDraft?.themePalette);
  if(direct)return direct;
  const result=record.result&&typeof record.result==='object'?record.result as Record<string,unknown>:null;
  const resultDraft=result?.draft&&typeof result.draft==='object'?result.draft as Record<string,unknown>:null;
  return validPalette(resultDraft?.themePalette);
}

async function paletteFromResponse(response:Response){
  try{
    const clone=response.clone();
    const type=clone.headers.get('content-type')||'';
    if(type.includes('ndjson')){
      const text=await clone.text();
      const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
      for(let index=lines.length-1;index>=0;index-=1){
        try{
          const palette=paletteFromPayload(JSON.parse(lines[index]));
          if(palette)return palette;
        }catch{}
      }
      return null;
    }
    return paletteFromPayload(await clone.json().catch(()=>null));
  }catch{return null}
}

export function AnalyzeCharacterThemeBridge(){
  useEffect(()=>{
    const originalFetch=window.fetch.bind(window);
    let disposed=false;

    const syncSaved=()=>{
      if(disposed)return;
      const saved=readSavedSession();
      const palette=validPalette(saved?.draft?.themePalette);
      const stage=typeof saved?.stage==='string'?saved.stage:'';
      if(palette&&(stage==='input'||visibleCharacterStage())){
        applyCharacterThemePalette(palette);
        return;
      }
      if(!palette&&!visibleCharacterStage())resetCharacterThemePalette();
    };

    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
      const isParse=url.includes('/api/characters/parse');
      const isReplay=/\/api\/admin\/data\/[^/]+\/replay(?:\?|$)/.test(url);
      if(isParse)resetCharacterThemePalette();
      const response=await originalFetch(input,init);
      if(isParse||isReplay){
        void paletteFromResponse(response).then(palette=>{
          if(!disposed&&palette)applyCharacterThemePalette(palette);
        });
      }
      return response;
    };

    syncSaved();
    const interval=window.setInterval(syncSaved,240);
    const observer=new MutationObserver(syncSaved);
    observer.observe(document.body,{childList:true,subtree:true});

    return()=>{
      disposed=true;
      window.clearInterval(interval);
      observer.disconnect();
      window.fetch=originalFetch;
      resetCharacterThemePalette();
    };
  },[]);

  return null;
}
