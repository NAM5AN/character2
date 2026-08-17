'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';
import { AccessCodeModal } from '@/components/AccessCodeModal';

type DetailPayload={analysis:FinalAnalysis;confirmedFactCount:number;inferenceCount:number;cached?:boolean};

const DETAIL_ESTIMATE_SECONDS=75;

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

function apiErrorInfo(body:unknown,status:number){
  const record=body&&typeof body==='object'?body as Record<string,unknown>:{};
  const code=typeof record.error==='string'&&record.error.trim()?record.error.trim():`HTTP_${status}`;
  const details=typeof record.details==='string'&&record.details.trim()?record.details.trim():'';
  return {code,details};
}

function formatError(message:string,code:string,details=''){
  return `${message}\n오류 코드: ${code}${details?`\n상세: ${details}`:''}`;
}

function estimatedProgress(elapsed:number){
  if(elapsed<12)return Math.min(30,8+elapsed*1.8);
  if(elapsed<42)return Math.min(69,30+(elapsed-12)*1.3);
  if(elapsed<70)return Math.min(92,69+(elapsed-42)*.82);
  return Math.min(97,92+(elapsed-70)*.15);
}

function progressStage(progress:number,name:string){
  if(progress<22)return `${name}, 검사 시작`;
  if(progress<60)return `${name}, 검사 중`;
  if(progress<82)return `${name}, 정밀 검사 중`;
  return `${name}, 결과 작성 중`;
}

function remainingLabel(elapsed:number){
  if(elapsed>=DETAIL_ESTIMATE_SECONDS)return '조금 더 걸리고 있어요';
  const remaining=Math.max(5,Math.ceil((DETAIL_ESTIMATE_SECONDS-elapsed)/5)*5);
  return `약 ${remaining}초 남음`;
}

