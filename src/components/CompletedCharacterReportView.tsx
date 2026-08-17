'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';

export type CompletedDetailPayload={
  analysis:FinalAnalysis;
  confirmedFactCount:number;
  inferenceCount:number;
  cached?:boolean;
  stageReady?:number;
  complete?:boolean;
};

function paragraphChunks(text:string){
  return text.replace(/\r\n?/g,'\n').trim().split(/\n{2,}/).map(block=>block.replace(/[ \t]+/g,' ').replace(/\n+/g,' ').trim()).filter(Boolean);
}

function ParagraphText({text}:{text:string}){
  return <div>{paragraphChunks(text).map((chunk,index)=>{
    const lead=chunk.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
    return <p key={`${index}-${chunk.slice(0,18)}`} style={{margin:index===0?0:'18px 0 0',lineHeight:1.85,color:'#444'}}>
      {lead?<><strong style={{color:'#222'}}>{lead[1]}</strong>{lead[2]?<> {lead[2]}</>:null}</>:chunk}
    </p>;
  })}</div>;
}

function NarrativeSection({title,text,index}:{title:string;text?:string;index:number}){
  if(!text?.trim())return null;
  return <section className="card" style={{marginTop:index===0?20:18,padding:'32px'}}>
    <h2 style={{fontSize:'clamp(27px,4vw,40px)',margin:'0 0 20px'}}>{title}</h2>
    <div style={{fontSize:16.5}}><ParagraphText text={text}/></div>
  </section>;
}

function LegacySection({title,text}:{title:string;text?:string}){
  if(!text?.trim())return null;
  return <section className="result-block"><h3>{title}</h3><ParagraphText text={text}/></section>;
}

export function CompletedCharacterReportView({preview,detail}:{preview:CharacterReportPreview;detail:CompletedDetailPayload}){
  const [reportPage,setReportPage]=useState<1|2|3>(1);
  const [savedDetail,setSavedDetail]=useState(detail);
  const resumeAttempts=useRef(new Set<number>());
  const analysis=savedDetail.analysis;
  const isPaged=Boolean(analysis.characterOverview?.trim());
  const stageReady=Math.max(1,Math.min(3,savedDetail.stageReady||3));

  useEffect(()=>{
    if(!isPaged||stageReady>=3)return;
    const nextStage=(stageReady+1) as 2|3;
    if(resumeAttempts.current.has(nextStage))return;
    resumeAttempts.current.add(nextStage);
    void (async()=>{
      try{
        const r=await fetch(`/api/characters/${preview.shareCode}/resume-detail`,{
          method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stage:nextStage}),
        });
        const body=await r.json().catch(()=>({}));
        if(!r.ok||!body?.detail)return;
        setSavedDetail(current=>({
          ...current,
          ...body.detail,
          analysis:{...current.analysis,...body.detail.analysis},
        }));
      }catch{}
    })();
  },[isPaged,preview.shareCode,stageReady]);

  function changePage(next:1|2|3){
    if(next>stageReady)return;
    setReportPage(next);
    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'auto'}));
  }

  return <>
    <div className="page-head" style={{marginBottom:24}}>
      <h1 style={{fontSize:'clamp(42px,6vw,72px)',marginBottom:0}}>{preview.name} 정밀 분석</h1>
    </div>

    <div id="paid-detail-report">
      <h2 style={{marginTop:0}}>상세 캐릭터 리포트</h2>

      {isPaged?<>
        <div style={{marginTop:20}}><strong>페이지 {reportPage} / 3</strong></div>

        {reportPage===1&&<>
          <NarrativeSection index={0} title={`${preview.name}는 이런 캐릭터예요`} text={analysis.characterOverview}/>
          <NarrativeSection index={1} title={`${preview.name}는 이렇게 작동해요`} text={analysis.innerMechanics}/>
        </>}
        {reportPage===2&&<>
          <NarrativeSection index={2} title={`${preview.name}는 이렇게 관계를 맺어요`} text={analysis.relationshipStyle}/>
          <NarrativeSection index={3} title={`${preview.name}는 이런 애착이 있어요`} text={analysis.attachmentStyle}/>
          <NarrativeSection index={4} title={`${preview.name}는 이렇게 갈등해요`} text={analysis.conflictStyleDetailed}/>
        </>}
        {reportPage===3&&<>
          <NarrativeSection index={5} title={`${preview.name}에겐 이런 매력이 있어요`} text={analysis.charmAndContradictions}/>
          <NarrativeSection index={6} title="통합 리포트" text={analysis.integratedReport}/>
        </>}

        <div className="actions" style={{justifyContent:'space-between',marginTop:24,flexWrap:'nowrap',overflowX:'auto',alignItems:'center'}}>
          <Link className="btn" style={{whiteSpace:'nowrap'}} href="/analyze">다른 캐릭터 분석</Link>
          <div style={{display:'flex',gap:10,flexWrap:'nowrap',flexShrink:0,marginLeft:'auto'}}>
            {reportPage>1&&<button className="btn" style={{whiteSpace:'nowrap'}} onClick={()=>changePage((reportPage-1) as 1|2)}>← 이전 페이지</button>}
            {reportPage<stageReady&&<button className="btn primary" style={{whiteSpace:'nowrap'}} onClick={()=>changePage((reportPage+1) as 2|3)}>다음 페이지 →</button>}
          </div>
        </div>
      </>:<>
        <div className="result-grid" style={{marginTop:20}}>
          <LegacySection title="겉으로 보이는 모습" text={analysis.outerSelf}/>
          <LegacySection title="실제 내면" text={analysis.innerSelf}/>
          <LegacySection title="갈등 방식" text={analysis.conflictStyle}/>
          <LegacySection title="애정 표현" text={analysis.affectionStyle}/>
          <LegacySection title="본질적인 성격" text={analysis.corePersonality}/>
          <LegacySection title="감정 구조" text={analysis.emotionalStructure}/>
          <LegacySection title="대인관계 방식" text={analysis.relationshipPattern}/>
          <LegacySection title="애착·친밀감" text={analysis.attachmentPattern}/>
          <LegacySection title="가치관과 극한상황" text={analysis.moralAndExtremeChoices}/>
        </div>
        {analysis.detailedReport&&<section className="card" style={{marginTop:22,padding:'32px'}}><h2 style={{fontSize:'clamp(28px,4vw,42px)',marginTop:0}}>통합 상세 해석</h2><div style={{fontSize:17}}><ParagraphText text={analysis.detailedReport}/></div></section>}
        <div className="actions" style={{marginTop:24}}><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
      </>}
    </div>
  </>;
}
