'use client';

import { useEffect } from 'react';
import { applyCharacterThemePalette, resetCharacterThemePalette } from '@/lib/character-theme-client';
import { deriveCharacterThemeFromSources } from '@/lib/theme-source-extractor';
import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';
const THEME_STORAGE_KEY='chara_lab_character_theme_v1';
const THEME_SHARE_PREFIX='chara_theme_';

type SavedThemeSession={
  stage?:unknown;
  draft?:{themePalette?:unknown}|null;
};

type DraftLike={
  themePalette?:unknown;
  basicProfile?:{
    profileText?:unknown;
    secretProfileText?:unknown;
    appearanceNotes?:unknown;
  }|null;
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

function readStoredPalette(key=THEME_STORAGE_KEY):CharacterThemePalette|null{
  try{
    const raw=localStorage.getItem(key);
    return raw?validPalette(JSON.parse(raw)):null;
  }catch{return null}
}

function storePalette(palette:CharacterThemePalette,key=THEME_STORAGE_KEY){
  try{localStorage.setItem(key,JSON.stringify(palette))}catch{}
}

function clearStoredPalette(){
  try{localStorage.removeItem(THEME_STORAGE_KEY)}catch{}
}

function visibleCharacterStage(){
  return Boolean(document.querySelector('#personality-tag-picker,.question-card,.report-mag'));
}

function paletteFromDraft(value:unknown):CharacterThemePalette|null{
  if(!value||typeof value!=='object')return null;
  const draft=value as DraftLike;
  const explicit=validPalette(draft.themePalette);
  if(explicit)return explicit;
  const basic=draft.basicProfile&&typeof draft.basicProfile==='object'?draft.basicProfile:null;
  if(!basic)return null;
  return deriveCharacterThemeFromSources({
    profileText:typeof basic.profileText==='string'?basic.profileText:'',
    secretProfileText:typeof basic.secretProfileText==='string'?basic.secretProfileText:'',
    appearanceNotes:typeof basic.appearanceNotes==='string'?basic.appearanceNotes:'',
  })||null;
}

function paletteFromPayload(payload:unknown):CharacterThemePalette|null{
  if(!payload||typeof payload!=='object')return null;
  const record=payload as Record<string,unknown>;
  const direct=validPalette(record.themePalette);
  if(direct)return direct;
  const directDraft=paletteFromDraft(record.draft);
  if(directDraft)return directDraft;
  const result=record.result&&typeof record.result==='object'?record.result as Record<string,unknown>:null;
  if(!result)return null;
  return validPalette(result.themePalette)||paletteFromDraft(result.draft);
}

async function payloadFromResponse(response:Response){
  try{
    const clone=response.clone();
    const type=clone.headers.get('content-type')||'';
    if(type.includes('ndjson')){
      const text=await clone.text();
      const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
      for(let index=lines.length-1;index>=0;index-=1){
        try{
          const parsed=JSON.parse(lines[index]) as unknown;
          if(parsed&&typeof parsed==='object'&&'result' in (parsed as Record<string,unknown>))return parsed;
        }catch{}
      }
      return null;
    }
    return await clone.json().catch(()=>null);
  }catch{return null}
}

async function paletteFromResponse(response:Response){
  const payload=await payloadFromResponse(response);
  return paletteFromPayload(payload);
}

function patchedJsonResponse(response:Response,payload:Record<string,unknown>){
  const headers=new Headers(response.headers);
  headers.set('content-type','application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify(payload),{status:response.status,statusText:response.statusText,headers});
}

export function AnalyzeCharacterThemeBridge(){
  useEffect(()=>{
    const originalFetch=window.fetch.bind(window);
    let disposed=false;

    const applyAndRemember=(palette:CharacterThemePalette)=>{
      if(disposed)return;
      storePalette(palette);
      applyCharacterThemePalette(palette);
    };

    const syncSaved=()=>{
      if(disposed)return;
      const saved=readSavedSession();
      const sessionPalette=validPalette(saved?.draft?.themePalette);
      const palette=sessionPalette||readStoredPalette();
      if(palette&&visibleCharacterStage()){
        applyCharacterThemePalette(palette);
        return;
      }
      if(!visibleCharacterStage())resetCharacterThemePalette();
    };

    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
      const isParse=url.includes('/api/characters/parse');
      const isReplay=/\/api\/admin\/data\/[^/]+\/replay(?:\?|$)/.test(url);
      const isFinalize=url.includes('/api/characters/finalize');

      if(isParse){
        clearStoredPalette();
        resetCharacterThemePalette();
      }

      const response=await originalFetch(input,init);

      if(isParse||isReplay){
        void paletteFromResponse(response).then(palette=>{
          if(palette)applyAndRemember(palette);
        });
      }

      if(isFinalize&&response.ok){
        try{
          const payload=await response.clone().json() as Record<string,unknown>;
          const shareCode=typeof payload.shareCode==='string'?payload.shareCode:'';
          const editToken=typeof payload.editToken==='string'?payload.editToken:'';

          // The analyze page intentionally keeps rendering the freshly generated report,
          // but the address is switched to the durable character route immediately.
          // A refresh therefore re-opens this character instead of falling back to /analyze.
          if(shareCode&&window.location.pathname==='/analyze'){
            window.history.replaceState(window.history.state,'',`/character/${shareCode}`);
          }

          const palette=readStoredPalette();
          if(palette&&shareCode&&editToken){
            await originalFetch(`/api/characters/${shareCode}/theme`,{
              method:'POST',
              headers:{'content-type':'application/json'},
              body:JSON.stringify({editToken,palette}),
            }).catch(()=>null);
            storePalette(palette,`${THEME_SHARE_PREFIX}${shareCode}`);
            const preview=payload.preview&&typeof payload.preview==='object'?payload.preview as Record<string,unknown>:null;
            if(preview){
              payload.preview={...preview,themePalette:palette};
              return patchedJsonResponse(response,payload);
            }
          }
        }catch{}
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
