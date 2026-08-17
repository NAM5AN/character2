'use client';

import { useEffect, useState } from 'react';
import type { CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';
import { CompletedCharacterReportView, type CompletedDetailPayload } from '@/components/CompletedCharacterReportView';

export function CharacterReportClient({preview,completedDetail}:{preview:CharacterReportPreview;completedDetail?:CompletedDetailPayload|null}){
  const [creatorEditToken,setCreatorEditToken]=useState<string|undefined>(undefined);

  useEffect(()=>{
    try{
      const token=localStorage.getItem(`chara_edit_${preview.shareCode}`)?.trim();
      if(token)setCreatorEditToken(token);
    }catch{}
  },[preview.shareCode]);

  if(completedDetail){
    return <CompletedCharacterReportView preview={preview} detail={completedDetail}/>;
  }

  return <CharacterReportView preview={preview} creatorEditToken={creatorEditToken}/>;
}
