'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';
import { AccessCodeModal } from '@/components/AccessCodeModal';

type DetailPayload={analysis:FinalAnalysis;confirmedFactCount:number;inferenceCount:number;cached?:boolean};

function paragraphChunks(text:string){
  const normalized=text.replace(/\r\n?/g,'\n').trim();
  if(!normalized)return[];
  return normalized
    .split(/\n{2,}/)
    .map(block=>block.replace(/[ \t]+/g,' ').replace(/\n+/g,' ').trim())
    .filter(Boolean);
}

function ParagraphText({text}:{text:string}){
  const chunks=paragraphChunks(text);
  return <div>{chunks.map((chunk,index)=><p key={`${index}-${chunk.slice(0,18)}`} style={{margin:index===0?0:'18px 0 0',lineHeight:1.85,color:'#444'}}>{chunk}</p>)}</div>;
}

function BulletList({items}:{items:string[]}){
  return <ul style={{margin:'0',paddingLeft:22,lineHeight:1.8,color:'#444'}}>{items.map((item,index)=><li key={`${index}-${item.slice(0,18)}`} style={{margin:index===0?0:'7px 0 0'}}>{item}</li>)}</ul>;
}

export function CharacterReportView({preview,creatorEditToken}:{preview:CharacterReportPreview;creatorEditToken?:string}){
  const [unlockOpen,setUnlockOpen]=useState(false);
  const [detail,setDetail]=useState<DetailPayload|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  function editToken(){
    if(creatorEditToken)return creatorEditToken;
    if(typeof window==='undefined')return '';
    return localStorage.getItem(`chara_edit_${preview.shareCode}`)||'';
  }

  async function loadDetail(code:string){
    setBusy(true);setError('');
    try{
      const token=editToken();
      const r=await fetch(`/api/characters/${preview.shareCode}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessCode:code,...(token?{editToken:token}:{})})});
      const body=await r.json();
      if(!r.ok){
        if(r.status===401){localStorage.removeItem('chara_ai_access_code');setUnlockOpen(true)}
        if(body?.error==='DETAIL_OWNER_SOURCE_REQUIRED'){
          setError('상세 리포트가 아직 생성되지 않았어요. 비밀 프로필과 20문항 원문을 안전하게 다시 읽기 위해 최초 1회는 이 캐릭터를 만든 브라우저에서 상세보기를 열어야 해요.');
        }else if(body?.error==='EDIT_TOKEN_INVALID'){
          setError('이 브라우저의 캐릭터 생성 권한을 확인하지 못했어요. 최초 상세 생성은 캐릭터를 만든 브라우저에서 진행해주세요.');
        }else{
          setError(body?.error==='CODE_INVALID'?'이용 코드를 다시 확인해주세요.':`상세 리포트를 불러오지 못했어요. (${body?.error||r.status})`);
        }
        return;
      }
      setDetail(body.detail);
      requestAnimationFrame(()=>document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'}));
    }finally{setBusy(false)}
  }

  function requestDetail(){if(detail){document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'});return}setUnlockOpen(true)}
  const summaryCards=[['겉으로 보이는 모습',preview.summary.outerSelf],['실제 내면',preview.summary.innerSelf],['갈등 방식',preview.summary.conflictStyle],['애정 표현',preview.summary.affectionStyle]] as const;
  const previewSections=[
    ['관계에서 반복되는 패턴','가까운 사람과 낯선 사람에게 적용하는 기준이 어떻게 달라지는지, 호의와 거절을 어떤 신호로 판단하는지, 관계가 깊어질수록 행동이 어떻게 바뀌는지를 여러 답변과 함께 연결합니다. 한 번의 선택만 보지 않고 반복되는 예외와 조건을 묶어서 관계의 흐름을 읽습니다.'],
    ['핵심 가치 · 욕구 · 두려움','캐릭터가 실제 선택에서 무엇을 우선하는지, 무엇을 얻고 싶어 하는지, 어떤 상태를 피하려 하는지를 프로필과 20문항 전체에서 다시 확인합니다. 겉으로 말하는 기준과 실제 행동이 다를 때에는 그 차이가 생기는 조건까지 함께 정리합니다.'],
    ['모순과 오해받기 쉬운 지점','서로 반대처럼 보이는 행동이 어떤 상황에서는 동시에 성립하는지, 다른 사람이 어떤 부분을 악의나 무관심으로 오해할 수 있는지 구체적으로 풀어냅니다. 단순히 모순이라고 이름 붙이지 않고 관계·상황·책임 범위에 따라 달라지는 기준을 찾아봅니다.'],
    ['통합 캐릭터 해석','유형별 결과를 따로 나열하는 대신 행동 원리, 관계 패턴, 감정 처리, 고유한 디테일이 하나의 캐릭터 안에서 어떻게 이어지는지 긴 흐름으로 통합합니다. 이전 답변의 이유와 예외 조건까지 다시 읽어 캐릭터를 한 문장 성격표가 아니라 실제로 움직이는 인물처럼 정리합니다.'],
  ] as const;

  return <>
    <AccessCodeModal open={unlockOpen} onClose={()=>setUnlockOpen(false)} onValidated={loadDetail} eyebrow="Detailed report" title="상세 리포트 열기" description="포스타입에서 결제 후 최신 이용 코드를 확인해 입력해주세요. 최초 생성 시 공개·비밀 프로필과 20문항 원문을 다시 읽어 상세 캐해를 만듭니다." submitLabel="코드 확인하고 상세 생성" />

    <div className="result-hero"><div><div className="eyebrow">Analysis complete</div><h1 style={{fontSize:'clamp(46px,7vw,80px)',marginBottom:12}}>{preview.name}</h1><p className="hero-copy" style={{fontSize:17}}>{preview.oneLineSummary}</p></div><div><div className="label">공유 코드</div><div className="share-code">{preview.shareCode}</div><button className="btn soft" style={{marginTop:10}} onClick={()=>navigator.clipboard.writeText(preview.shareCode)}>코드 복사</button></div></div>

    <div style={{marginTop:34}}><div className="eyebrow">Quick interpretation</div><h2 style={{marginTop:10}}>유형별 캐릭터 해석</h2><p className="muted" style={{lineHeight:1.7,maxWidth:720}}>20개의 답변과 프로필을 바탕으로 핵심만 먼저 요약했어요. 상세 원문은 결제 코드 확인 후에만 생성됩니다.</p></div>
    <div className="result-grid" style={{marginTop:20}}>{summaryCards.map(([title,text])=><section className="result-block" key={title}><h3>{title}</h3><ParagraphText text={text}/></section>)}</div>

    {!detail&&<section className="card" style={{marginTop:24,padding:'34px 28px',overflow:'hidden',position:'relative'}}>
      <div className="eyebrow">Full report preview</div><h2 style={{fontSize:'clamp(27px,4vw,40px)',marginTop:10}}>여기서 한 단계 더 들어가면</h2>
      <p style={{lineHeight:1.75,maxWidth:760,marginBottom:20}}>요약에서 보인 성향이 <strong>어떤 관계에서 달라지는지, 무엇을 가장 원하고 두려워하는지, 겉과 속의 모순이 어디서 생기는지</strong>까지 풀어서 볼 수 있어요.</p>
      <div className="tags" style={{marginBottom:18}}>{['유형별 해석','핵심 가치·욕구','두려움','관계·갈등 패턴','오해받는 지점','캐릭터의 모순','상세 통합 리포트'].map(x=><span className="tag" key={x}>{x}</span>)}</div>
      <div aria-hidden="true" style={{display:'grid',gap:12,position:'relative'}}>{previewSections.map(([title,t])=><div key={title} style={{border:'1px solid var(--line)',borderRadius:16,padding:'20px 22px',background:'white',minHeight:142}}><strong>{title}</strong><div style={{marginTop:10,filter:'blur(6px)',opacity:.58,userSelect:'none'}}><ParagraphText text={t}/></div></div>)}<div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,transparent 12%,rgba(255,253,248,.18) 58%,rgba(255,253,248,.72) 100%)',pointerEvents:'none'}}/></div>
      {busy&&<div role="status" aria-live="polite" style={{marginTop:22,padding:'18px 20px',borderRadius:16,background:'var(--accent-soft)'}}><div className="loading" style={{fontWeight:900}}>결제 확인 완료 · 원자료 재분석 중 <i className="dot"/><i className="dot"/><i className="dot"/></div><p className="muted" style={{margin:'8px 0 0',lineHeight:1.6}}>공개·비밀 프로필과 20문항 질문·답변·이유를 다시 읽어 상세 리포트를 만들고 있어요. 한 번 생성된 결과는 저장되어 다시 AI를 호출하지 않습니다.</p></div>}
      {error&&<p className="error">{error}</p>}
      <div className="actions" style={{justifyContent:'center',marginTop:24}}><button className="btn primary" disabled={busy} onClick={requestDetail}>{busy?'상세 리포트 생성 중…':'더 자세히 보기'}</button><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
    </section>}

    {detail&&<div id="paid-detail-report" style={{scrollMarginTop:90,marginTop:34}}>
      <div className="eyebrow">Unlocked · Detailed report</div><h2 style={{marginTop:10}}>상세 캐릭터 리포트</h2><p className="muted" style={{lineHeight:1.7,maxWidth:760}}>프로필과 20문항 원자료를 다시 읽어 만든 유형별 긴 해석과 통합 캐해입니다.</p>
      <div className="result-grid" style={{marginTop:20}}>
        <section className="result-block"><h3>겉으로 보이는 모습</h3><ParagraphText text={detail.analysis.outerSelf}/></section><section className="result-block"><h3>실제 내면</h3><ParagraphText text={detail.analysis.innerSelf}/></section><section className="result-block"><h3>갈등 방식</h3><ParagraphText text={detail.analysis.conflictStyle}/></section><section className="result-block"><h3>애정 표현</h3><ParagraphText text={detail.analysis.affectionStyle}/></section>
        <section className="result-block"><h3>핵심 가치</h3><BulletList items={detail.analysis.coreValues}/></section><section className="result-block"><h3>핵심 욕망</h3><BulletList items={detail.analysis.desires}/></section><section className="result-block"><h3>두려워하는 것</h3><BulletList items={detail.analysis.fears}/></section>
        <section className="result-block"><h3>쉽게 오해받는 부분</h3><BulletList items={detail.analysis.misunderstoodPoints}/></section><section className="result-block"><h3>캐릭터의 모순</h3><BulletList items={detail.analysis.contradictions}/></section><section className="result-block"><h3>AI가 발견한 흥미로운 지점</h3><BulletList items={detail.analysis.interestingPoints}/></section>
      </div>
      <section className="card" style={{marginTop:22,padding:'32px'}}><div className="eyebrow">Deep report</div><h2 style={{fontSize:'clamp(28px,4vw,42px)',marginTop:10}}>통합 상세 해석</h2>{detail.analysis.detailedReport?<div style={{fontSize:17}}><ParagraphText text={detail.analysis.detailedReport}/></div>:<p className="muted">이 캐릭터는 상세 리포트 기능 추가 이전 버전으로 생성되어 기존 유형별 해석만 제공됩니다.</p>}</section>
      <div className="actions"><button className="btn" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>↑ 요약으로 올라가기</button><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
    </div>}
  </>;
}
