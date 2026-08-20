'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';
import { AccessCodeModal } from '@/components/AccessCodeModal';
import { useRotatingFlavor } from '@/lib/loading-flavor';
import { ReportCover, SummaryNotes, DetailMagazinePage } from '@/components/ReportMagazine';

type DetailPayload={
  analysis:FinalAnalysis;
  confirmedFactCount:number;
  inferenceCount:number;
  cached?:boolean;
  stageReady?:number;
  complete?:boolean;
};

const DETAIL_ESTIMATE_SECONDS=70;

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
  return <div>{chunks.map((chunk,index)=>{
    const lead=chunk.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
    return <p key={`${index}-${chunk.slice(0,18)}`} style={{margin:index===0?0:'18px 0 0',lineHeight:1.85,color:'#444'}}>
      {lead?<><strong style={{color:'#222'}}>{lead[1]}</strong>{lead[2]?<> {lead[2]}</>:null}</>:chunk}
    </p>;
  })}</div>;
}

function BulletList({items}:{items:string[]}){
  return <ul style={{margin:'0',paddingLeft:22,lineHeight:1.8,color:'#444'}}>{items.map((item,index)=><li key={`${index}-${item.slice(0,18)}`} style={{margin:index===0?0:'9px 0 0'}}>{item}</li>)}</ul>;
}

function apiErrorInfo(body:unknown,status:number){
  const record=body&&typeof body==='object'?body as Record<string,unknown>:{};
  const code=typeof record.error==='string'&&record.error.trim()?record.error.trim():`HTTP_${status}`;
  const details=typeof record.details==='string'&&record.details.trim()?record.details.trim():'';
  return {code,details};
}

function formatError(message:string,_code:string,_details=''){
  return message;
}

function estimatedProgress(elapsed:number){
  if(elapsed<12)return Math.min(30,8+elapsed*1.8);
  if(elapsed<38)return Math.min(70,30+(elapsed-12)*1.55);
  if(elapsed<65)return Math.min(94,70+(elapsed-38)*.9);
  return Math.min(97,94+(elapsed-65)*.12);
}

function remainingLabel(elapsed:number){
  if(elapsed>=DETAIL_ESTIMATE_SECONDS)return '조금 더 걸리고 있어요';
  const remaining=Math.max(5,Math.ceil((DETAIL_ESTIMATE_SECONDS-elapsed)/5)*5);
  return `약 ${remaining}초 남음`;
}

function TextSection({title,text}:{title:string;text?:string}){
  if(!text?.trim())return null;
  return <section className="result-block"><h3>{title}</h3><ParagraphText text={text}/></section>;
}

function ListSection({title,items}:{title:string;items?:string[]}){
  if(!items?.length)return null;
  return <section className="result-block"><h3>{title}</h3><BulletList items={items}/></section>;
}

