'use client';

import { useEffect } from 'react';
import { applyCharacterThemePalette, resetCharacterThemePalette } from '@/lib/character-theme-client';
import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const SHARE_PREFIX='chara_theme_';
const SHARE_PATH_RE=/^\/character\/([A-HJ-NP-Z2-9]{8})$/;

function storedPalette(shareCode:string):CharacterThemePalette|null{
  try{
    const raw=localStorage.getItem(`${SHARE_PREFIX}${shareCode}`);
    if(!raw)return null;
    const parsed=themePaletteSchema.safeParse(JSON.parse(raw));
    return parsed.success?parsed.data:null;
  }catch{return null}
}

// Read window.location directly instead of depending on Next router state. A freshly
// finalized analysis changes the URL with history.replaceState while keeping the
// current React tree, so usePathname can be too late for the first report paint.
export function StoredReportThemeBridge(){
  useEffect(()=>{
    let disposed=false;
    let activeCode='';
    let fetchedCode='';
    let applied=false;
    let requestSerial=0;

    const apply=(shareCode:string,palette:CharacterThemePalette)=>{
      if(disposed)return;
      applied=applyCharacterThemePalette(palette)||applied;
      try{localStorage.setItem(`${SHARE_PREFIX}${shareCode}`,JSON.stringify(palette))}catch{}
    };

    const fetchPalette=(shareCode:string)=>{
      if(fetchedCode===shareCode)return;
      fetchedCode=shareCode;
      const serial=++requestSerial;
      void fetch(`/api/characters/${shareCode}`,{cache:'no-store'})
        .then(r=>r.ok?r.json():null)
        .then(body=>{
          if(disposed||serial!==requestSerial)return;
          const parsed=themePaletteSchema.safeParse(body?.preview?.themePalette);
          if(parsed.success)apply(shareCode,parsed.data);
        })
        .catch(()=>{});
    };

    const sync=()=>{
      if(disposed)return;
      const match=window.location.pathname.match(SHARE_PATH_RE);
      const reportVisible=Boolean(document.querySelector('.report-mag'));

      if(!match||!reportVisible){
        if(activeCode&&applied){
          resetCharacterThemePalette();
          applied=false;
        }
        activeCode='';
        fetchedCode='';
        requestSerial+=1;
        return;
      }

      const shareCode=match[1];
      if(activeCode!==shareCode){
        activeCode=shareCode;
        fetchedCode='';
        requestSerial+=1;
        const cached=storedPalette(shareCode);
        if(cached)apply(shareCode,cached);
      }
      fetchPalette(shareCode);
    };

    sync();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      queueMicrotask(()=>{queued=false;sync()});
    });
    observer.observe(document.body,{childList:true,subtree:true});
    const interval=window.setInterval(sync,300);
    window.addEventListener('popstate',sync);
    window.addEventListener('character-report-url-ready',sync);

    return()=>{
      disposed=true;
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('popstate',sync);
      window.removeEventListener('character-report-url-ready',sync);
      requestSerial+=1;
      if(applied)resetCharacterThemePalette();
    };
  },[]);

  return null;
}
