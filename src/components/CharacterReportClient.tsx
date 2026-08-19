'use client';

import { useEffect, useState } from 'react';
import type { CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';
import { CompletedCharacterReportView, type CompletedDetailPayload } from '@/components/CompletedCharacterReportView';
import { PersonalityFlavorProvider } from '@/lib/loading-flavor';

export function CharacterReportClient({preview,completedDetail}:{preview:CharacterReportPreview;completedDetail?:CompletedDetailPayload|null}){
  const [creatorEditToken,setCreatorEditToken]=useState<string|undefined>(undefined);
  const [resolvedDetail,setResolvedDetail]=useState<CompletedDetailPayload|null>(completedDetail||null);

  useEffect(()=>{
    let cancelled=false;
    try{
      const token=localStorage.getItem(`chara_edit_${preview.shareCode}`)?.trim();
      if(!token)return;
      setCreatorEditToken(token);
      if(completedDetail?.complete||completedDetail?.canResume)return;

      void (async()=>{
        try{
          const r=await fetch(`/api/characters/${preview.shareCode}`,{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({stage:1,editToken:token}),
          });
          const body=await r.json().catch(()=>({}));
          if(!cancelled&&r.ok&&body?.detail){
            setResolvedDetail({...body.detail,canResume:true} as CompletedDetailPayload);
          }
        }catch{}
      })();
    }catch{}
    return()=>{cancelled=true};
  },[completedDetail,preview.shareCode]);

  const tagState=preview.personalityTags;
  const flavorTags=tagState
    ? tagState.finalAdaptive.length
      ? tagState.finalAdaptive
      : tagState.interviewAdaptive.length
        ? tagState.interviewAdaptive
        : tagState.ownerSelected.length
          ? tagState.ownerSelected
          : tagState.aiInitial.length
            ? tagState.aiInitial
            : null
    : null;

  return <PersonalityFlavorProvider tags={flavorTags}>
    {resolvedDetail
      ? <CompletedCharacterReportView preview={preview} detail={resolvedDetail}/>
      : <CharacterReportView preview={preview} creatorEditToken={creatorEditToken}/>
    }
  </PersonalityFlavorProvider>;
}