export function CharacterReportView({preview,creatorEditToken}:{preview:CharacterReportPreview;creatorEditToken?:string}){
  const [unlockOpen,setUnlockOpen]=useState(false);
  const [detail,setDetail]=useState<DetailPayload|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [progress,setProgress]=useState(0);
  const [elapsedSeconds,setElapsedSeconds]=useState(0);
  // 상세 리포트 생성 로딩은 저장된 최종 성격 태그를 가장 먼저 사용한다.
  // 구버전 캐릭터는 interview → owner → initial 순서로 폴백하고, 태그 자체가 없을 때만 텍스트 키워드 감지를 쓴다.
  const flavorSignal=[preview.oneLineSummary,preview.summary?.outerSelf,preview.summary?.innerSelf,preview.summary?.conflictStyle,preview.summary?.affectionStyle,preview.summary?.misunderstoodPoint,preview.summary?.hiddenPattern].filter(Boolean).join(' ');
  const reportFlavorTags=preview.personalityTags?.finalAdaptive?.length
    ? preview.personalityTags.finalAdaptive
    : preview.personalityTags?.interviewAdaptive?.length
      ? preview.personalityTags.interviewAdaptive
      : preview.personalityTags?.ownerSelected?.length
        ? preview.personalityTags.ownerSelected
        : preview.personalityTags?.aiInitial?.length
          ? preview.personalityTags.aiInitial
          : undefined;
  const flavorMessage=useRotatingFlavor(flavorSignal,preview.name,busy,reportFlavorTags);
  const [reportPage,setReportPage]=useState<1|2|3>(1);
  const [stageReady,setStageReady]=useState(0);
  const [prefetchBusy,setPrefetchBusy]=useState(false);
  const [prefetchError,setPrefetchError]=useState('');
  const [ownerName,setOwnerName]=useState(preview.ownerName||'');
  const [ownerNameSaved,setOwnerNameSaved]=useState(Boolean(preview.ownerName));
  const [identityBusy,setIdentityBusy]=useState(false);
  const [identityError,setIdentityError]=useState('');
  const codeRef=useRef('');
  const tokenRef=useRef('');
  const stageReadyRef=useRef(0);
  const inFlightStagesRef=useRef(new Set<number>());
  const precomputeFiredRef=useRef(false);

  // 오너명은 개인정보라 공개 preview에서 빠졌다. 편집 토큰을 가진 오너 본인 화면에서만
  // 저장된 값을 읽어와 입력칸을 채운다. 제3자에게는 조회되지 않는다.
  useEffect(()=>{
    const token=creatorEditToken||(typeof window!=='undefined'?localStorage.getItem(`chara_edit_${preview.shareCode}`)||'':'');
    if(!token)return;
    let cancelled=false;
    void (async()=>{
      try{
        const r=await fetch(`/api/characters/${preview.shareCode}/identity`,{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({editToken:token}),
        });
        const body=await r.json().catch(()=>({}));
        if(cancelled||!r.ok||typeof body?.ownerName!=='string'||!body.ownerName)return;
        setOwnerName(body.ownerName);
        setOwnerNameSaved(true);
      }catch{}
    })();
    return()=>{cancelled=true};
  },[creatorEditToken,preview.shareCode]);

  // 이용코드 모달을 여는 순간(= 결제 의사가 높은 시점), 오너 브라우저에서 무거운 심리모델을 미리 계산해둔다.
  // 결제 직후 stage 1은 이 결과를 재사용해 첫 페이지 대기가 크게 줄어든다. fire-and-forget이라 UI를 막지 않는다.
  useEffect(()=>{
    if(!unlockOpen||detail||precomputeFiredRef.current)return;
    const token=creatorEditToken||(typeof window!=='undefined'?localStorage.getItem(`chara_edit_${preview.shareCode}`)||'':'');
    if(!token)return;
    precomputeFiredRef.current=true;
    void fetch(`/api/characters/${preview.shareCode}/precompute`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({editToken:token}),
    }).catch(()=>{});
  },[unlockOpen,detail,creatorEditToken,preview.shareCode]);

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

  async function saveOwnerIdentity(){
    const token=editToken();
    const normalized=ownerName.replace(/\s+/g,' ').trim();
    if(!token){setIdentityError('이 캐릭터를 만든 브라우저에서만 오너명을 저장하거나 변경할 수 있어요.');return}
    if(!normalized){setIdentityError('오너명을 입력해주세요.');return}
    setIdentityBusy(true);setIdentityError('');
    try{
      const r=await fetch(`/api/characters/${preview.shareCode}/identity`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({editToken:token,ownerName:normalized})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok){
        const info=apiErrorInfo(body,r.status);
        setIdentityError(info.code==='EDIT_TOKEN_INVALID'?'이 캐릭터를 만든 브라우저의 저장 권한을 확인하지 못했어요.':'저장하지 못했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      setOwnerName(typeof body.ownerName==='string'?body.ownerName:normalized);
      setOwnerNameSaved(true);
    }catch{setIdentityError('저장 요청 중 오류가 발생했어요.')}
    finally{setIdentityBusy(false)}
  }

  function mergeDetail(incoming:DetailPayload){
    const ready=Math.max(stageReadyRef.current,incoming.stageReady||0);
    stageReadyRef.current=ready;
    setStageReady(ready);
    setDetail(prev=>prev?{
      ...prev,
      ...incoming,
      analysis:{...prev.analysis,...incoming.analysis},
    }:incoming);
  }

  // 남은 두 페이지(2,3)를 서버에서 병렬 생성해 한 번에 받아온다. 순차 요청(2→3)보다 대기가 짧다.
  async function requestRemaining(){
    if(stageReadyRef.current>=3)return;
    if(inFlightStagesRef.current.has(2)||inFlightStagesRef.current.has(3))return;
    const code=codeRef.current;
    const token=tokenRef.current;
    if(!code||!token)return;
    inFlightStagesRef.current.add(2);inFlightStagesRef.current.add(3);
    setPrefetchBusy(true);
    setPrefetchError('');
    try{
      const r=await fetch(`/api/characters/${preview.shareCode}`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({accessCode:code,editToken:token,finishRemaining:true}),
      });
      const body=await r.json().catch(()=>({}));
      if(!r.ok){
        const apiError=apiErrorInfo(body,r.status);
        setPrefetchError(formatError('다음 페이지를 준비하지 못했어요.',apiError.code,apiError.details));
        return;
      }
      mergeDetail(body.detail);
    }catch{
      setPrefetchError('다음 페이지를 준비하지 못했어요. 잠시 후 다시 시도해주세요.');
    }finally{
      inFlightStagesRef.current.delete(2);inFlightStagesRef.current.delete(3);
      setPrefetchBusy(inFlightStagesRef.current.size>0);
    }
  }

  async function loadDetail(code:string){
    setProgress(8);setElapsedSeconds(0);setBusy(true);setError('');setPrefetchError('');
    try{
      const token=editToken();
      const r=await fetch(`/api/characters/${preview.shareCode}`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({accessCode:code,stage:1,...(token?{editToken:token}:{})}),
      });
      const body=await r.json().catch(()=>({}));
      if(!r.ok){
        const apiError=apiErrorInfo(body,r.status);
        if(r.status===401){localStorage.removeItem('chara_ai_access_code');setUnlockOpen(true)}
        if(apiError.code==='DETAIL_OWNER_SOURCE_REQUIRED'){
          setError('상세 리포트가 아직 준비되지 않았어요. 처음 한 번은 이 캐릭터를 만든 브라우저에서 열어주세요.');
        }else if(apiError.code==='EDIT_TOKEN_INVALID'){
          setError('이 캐릭터를 만든 브라우저의 저장 권한을 확인하지 못했어요.');
        }else if(apiError.code==='CODE_INVALID'){
          setError('현재 이용 코드와 일치하지 않아요. 포스타입에서 최신 코드를 확인해주세요.');
        }else{
          setError('상세 리포트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
        }
        return;
      }
      codeRef.current=code;
      tokenRef.current=token;
      setProgress(100);
      setReportPage(1);
      mergeDetail(body.detail);
      requestAnimationFrame(()=>document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'}));

      const ready=body.detail.stageReady||0;
      // 첫 페이지를 보여준 직후, 남은 두 페이지를 병렬로 미리 생성한다.
      if(token&&ready<3)void requestRemaining();
    }catch{
      setError('상세 리포트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
    }finally{setBusy(false)}
  }

  function requestDetail(){if(detail){document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'smooth',block:'start'});return}setUnlockOpen(true)}

  function changeReportPage(next:1|2|3){
    setReportPage(next);
    requestAnimationFrame(()=>document.getElementById('paid-detail-report')?.scrollIntoView({behavior:'auto',block:'start'}));
    // 아직 완결 전이라면 남은 페이지를 병렬로 마저 준비한다.
    if(stageReadyRef.current<3)void requestRemaining();
  }

  const richSummary=Boolean(preview.summary.misunderstoodPoint?.trim()&&preview.summary.hiddenPattern?.trim());
  const previewSections=[
    ['관계에서 반복되는 패턴',`상대를 얼마나 가까운 사람으로 받아들이는지에 따라 허용하는 거리와 개입의 방식이 어떻게 달라지는지 살펴봅니다. 친밀감이 높아질수록 표현이 직접적으로 바뀌는지, 오히려 관찰과 배려가 늘어나는지, 갈등 뒤에 다시 관계를 회복하려는 방식은 무엇인지까지 여러 장면을 연결해 읽습니다.\n\n단순히 사람을 좋아한다거나 낯을 가린다는 식으로 끝내지 않고, 어느 순간부터 상대를 자기 책임 범위 안에 넣는지, 거절이나 침묵을 어떤 신호로 받아들이는지, 가까워진 뒤에도 끝까지 남는 경계선은 무엇인지를 함께 풀어냅니다.`],
    ['핵심 가치 · 욕구 · 두려움',`무엇을 선택할 때 가장 먼저 지키려는 기준이 무엇인지, 원하는 것이 단순한 결과인지 아니면 특정한 감각과 상태인지 구분해서 봅니다. 겉으로는 대수롭지 않게 넘겨도 반복해서 지키는 원칙이 있다면 그 원칙이 어디에서 힘을 얻는지, 반대로 포기할 수 있는 기준은 무엇인지까지 연결합니다.\n\n욕구와 두려움도 따로 떼지 않고 하나의 구조로 봅니다. 무엇을 얻고 싶은 마음이 어떤 행동을 밀어붙이는지, 무엇을 잃을까 두려워할 때 평소와 다른 판단을 하는지, 만족과 불안이 같은 대상에서 동시에 생기는 경우에는 그 모순이 어떤 선택 패턴으로 이어지는지를 해석합니다.`],
    ['통합 상세 해석',`각 항목에서 따로 드러난 특징을 다시 하나의 흐름으로 엮어, 이 캐릭터가 어떤 기준으로 상황을 판단하고 사람과 거리를 조절하는지 깊게 풀어냅니다. 관계에서 반복되는 선택, 감정이 행동으로 바뀌는 방식, 예외가 생기는 조건을 함께 보면서 단순한 성격표가 아니라 실제 장면 속에서 움직일 수 있는 인물의 원리를 정리합니다.\n\n서로 모순처럼 보이는 모습도 어느 한쪽을 지우지 않고 더 큰 행동 원리 안에서 연결합니다. 같은 특성이 상황에 따라 강점과 취약점으로 어떻게 바뀌는지, 다른 인물과 부딪혔을 때 어떤 관계 서사가 자연스럽게 생기는지, 아직 확정할 수 없는 열린 부분은 무엇인지까지 이어서 해석합니다.`],
  ] as const;
  const previewBlur=[5,7.5,10] as const;
  const previewOpacity=[.68,.52,.34] as const;
  const previewWhite=[.04,.15,.3] as const;

  const nextStage=reportPage===1?2:reportPage===2?3:3;
  const nextPageReady=reportPage===3||stageReady>=nextStage;
  const isPagedReport=Boolean(detail?.analysis.characterOverview);
  const canEditIdentity=Boolean(creatorEditToken);

  return <>
    <style>{`
      .report-summary-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:28px}
      .report-summary-copy{flex:1 1 340px;min-width:0}
      .save-character-panel{flex:0 1 480px;max-width:520px;border:1px solid var(--line);border-radius:18px;padding:18px 20px;background:rgba(255,255,255,.46)}
      .save-character-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end;margin-top:10px}
      .save-character-row .field{margin:0}
      .save-character-note{margin:11px 0 0;font-size:13px;line-height:1.6;color:var(--muted)}
      .full-preview-sections{display:grid;gap:12px;position:relative}
      @media(max-width:760px){
        .save-character-panel{flex-basis:100%;max-width:none}
      }
      @media(max-width:640px){
        .save-character-panel{padding:16px}
        .save-character-row{grid-template-columns:1fr}
        .save-character-row .btn{width:100%}
        .full-preview-section.preview-index-0,.full-preview-section.preview-index-1{display:none}
        .full-preview-cta{top:50% !important}
      }
    `}</style>

    <AccessCodeModal open={unlockOpen} onClose={()=>setUnlockOpen(false)} onValidated={loadDetail} title="상세 리포트 열기" description="포스타입에서 결제 후 최신 이용 코드를 확인해 입력해주세요." submitLabel="코드 확인하고 상세 리포트 보기" />

    <ReportCover preview={preview}/>

    <div className="result-hero report-summary-head" style={{marginTop:20}}>
      <div className="report-summary-copy"><p className="muted" style={{lineHeight:1.7,marginTop:0}}>{richSummary?'프로필과 20개의 답변에서 반복되는 패턴을 연결해, 겉으로 바로 보이지 않는 부분까지 먼저 읽어봤어요.':'20개의 답변과 프로필을 바탕으로 핵심만 먼저 요약했어요. 상세 원문은 결제 코드 확인 후에만 정리됩니다.'}</p></div>
      <div className="save-character-panel">
        <div className="label">캐릭터 저장</div>
        {canEditIdentity?<>
          <div className="save-character-row">
            <div className="field"><label className="label">오너명</label><input className="input" value={ownerName} maxLength={80} disabled={identityBusy} onChange={e=>{setOwnerName(e.target.value);setOwnerNameSaved(false);setIdentityError('')}} /></div>
            <button className="btn soft" disabled={identityBusy||!ownerName.trim()||ownerNameSaved} onClick={()=>void saveOwnerIdentity()}>{identityBusy?'저장 중…':ownerNameSaved?'저장 완료':'저장'}</button>
          </div>
          {identityError&&<p className="error" style={{marginBottom:0}}>{identityError}</p>}
        </>:preview.ownerName?<div style={{marginTop:9,fontSize:14}}>오너명 · <strong>{preview.ownerName}</strong></div>:null}
        <p className="save-character-note">오너명을 함께 저장해두면 나중에 리포트를 다시 꺼내볼 수 있고, 추후 2인·다인 페어 궁합이나 5~20인 이상 단체 조합 기능에도 지금 저장한 캐릭터 정보를 그대로 활용할 수 있어요.</p>
      </div>
    </div>

    <div style={{marginTop:24}}><SummaryNotes preview={preview}/></div>

    {!detail&&<section className="card" style={{marginTop:24,padding:'34px 28px',overflow:'hidden',position:'relative'}}>
      <h2 style={{fontSize:'clamp(27px,4vw,40px)',marginTop:0}}>여기서 한 단계 더 들어가면</h2>
      <p style={{lineHeight:1.75,maxWidth:760,marginBottom:20}}>요약에서 보인 성향이 <strong>어떤 관계에서 달라지는지, 무엇을 가장 원하고 두려워하는지, 겉과 속의 모순이 어디서 생기는지</strong>까지 풀어서 볼 수 있어요.</p>
      <div className="tags" style={{marginBottom:18}}>{['이런 캐릭터예요','이렇게 작동해요','이렇게 관계를 맺어요','이런 애착이 있어요','이렇게 갈등해요','이런 매력이 있어요','통합 리포트'].map(x=><span className="tag" key={x}>{x}</span>)}</div>

      <div style={{position:'relative'}}>
        <div aria-hidden="true" className="full-preview-sections">
          {previewSections.map(([title,t],index)=><div className={`full-preview-section preview-index-${index}`} key={title} style={{border:'1px solid var(--line)',borderRadius:16,padding:'22px 24px',background:'white',minHeight:230,position:'relative',overflow:'hidden'}}>
            <strong>{title}</strong>
            <div style={{marginTop:12,filter:`blur(${previewBlur[index]}px)`,opacity:previewOpacity[index],userSelect:'none'}}><ParagraphText text={t}/></div>
            <div style={{position:'absolute',inset:0,background:`rgba(255,253,248,${previewWhite[index]})`,pointerEvents:'none'}}/>
          </div>)}
          <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,rgba(255,253,248,0) 0%,rgba(255,253,248,.08) 30%,rgba(255,253,248,.3) 58%,rgba(255,253,248,.72) 82%,rgba(255,253,248,.9) 100%)',pointerEvents:'none'}}/>
        </div>
        <div style={{position:'absolute',left:'50%',top:'60%',transform:'translate(-50%,-50%)',zIndex:5,width:'min(600px,90%)',display:'flex',flexDirection:'column',alignItems:'center',gap:18,pointerEvents:'none'}}>
          {!busy&&<div style={{pointerEvents:'none',textAlign:'center',padding:'18px 22px',borderRadius:18,background:'rgba(255,253,248,.86)',backdropFilter:'blur(3px)',WebkitBackdropFilter:'blur(3px)',border:'1px solid var(--line)',boxShadow:'0 12px 34px rgba(23,24,22,.12)'}}>
            <div style={{fontSize:12,fontWeight:900,letterSpacing:'.03em',color:'var(--accent,#b8860b)',marginBottom:9}}>여기까지는 예고편이에요.</div>
            <p style={{margin:0,fontSize:'clamp(14px,2.4vw,16px)',lineHeight:1.75,fontWeight:700}}>아직 못 꺼낸 얘기가 더 많아요. 바로 확인해보세요.</p>
          </div>}
          <button className="btn primary full-preview-cta" disabled={busy} onClick={requestDetail} style={{pointerEvents:'auto',boxShadow:'0 10px 26px rgba(23,24,22,.18)',whiteSpace:'nowrap'}}>{busy?'리포트를 작성하는 중…':'더 자세히 보기'}</button>
        </div>
      </div>

      {busy&&<div role="status" aria-live="polite" style={{marginTop:22,padding:'18px 20px',borderRadius:16,background:'var(--accent-soft)'}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
          <div className="loading" style={{fontWeight:900}}>{flavorMessage} <i className="dot"/><i className="dot"/><i className="dot"/></div>
          <strong style={{fontSize:20}}>{progress}%</strong>
        </div>
        <div aria-hidden="true" style={{height:10,borderRadius:999,overflow:'hidden',background:'rgba(23,24,22,.12)',marginTop:10}}>
          <div style={{height:'100%',width:`${progress}%`,borderRadius:999,background:'rgba(23,24,22,.78)',transition:'width .8s ease'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap',marginTop:8,fontSize:13}}>
          <span className="muted">{elapsedSeconds}초</span>
          <span className="muted">{remainingLabel(elapsedSeconds)}</span>
        </div>
      </div>}
      {error&&<div className="error" style={{whiteSpace:'pre-wrap',marginTop:18}}>{error}</div>}
      <div className="actions" style={{justifyContent:'center',marginTop:24}}><Link className="btn" href="/analyze">다른 캐릭터 분석</Link></div>
    </section>}

    {detail&&<div id="paid-detail-report" style={{scrollMarginTop:90,marginTop:34}}>
      {isPagedReport ? <>
        <DetailMagazinePage page={reportPage} name={preview.name} analysis={detail.analysis} endNote={detail.analysis.oneLineSummary}/>

        {prefetchError&&reportPage<3&&<div className="error" style={{whiteSpace:'pre-wrap',marginTop:18}}>
          {prefetchError}
          <div style={{marginTop:12}}><button className="btn" onClick={()=>void requestRemaining()}>다시 준비하기</button></div>
        </div>}
      </> : <>
        <h2 style={{marginTop:0}}>상세 캐릭터 리포트</h2>
        <div className="result-grid" style={{marginTop:20}}>
          <TextSection title="겉으로 보이는 모습" text={detail.analysis.outerSelf}/>
          <TextSection title="실제 내면" text={detail.analysis.innerSelf}/>
          <TextSection title="갈등 방식" text={detail.analysis.conflictStyle}/>
          <TextSection title="애정 표현" text={detail.analysis.affectionStyle}/>
          <ListSection title="핵심 가치" items={detail.analysis.coreValues}/>
          <ListSection title="핵심 욕망" items={detail.analysis.desires}/>
          <ListSection title="두려워하는 것" items={detail.analysis.fears}/>
          <ListSection title="쉽게 오해받는 부분" items={detail.analysis.misunderstoodPoints}/>
          <ListSection title="캐릭터의 모순" items={detail.analysis.contradictions}/>
          <ListSection title="새롭게 읽히는 지점" items={detail.analysis.interestingPoints}/>
          <TextSection title="본질적인 성격" text={detail.analysis.corePersonality}/>
          <TextSection title="왜 이런 성격이 되었는지" text={detail.analysis.developmentalRoots}/>
          <TextSection title="감정 구조" text={detail.analysis.emotionalStructure}/>
          <TextSection title="방어기제와 스트레스 반응" text={detail.analysis.defenseAndStress}/>
          <TextSection title="대인관계 방식" text={detail.analysis.relationshipPattern}/>
          <TextSection title="애착·친밀감" text={detail.analysis.attachmentPattern}/>
          <TextSection title="연애하면 어떤 타입인지" text={detail.analysis.romanceStyle}/>
          <TextSection title="사람을 좋아하고 싫어하는 기준" text={detail.analysis.attractionCriteria}/>
          <TextSection title="가치관과 극한상황" text={detail.analysis.moralAndExtremeChoices}/>
          <TextSection title="자기기만" text={detail.analysis.selfDeception}/>
          <TextSection title="원하는 것 vs 정말 필요한 것" text={detail.analysis.wantsVsNeeds}/>
          <TextSection title="표면 설정과 실제로 읽히는 모습" text={detail.analysis.statedVsEnacted}/>
          <ListSection title="강점이 약점으로 뒤집히는 지점" items={detail.analysis.strengthsAndRisks}/>
          <ListSection title="캐릭터의 매력 포인트" items={detail.analysis.charmPoints}/>
          <ListSection title="직접 쓰이지 않은 숨은 특성" items={detail.analysis.hiddenTraits}/>
        </div>
        {detail.analysis.relationshipManual&&<section className="card" style={{marginTop:22,padding:'30px'}}>
          <h2 style={{fontSize:'clamp(26px,4vw,38px)',marginTop:0}}>캐릭터 사용 설명서</h2>
          <div className="result-grid" style={{marginTop:18}}>
            <section className="result-block"><h3>친해지는 방법</h3><BulletList items={detail.analysis.relationshipManual.gettingClose}/></section>
            <section className="result-block"><h3>특히 하면 안 되는 것</h3><BulletList items={detail.analysis.relationshipManual.avoid}/></section>
            <section className="result-block"><h3>좋아하고 신뢰한다는 신호</h3><BulletList items={detail.analysis.relationshipManual.affectionSignals}/></section>
          </div>
        </section>}
        {detail.analysis.detailedReport&&<section className="card" style={{marginTop:22,padding:'32px'}}><h2 style={{fontSize:'clamp(28px,4vw,42px)',marginTop:0}}>통합 상세 해석</h2><div style={{fontSize:17}}><ParagraphText text={detail.analysis.detailedReport}/></div></section>}
      </>}

      {isPagedReport?<div className="actions" style={{justifyContent:'space-between',marginTop:24,flexWrap:'nowrap',overflowX:'auto',alignItems:'center'}}>
        <div style={{display:'flex',gap:10,flexWrap:'nowrap',flexShrink:0}}>
          <button className="btn" style={{whiteSpace:'nowrap'}} onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>↑ 요약으로 올라가기</button>
          <Link className="btn" style={{whiteSpace:'nowrap'}} href="/analyze">다른 캐릭터 분석</Link>
        </div>
        <div style={{display:'flex',gap:10,flexWrap:'nowrap',flexShrink:0,marginLeft:'auto'}}>
          {reportPage>1&&<button className="btn" style={{whiteSpace:'nowrap'}} onClick={()=>changeReportPage((reportPage-1) as 1|2)}>← 이전 페이지</button>}
          {reportPage<3&&<button className="btn primary" style={{whiteSpace:'nowrap'}} disabled={!nextPageReady} onClick={()=>changeReportPage((reportPage+1) as 2|3)}>다음 페이지 →</button>}
        </div>
      </div>:<div className="actions" style={{marginTop:24,flexWrap:'nowrap',overflowX:'auto'}}>
        <button className="btn" style={{whiteSpace:'nowrap'}} onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>↑ 요약으로 올라가기</button>
        <Link className="btn" style={{whiteSpace:'nowrap'}} href="/analyze">다른 캐릭터 분석</Link>
      </div>}
    </div>}
  </>;
}
