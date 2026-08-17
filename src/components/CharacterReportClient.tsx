'use client';

import { useEffect, useState } from 'react';
import type { CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';

export function CharacterReportClient({preview}:{preview:CharacterReportPreview}){
  const [creatorEditToken,setCreatorEditToken]=useState<string|undefined>(undefined);

  useEffect(()=>{
    try{
      const token=localStorage.getItem(`chara_edit_${preview.shareCode}`)?.trim();
      if(token)setCreatorEditToken(token);
    }catch{}
  },[preview.shareCode]);

  return <CharacterReportView preview={preview} creatorEditToken={creatorEditToken}/>;
}
