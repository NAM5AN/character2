'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';
import { applyName } from '@/lib/josa';
import { DesireGapBlock, MatchProfileBlock, RelationshipManualBlock, PressureStagesBlock } from '@/components/ReportBlocks';

export type CompletedDetailPayload={
  analysis:FinalAnalysis;
  confirmedFactCount:number;
  inferenceCount:number;
  cached?:boolean;
  stageReady?:number;
  complete?:boolean;
  canResume?:boolean;
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

// 섹션/카드 제목 아래 스캔용 키워드 pill. 태그가 없으면 아무것도 렌더하지 않는다.
function KeywordTags({tags}:{tags?:string[]}){
  if(!tags?.length)return null;
  return <div className="kw-tags">{tags.slice(0,4).map((tag,index)=><span className="kw" key={`${index}-${tag}`}>#{tag}</span>)}</div>;
}

function NarrativeSection({title,text,index,tags,extra}:{title:string;text?:string;index:number;tags?:string[];extra?:ReactNode}){
  if(!text?.trim())return null;
  return <section className="card" style={{marginTop:index===0?20:18,padding:'32px'}}>
    <h2 style={{fontSize:'clamp(27px,4vw,40px)',margin:'0 0 20px'}}>{title}</h2>
    <div style={{fontSize:16.5}}><KeywordTags tags={tags}/><ParagraphText text={text}/>{extra}</div>
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
  const summary=preview.summary;
  const richSummary=Boolean(summary?.misunderstoodPoint?.trim()&&summary?.hiddenPattern?.trim());
  const summaryTags=preview.summaryTags;
  const summaryCards:[string,string,string][]=richSummary?[
    ['겉으로 보이는 모습',summary?.outerSelf||'','outerSelf'],
    ['실제 내면',summary?.innerSelf||'','innerSelf'],
    ['감정이 흔들리는 순간',summary?.conflictStyle||'','conflictStyle'],
    ['관계에서 반복되는 패턴',summary?.affectionStyle||'','affectionStyle'],
    ['쉽게 오해받는 부분',summary?.misunderstoodPoint||'','misunderstoodPoint'],
    ['의외로 눈에 띄는 지점',summary?.hiddenPattern||'','hiddenPattern'],
  ]:[
    ['겉으로 보이는 모습',summary?.outerSelf||'','outerSelf'],
    ['실제 내면',summary?.innerSelf||'','innerSelf'],
    ['갈등 방식',summary?.conflictStyle||'','conflictStyle'],
    ['애정 표현',summary?.affectionStyle||'','affectionStyle'],
  ];

  useEffect(()=>{
    if(!savedDetail.canResume||!isPaged||stageReady>=3)return;
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
          canResume:true,
          analysis:{...current.analysis,...body.detail.analysis},
        }));
      }catch{}
    })();
  },[isPaged,preview.shareCode,savedDetail.canResume,stageReady]);

  function changePage(next:1|2|3){
    if(next>stageReady)return;
    setReportPage(next);
    document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'auto',block:'start'});
  }

  return <>
    <div className="page-head" style={{marginBottom:20}}>
      <h1 style={{fontSize:'clamp(42px,6vw,72px)',marginBottom:0}}>{preview.name} 정밀 분석</h1>
    </div>

    {preview.oneLineSummary&&<p className="hero-copy" style={{fontSize:17,margin:'0 0 8px',maxWidth:860}}>{preview.oneLineSummary}</p>}
    <div style={{marginTop:22}}><h2 style={{marginTop:0}}>유형별 캐릭터 해석</h2></div>
    <div className="result-grid summary-type-grid" style={{marginTop:18}}>{summaryCards.map(([title,text,key])=><section className="result-block" key={title}><h3>{title}</h3><KeywordTags tags={summaryTags?.[key]}/><ParagraphText text={text}/></section>)}</div>

    <div id="paid-detail-report" style={{marginTop:38,scrollMarginTop:90}}>
      <h2 style={{marginTop:0}}>상세 캐릭터 리포트</h2>

      {isPaged?<>
        <div style={{marginTop:20}}><strong>페이지 {reportPage} / 3</strong></div>

        {reportPage===1&&<>
          <NarrativeSection index={0} title={applyName('{name}는 이런 캐릭터예요', preview.name)} text={analysis.characterOverview} tags={analysis.sectionTags?.characterOverview}/>
          <NarrativeSection index={1} title={applyName('{name}는 이렇게 작동해요', preview.name)} text={analysis.innerMechanics} tags={analysis.sectionTags?.innerMechanics} extra={<DesireGapBlock data={analysis.desireGap}/>}/>
        </>}
        {reportPage===2&&<>
          <NarrativeSection index={2} title={applyName('{name}는 이렇게 관계를 맺어요', preview.name)} text={analysis.relationshipStyle} tags={analysis.sectionTags?.relationshipStyle} extra={<RelationshipManualBlock data={analysis.relationshipManual}/>}/>
          <NarrativeSection index={3} title={applyName('{name}는 이런 애착이 있어요', preview.name)} text={analysis.attachmentStyle} tags={analysis.sectionTags?.attachmentStyle} extra={<MatchProfileBlock data={analysis.matchProfile}/>}/>
          <NarrativeSection index={4} title={applyName('{name}는 이렇게 갈등해요', preview.name)} text={analysis.conflictStyleDetailed} tags={analysis.sectionTags?.conflictStyleDetailed} extra={<PressureStagesBlock data={analysis.pressureStages}/>}/>
        </>}
        {reportPage===3&&<>
          <NarrativeSection index={5} title={applyName('{name}에겐 이런 매력이 있어요', preview.name)} text={analysis.charmAndContradictions} tags={analysis.sectionTags?.charmAndContradictions}/>
          <NarrativeSection index={6} title="통합 리포트" text={analysis.integratedReport} tags={analysis.sectionTags?.integratedReport}/>
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