export function CharacterReportView({preview,creatorEditToken}:{preview:CharacterReportPreview;creatorEditToken?:string}){
  const [unlockOpen,setUnlockOpen]=useState(false);
  const [detail,setDetail]=useState<DetailPayload|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [progress,setProgress]=useState(0);
  const [elapsedSeconds,setElapsedSeconds]=useState(0);

  useEffect(()=>{
    if(!busy)return;
    const startedAt=Date.now();
    const tick=()=>{
      const elapsed=Math.floor((Date.now()-startedAt)/1000);
      setElapsedSeconds(elapsed);
      setProgress(Math.round(estimatedProgress(elapsed)));
    };
    tick();
    const timer=window.setInterval(tick,1000);
    return ()=>window.clearInterval(timer);
  },[busy]);

  function editToken(){
    if(creatorEditToken)return creatorEditToken;
    if(typeof window==='undefined')return '';
    return localStorage.getItem(`chara_edit_${preview.shareCode}`)||'';
  }

  async function loadDetail(code:string){
    setProgress(8);setElapsedSeconds(0);setBusy(true);setError('');
    try{
      const token=editToken();
      const r=await fetch(`/api/characters/${preview.shareCode}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessCode:code,...(token?{editToken:token}:{})})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok){
        const apiError=apiErrorInfo(body,r.status);
        if(r.status===401){localStorage.removeItem('chara_ai_access_code');setUnlockOpen(true)}
        if(apiError.code==='DETAIL_OWNER_SOURCE_REQUIRED'){
          setError(formatError('상세 리포트가 아직 생성되지 않았어요. 최초 1회는 이 캐릭터를 만든 브라우저에서 상세보기를 열어야 해요.',apiError.code,apiError.details));
        }else if(apiError.code==='EDIT_TOKEN_INVALID'){
          setError(formatError('이 브라우저의 캐릭터 생성 권한을 확인하지 못했어요. 최초 상세 생성은 캐릭터를 만든 브라우저에서 진행해주세요.',apiError.code,apiError.details));
        }else if(apiError.code==='CODE_INVALID'){
          setError(formatError('이용 코드를 다시 확인해주세요.',apiError.code,apiError.details));
        }else{
          setError(formatError('상세 리포트를 불러오지 못했어요.',apiError.code,apiError.details));
        }
        return;
      }
      setProgress(100);
      setDetail(body.detail);
      requestAnimationFrame(()=>document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'}));
    }catch(cause){
      const details=cause instanceof Error?cause.message:String(cause);
      setError(formatError('상세 리포트 요청 중 오류가 발생했어요.','CLIENT_REQUEST_FAILED',details));
    }finally{setBusy(false)}
  }

  function requestDetail(){if(detail){document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'});return}setUnlockOpen(true)}
  const summaryCards=[['겉으로 보이는 모습',preview.summary.outerSelf],['실제 내면',preview.summary.innerSelf],['갈등 방식',preview.summary.conflictStyle],['애정 표현',preview.summary.affectionStyle]] as const;
  const previewSections=[
    ['관계에서 반복되는 패턴',`상대를 얼마나 가까운 사람으로 받아들이는지에 따라 허용하는 거리와 개입의 방식이 어떻게 달라지는지 살펴봅니다. 친밀감이 높아질수록 표현이 직접적으로 바뀌는지, 오히려 관찰과 배려가 늘어나는지, 갈등 뒤에 다시 관계를 회복하려는 방식은 무엇인지까지 여러 장면을 연결해 읽습니다.\n\n단순히 사람을 좋아한다거나 낯을 가린다는 식으로 끝내지 않고, 어느 순간부터 상대를 자기 책임 범위 안에 넣는지, 거절이나 침묵을 어떤 신호로 받아들이는지, 가까워진 뒤에도 끝까지 남는 경계선은 무엇인지를 함께 풀어냅니다.`],
    ['핵심 가치 · 욕구 · 두려움',`무엇을 선택할 때 가장 먼저 지키려는 기준이 무엇인지, 원하는 것이 단순한 결과인지 아니면 특정한 감각과 상태인지 구분해서 봅니다. 겉으로는 대수롭지 않게 넘겨도 반복해서 지키는 원칙이 있다면 그 원칙이 어디에서 힘을 얻는지, 반대로 포기할 수 있는 기준은 무엇인지까지 연결합니다.\n\n욕구와 두려움도 따로 떼지 않고 하나의 구조로 봅니다. 무엇을 얻고 싶은 마음이 어떤 행동을 밀어붙이는지, 무엇을 잃을까 두려워할 때 평소와 다른 판단을 하는지, 만족과 불안이 같은 대상에서 동시에 생기는 경우에는 그 모순이 어떤 선택 패턴으로 이어지는지를 해석합니다.`],
    ['통합 상세 해석',`각 항목에서 따로 드러난 특징을 다시 하나의 흐름으로 엮어, 이 캐릭터가 어떤 기준으로 상황을 판단하고 사람과 거리를 조절하는지 깊게 풀어냅니다. 관계에서 반복되는 선택, 감정이 행동으로 바뀌는 방식, 예외가 생기는 조건을 함께 보면서 단순한 성격표가 아니라 실제 장면 속에서 움직일 수 있는 인물의 원리를 정리합니다.\n\n서로 모순처럼 보이는 모습도 어느 한쪽을 지우지 않고 더 큰 행동 원리 안에서 연결합니다. 같은 특성이 상황에 따라 강점과 취약점으로 어떻게 바뀌는지, 다른 인물과 부딪혔을 때 어떤 관계 서사가 자연스럽게 생기는지, 아직 확정할 수 없는 열린 부분은 무엇인지까지 이어서 해석합니다.`],
  ] as const;
  const previewBlur=[5,7.5,10] as const;
  const previewOpacity=[.68,.52,.34] as const;
  const previewWhite=[.04,.15,.3] as const;

  return <>
    <AccessCodeModal open={unlockOpen} onClose={()=>setUnlockOpen(false)} onValidated={loadDetail} eyebrow="Detailed report" title="상세 리포트 열기" description="포스타입에서 결제 후 최신 이용 코드를 확인해 입력해주세요. 최초 생성 시 캐릭터 전체 정보를 바탕으로 상세 캐해를 만듭니다." submitLabel="코드 확인하고 상세 생성" />

    <div className="result-hero"><div><div className="eyebrow">Analysis complete</div><h1 style={{fontSize:'clamp(46px,7vw,80px)',marginBottom:12}}>{preview.name}</h1><p className="hero-copy" style={{fontSize:17}}>{preview.oneLineSummary}</p></div><div><div className="label">공유 코드</div><div className="share-code">{preview.shareCode}</div><button className="btn soft" style={{marginTop:10}} onClick={()=>navigator.clipboard.writeText(preview.shareCode)}>코드 복사</button></div></div>

    <div style={{marginTop:34}}><div className="eyebrow">Quick interpretation</div><h2 style={{marginTop:10}}>유형별 캐릭터 해석</h2><p className="muted" style={{lineHeight:1.7,maxWidth:720}}>20개의 답변과 프로필을 바탕으로 핵심만 먼저 요약했어요. 상세 원문은 결제 코드 확인 후에만 생성됩니다.</p></div>
    <div className="result-grid" style={{marginTop:20}}>{summaryCards.map(([title,text])=><section className="result-block" key={title}><h3>{title}</h3><ParagraphText text={text}/></section>)}</div>

    {!detail&&<section className="card" style={{marginTop:24,padding:'34px 28px',overflow:'hidden',position:'relative'}}>
      <div className="eyebrow">Full report preview</div><h2 style={{fontSize:'clamp(27px,4vw,40px)',marginTop:10}}>여기서 한 단계 더 들어가면</h2>
      <p style={{lineHeight:1.75,maxWidth:760,marginBottom:20}}>요약에서 보인 성향이 <strong>어떤 관계에서 달라지는지, 무엇을 가장 원하고 두려워하는지, 겉과 속의 모순이 어디서 생기는지</strong>까지 풀어서 볼 수 있어요.</p>
      <div className="tags" style={{marginBottom:18}}>{['유형별 해석','핵심 가치·욕구','두려움','관계·갈등 패턴','오해받는 지점','캐릭터의 모순','상세 통합 리포트'].map(x=><span className="tag" key={x}>{x}</span>)}</div>

      <div style={{position:'relative'}}>
        <div aria-hidden="true" style={{display:'grid',gap:12,position:'relative'}}>
          {previewSections.map(([title,t],index)=><div key={title} style={{border:'1px solid var(--line)',borderRadius:16,padding:'22px 24px',background:'white',minHeight:230,position:'relative',overflow:'hidden'}}>
            <strong>{title}</strong>
            <div style={{marginTop:12,filter:`blur(${previewBlur[index]}px)`,opacity:previewOpacity[index],userSelect:'none'}}><ParagraphText text={t}/></div>
            <div style={{position:'absolute',inset:0,background:`rgba(255,253,248,${previewWhite[index]})`,pointerEvents:'none'}}/>
          </div>)}
          <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,rgba(255,253,248,0) 0%,rgba(255,253,248,.08) 30%,rgba(255,253,248,.3) 58%,rgba(255,253,248,.72) 82%,rgba(255,253,248,.9) 100%)',pointerEvents:'none'}}/>
        </div>
        <button className="btn primary" disabled={busy} onClick={requestDetail} style={{position:'absolute',left:'50%',top:'66.2%',transform:'translate(-50%,-50%)',zIndex:5,boxShadow:'0 10px 26px rgba(23,24,22,.18)',whiteSpace:'nowrap'}}>{busy?'상세 리포트 생성 중…':'더 자세히 보기'}</button>
      </div>

      {busy&&<div role="status" aria-live="polite" style={{marginTop:22,padding:'18px 20px',borderRadius:16,background:'var(--accent-soft)'}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
          <div className="loading" style={{fontWeight:900}}>{progressStage(progress,preview.name)} <i className="dot"/><i className="dot"/><i className="dot"/></div>
          <strong style={{fontSize:20}}>{progress}%</strong>
        </div>
        <div aria-hidden="true" style={{height:10,borderRadius:999,overflow:'hidden',background:'rgba(23,24,22,.12)',marginTop:10}}>
          <div style={{height:'100%',width:`${progress}%`,borderRadius:999,background:'rgba(23,24,22,.78)',transition:'width .8s ease'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap',marginTop:8,fontSize:13}}>
          <span className="muted">{elapsedSeconds}초</span>
          <span className="muted">{remainingLabel(elapsedSeconds)}</span>
        </div>
        <p className="muted" style={{margin:'8px 0 0',lineHeight:1.5}}>보통 40초~1분 30초 · 생성 후 저장돼요.</p>
      </div>}
      {error&&<div className="error" style={{whiteSpace:'pre-wrap',marginTop:18}}>{error}</div>}
      <div className="actions" style={{justifyContent:'center',marginTop:24}}><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
    </section>}

    {detail&&<div id="paid-detail-report" style={{scrollMarginTop:90,marginTop:34}}>
      <div className="eyebrow">Unlocked · Detailed report</div><h2 style={{marginTop:10}}>상세 캐릭터 리포트</h2><p className="muted" style={{lineHeight:1.7,maxWidth:760}}>캐릭터의 행동 원리와 관계 패턴을 깊게 풀어낸 유형별 해석과 통합 캐해입니다.</p>
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
