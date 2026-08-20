'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applyCharacterThemePalette, resetCharacterThemePalette } from '@/lib/character-theme-client';
import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const SHARE_PREFIX='chara_theme_';

function storedPalette(shareCode:string):CharacterThemePalette|null{
  try{
    const raw=localStorage.getItem(`${SHARE_PREFIX}${shareCode}`);
    if(!raw)return null;
    const parsed=themePaletteSchema.safeParse(JSON.parse(raw));
    return parsed.success?parsed.data:null;
  }catch{return null}
}

export function StoredReportThemeBridge(){
  const pathname=usePathname();

  useEffect(()=>{
    const match=pathname.match(/^\/character\/([A-HJ-NP-Z2-9]{8})$/);
    if(!match)return;
    const shareCode=match[1];
    let disposed=false;
    let applied=false;

    const apply=(palette:CharacterThemePalette)=>{
      if(disposed)return;
      applied=applyCharacterThemePalette(palette)||applied;
      try{localStorage.setItem(`${SHARE_PREFIX}${shareCode}`,JSON.stringify(palette))}catch{}
    };

    const cached=storedPalette(shareCode);
    if(cached)apply(cached);

    void fetch(`/api/characters/${shareCode}`,{cache:'no-store'})
      .then(r=>r.ok?r.json():null)
      .then(body=>{
        const parsed=themePaletteSchema.safeParse(body?.preview?.themePalette);
        if(parsed.success)apply(parsed.data);
      })
      .catch(()=>{});

    return()=>{
      disposed=true;
      if(applied)resetCharacterThemePalette();
    };
  },[pathname]);

  return null;
}
