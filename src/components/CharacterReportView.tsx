'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';
import { AccessCodeModal } from '@/components/AccessCodeModal';

type DetailPayload = {
  analysis: FinalAnalysis;
  confirmedFactCount: number;
  inferenceCount: number;
};

export function CharacterReportView({ preview }: { preview: CharacterReportPreview }) {
  const [unlockOpen,setUnlockOpen]=useState(false);
  const [detail,setDetail]=useState<DetailPayload|null>(null);
  const [view,setView]=useState<'summary'|'detail'>('summary');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function loadDetail(code:string){
    setBusy(true); setError('');
    try{
      const r=await fetch(`/api/characters/${preview.shareCode}`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({accessCode:code}),
      });
      const body=await r.json();
      if(!r.ok){
        setError(body?.error==='CODE_INVALID'?'이용 코드를 다시 확인해주세요.':`상세 리포트를 불러오지 못했어요. (${body?.error||r.status})`);
        return;
      }
      setDetail(body.detail);
      setView('detail');
      if(typeof window!=='undefined') window.scrollTo({top:0,behavior:'smooth'});
    }finally{setBusy(false)}
  }

  async function requestDetail(){
    if(detail){
      setView('detail');
      if(typeof window!=='undefined') window.scrollTo({top:0,behavior:'smooth'});
      return;
    }
    setUnlockOpen(true);
  }

  const summaryCards=[
    ['겉으로 보이는 모습',preview.summary.outerSelf],
    ['실제 내면',preview.summary.innerSelf],
    ['갈등 방식',preview.summary.conflictStyle],
    ['애정 표현',preview.summary.affectionStyle],
  ] as const;

  if(view==='detail'&&detail){
    const a=detail.analysis;
    return <>
      <AccessCodeModal open={unlockOpen} onClose={()=>setUnlockOpen(false)} onValidated={loadDetail} eyebrow="Detailed report" title="상세 리포트 열기" description="포스타입 유료 영역의 최신 이용 코드를 입력하면 유형별 해석 원문과 상세 리포트를 볼 수 있어요." submitLabel="상세 리포트 열기" />
      <div className="result-hero">
        <div>
          <div className="eyebrow">Detailed character report</div>
          <h1 style={{fontSize:'clamp(46px,7vw,80px)',marginBottom:12}}>{preview.name}</h1>
          <p className="hero-copy" style={{fontSize:17}}>{a.oneLineSummary}</p>
        </div>
        <div><div className="label">공유 코드</div><div className="share-code">{preview.shareCode}</div></div>
      </div>

      <div className="actions" style={{marginTop:20,marginBottom:30}}><button className="btn" onClick={()=>setView('summary')}>← 요약으로 돌아가기</button><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>

      <div className="eyebrow">Original analysis</div>
      <h2 style={{marginTop:10}}>유형별 해석 원문</h2>
      <div className="result-grid">
        <section className="result-block"><h3>겉으로 보이는 모습</h3><p>{a.outerSelf}</p></section>
        <section className="result-block"><h3>실제 내면</h3><p>{a.innerSelf}</p></section>
        <section className="result-block"><h3>갈등 방식</h3><p>{a.conflictStyle}</p></section>
        <section className="result-block"><h3>애정 표현</h3><p>{a.affectionStyle}</p></section>
        <section className="result-block"><h3>핵심 가치</h3><div className="tags">{a.coreValues.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
        <section className="result-block"><h3>핵심 욕망</h3><div className="tags">{a.desires.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
        <section className="result-block"><h3>두려워하는 것</h3><div className="tags">{a.fears.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
        <section className="result-block"><h3>쉽게 오해받는 부분</h3><p>{a.misunderstoodPoints.map(x=>`• ${x}`).join('\n')}</p></section>
        <section className="result-block"><h3>캐릭터의 모순</h3><p>{a.contradictions.map(x=>`• ${x}`).join('\n')}</p></section>
        <section className="result-block"><h3>AI가 발견한 흥미로운 지점</h3><p>{a.interestingPoints.map(x=>`• ${x}`).join('\n')}</p></section>
      </div>

      <section className="card" style={{marginTop:22,padding:'32px'}}>
        <div className="eyebrow">Deep report</div>
        <h2 style={{fontSize:'clamp(28px,4vw,42px)',marginTop:10}}>상세 캐릭터 리포트</h2>
        {a.detailedReport
          ? <p style={{fontSize:17,lineHeight:1.9,whiteSpace:'pre-line',marginBottom:0}}>{a.detailedReport}</p>
          : <p className="muted" style={{lineHeight:1.8}}>이 캐릭터는 상세 리포트 기능이 추가되기 전 분석 버전으로 생성됐어요. 위 유형별 해석 원문과 항목별 결과는 그대로 확인할 수 있습니다.</p>}
      </section>

      <section className="card" style={{marginTop:18}}><h3>분석 근거 요약</h3><div className="two-col"><div><div className="label">프로필/답변에서 확인된 사실</div><p className="muted">{detail.confirmedFactCount}개</p></div><div><div className="label">오너 검수를 통과한 AI 추론</div><p className="muted">{detail.inferenceCount}개</p></div></div></section>
      {error&&<p className="error">{error}</p>}
    </>;
  }

  return <>
    <AccessCodeModal open={unlockOpen} onClose={()=>setUnlockOpen(false)} onValidated={loadDetail} eyebrow="Detailed report" title="상세 리포트 열기" description="포스타입 유료 영역의 최신 이용 코드를 입력하면 유형별 해석 원문과 상세 리포트를 볼 수 있어요." submitLabel="상세 리포트 열기" />
    <div className="result-hero">
      <div>
        <div className="eyebrow">Analysis complete</div>
        <h1 style={{fontSize:'clamp(46px,7vw,80px)',marginBottom:12}}>{preview.name}</h1>
        <p className="hero-copy" style={{fontSize:17}}>{preview.oneLineSummary}</p>
      </div>
      <div><div className="label">공유 코드</div><div className="share-code">{preview.shareCode}</div><button className="btn soft" style={{marginTop:10}} onClick={()=>navigator.clipboard.writeText(preview.shareCode)}>코드 복사</button></div>
    </div>

    <div style={{marginTop:34}}><div className="eyebrow">Quick interpretation</div><h2 style={{marginTop:10}}>유형별 캐릭터 해석</h2><p className="muted" style={{lineHeight:1.7,maxWidth:720}}>20개의 답변과 프로필을 바탕으로 핵심만 먼저 요약했어요. 자세한 근거와 긴 해석은 상세 리포트에서 확인할 수 있습니다.</p></div>
    <div className="result-grid" style={{marginTop:20}}>{summaryCards.map(([title,text])=><section className="result-block" key={title}><h3>{title}</h3><p>{text}</p></section>)}</div>

    <section className="card" style={{marginTop:24,textAlign:'center',padding:'38px 24px'}}>
      <div className="eyebrow">Full report</div>
      <h2 style={{fontSize:'clamp(27px,4vw,40px)',marginTop:10}}>이 캐릭터를 더 깊게 볼까요?</h2>
      <p className="muted" style={{lineHeight:1.7,maxWidth:650,margin:'0 auto'}}>유형별 해석 원문과 핵심 가치·욕구·두려움·모순, 그리고 프로필과 20문항을 종합한 상세 리포트를 확인할 수 있어요.</p>
      {error&&<p className="error">{error}</p>}
      <div className="actions" style={{justifyContent:'center'}}><button className="btn primary" disabled={busy} onClick={requestDetail}>{busy?'상세 리포트 불러오는 중…':'더 자세히 보기'}</button><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
    </section>
  </>;
}
