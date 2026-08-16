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
  cached?: boolean;
};

export function CharacterReportView({ preview }: { preview: CharacterReportPreview }) {
  const [unlockOpen,setUnlockOpen]=useState(false);
  const [detail,setDetail]=useState<DetailPayload|null>(null);
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
        if(r.status===401){
          localStorage.removeItem('chara_ai_access_code');
          setUnlockOpen(true);
        }
        setError(body?.error==='CODE_INVALID'?'이용 코드를 다시 확인해주세요.':`상세 리포트를 불러오지 못했어요. (${body?.error||r.status})`);
        return;
      }
      setDetail(body.detail);
      requestAnimationFrame(()=>document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'}));
    }finally{setBusy(false)}
  }

  function requestDetail(){
    if(detail){
      document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'});
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

  return <>
    <AccessCodeModal
      open={unlockOpen}
      onClose={()=>setUnlockOpen(false)}
      onValidated={loadDetail}
      eyebrow="Detailed report"
      title="상세 리포트 열기"
      description="포스타입에서 결제 후 최신 이용 코드를 확인해 입력해주세요. 코드가 확인된 뒤에만 상세 AI 분석이 생성됩니다."
      submitLabel="코드 확인하고 상세 생성"
    />

    <div className="result-hero">
      <div>
        <div className="eyebrow">Analysis complete</div>
        <h1 style={{fontSize:'clamp(46px,7vw,80px)',marginBottom:12}}>{preview.name}</h1>
        <p className="hero-copy" style={{fontSize:17}}>{preview.oneLineSummary}</p>
      </div>
      <div><div className="label">공유 코드</div><div className="share-code">{preview.shareCode}</div><button className="btn soft" style={{marginTop:10}} onClick={()=>navigator.clipboard.writeText(preview.shareCode)}>코드 복사</button></div>
    </div>

    <div style={{marginTop:34}}>
      <div className="eyebrow">Quick interpretation</div>
      <h2 style={{marginTop:10}}>유형별 캐릭터 해석</h2>
      <p className="muted" style={{lineHeight:1.7,maxWidth:720}}>20개의 답변과 프로필을 바탕으로 핵심만 먼저 요약했어요. 상세 원문은 결제 코드 확인 후에만 생성됩니다.</p>
    </div>
    <div className="result-grid" style={{marginTop:20}}>{summaryCards.map(([title,text])=><section className="result-block" key={title}><h3>{title}</h3><p>{text}</p></section>)}</div>

    {!detail&&<section className="card" style={{marginTop:24,padding:'34px 28px',overflow:'hidden',position:'relative'}}>
      <div className="eyebrow">Full report preview</div>
      <h2 style={{fontSize:'clamp(27px,4vw,40px)',marginTop:10}}>여기서 한 단계 더 들어가면</h2>
      <p style={{lineHeight:1.75,maxWidth:760,marginBottom:20}}>요약에서 보인 성향이 <strong>어떤 관계에서 달라지는지, 무엇을 가장 원하고 두려워하는지, 겉과 속의 모순이 어디서 생기는지</strong>까지 풀어서 볼 수 있어요.</p>

      <div className="tags" style={{marginBottom:18}}>
        {['유형별 해석 원문','핵심 가치·욕구','두려움','관계·갈등 패턴','오해받는 지점','캐릭터의 모순','상세 통합 리포트'].map(x=><span className="tag" key={x}>{x}</span>)}
      </div>

      <div aria-hidden="true" style={{display:'grid',gap:12,position:'relative'}}>
        {[
          ['관계에서 반복되는 패턴','가까워질수록 달라지는 기준과 예외 조건, 상대의 반응에 따라 바뀌는 행동의 흐름을 구체적으로 분석합니다.'],
          ['핵심 가치 · 욕구 · 두려움','캐릭터가 실제 선택에서 무엇을 우선하는지, 겉으로 드러나는 말과 안쪽 동기가 어디서 어긋나는지 연결합니다.'],
          ['모순과 오해받기 쉬운 지점','서로 반대처럼 보이는 행동이 어떤 조건에서는 동시에 성립하는지, 다른 사람이 어떻게 오해할 수 있는지 풀어냅니다.'],
        ].map(([title,text])=><div key={title} style={{border:'1px solid var(--line)',borderRadius:16,padding:'18px 20px',background:'white'}}><strong>{title}</strong><p style={{margin:'10px 0 0',lineHeight:1.7,filter:'blur(6px)',opacity:.58,userSelect:'none'}}>{text} {text}</p></div>)}
        <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,transparent 18%,rgba(255,253,248,.28) 55%,rgba(255,253,248,.82) 100%)',pointerEvents:'none'}}/>
      </div>

      {busy&&<div role="status" aria-live="polite" style={{marginTop:22,padding:'18px 20px',borderRadius:16,background:'var(--accent-soft)'}}>
        <div className="loading" style={{fontWeight:900}}>결제 확인 완료 · 상세 리포트 생성 중 <i className="dot"/><i className="dot"/><i className="dot"/></div>
        <p className="muted" style={{margin:'8px 0 0',lineHeight:1.6}}>이제 처음으로 상세 AI 분석을 만들고 있어요. 한 번 생성된 결과는 저장되어 다음부터는 다시 생성하지 않습니다.</p>
      </div>}
      {error&&<p className="error">{error}</p>}

      <div className="actions" style={{justifyContent:'center',marginTop:24}}>
        <button className="btn primary" disabled={busy} onClick={requestDetail}>{busy?'상세 리포트 생성 중…':'더 자세히 보기'}</button>
        <Link className="btn" href="/analyze">다른 캐릭터 분석</Link>
      </div>
    </section>}

    {detail&&<div id="paid-detail-report" style={{scrollMarginTop:90,marginTop:34}}>
      <div className="eyebrow">Unlocked · Detailed report</div>
      <h2 style={{marginTop:10}}>상세 캐릭터 리포트</h2>
      <p className="muted" style={{lineHeight:1.7,maxWidth:760}}>유형별 긴 해석과 핵심 가치·욕구·두려움, 모순과 관계 패턴을 같은 페이지에서 이어서 확인할 수 있어요.</p>

      <div className="result-grid" style={{marginTop:20}}>
        <section className="result-block"><h3>겉으로 보이는 모습 · 원문</h3><p>{detail.analysis.outerSelf}</p></section>
        <section className="result-block"><h3>실제 내면 · 원문</h3><p>{detail.analysis.innerSelf}</p></section>
        <section className="result-block"><h3>갈등 방식 · 원문</h3><p>{detail.analysis.conflictStyle}</p></section>
        <section className="result-block"><h3>애정 표현 · 원문</h3><p>{detail.analysis.affectionStyle}</p></section>
        <section className="result-block"><h3>핵심 가치</h3><div className="tags">{detail.analysis.coreValues.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
        <section className="result-block"><h3>핵심 욕망</h3><div className="tags">{detail.analysis.desires.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
        <section className="result-block"><h3>두려워하는 것</h3><div className="tags">{detail.analysis.fears.map(x=><span className="tag" key={x}>{x}</span>)}</div></section>
        <section className="result-block"><h3>쉽게 오해받는 부분</h3><p>{detail.analysis.misunderstoodPoints.map(x=>`• ${x}`).join('\n')}</p></section>
        <section className="result-block"><h3>캐릭터의 모순</h3><p>{detail.analysis.contradictions.map(x=>`• ${x}`).join('\n')}</p></section>
        <section className="result-block"><h3>AI가 발견한 흥미로운 지점</h3><p>{detail.analysis.interestingPoints.map(x=>`• ${x}`).join('\n')}</p></section>
      </div>

      <section className="card" style={{marginTop:22,padding:'32px'}}>
        <div className="eyebrow">Deep report</div>
        <h2 style={{fontSize:'clamp(28px,4vw,42px)',marginTop:10}}>통합 상세 해석</h2>
        {detail.analysis.detailedReport
          ? <p style={{fontSize:17,lineHeight:1.9,whiteSpace:'pre-line',marginBottom:0}}>{detail.analysis.detailedReport}</p>
          : <p className="muted">이 캐릭터는 상세 리포트 기능 추가 이전 버전으로 생성되어 기존 유형별 원문만 제공됩니다.</p>}
      </section>

      <section className="card" style={{marginTop:18}}><h3>분석 근거 요약</h3><div className="two-col"><div><div className="label">프로필/답변에서 확인된 사실</div><p className="muted">{detail.confirmedFactCount}개</p></div><div><div className="label">오너 검수를 통과한 AI 추론</div><p className="muted">{detail.inferenceCount}개</p></div></div></section>
      <div className="actions"><button className="btn" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>↑ 요약으로 올라가기</button><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
    </div>}
  </>;
}
