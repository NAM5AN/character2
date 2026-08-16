'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CharacterDraft, InterviewAnswer, CharacterPassport } from '@/lib/schemas/character';
import type { InterviewQuestion } from '@/lib/schemas/question';
import { AccessCodeModal } from '@/components/AccessCodeModal';

type Stage = 'input'|'review'|'interview'|'finalizing'|'done';

export function AnalyzeFlow(){
  const router=useRouter();
  const [stage,setStage]=useState<Stage>('input');
  const [name,setName]=useState('');
  const [profileText,setProfileText]=useState('');
  const [secretProfileText,setSecretProfileText]=useState('');
  const [draft,setDraft]=useState<CharacterDraft|null>(null);
  const [answers,setAnswers]=useState<InterviewAnswer[]>([]);
  const [question,setQuestion]=useState<InterviewQuestion|null>(null);
  const [questionHistory,setQuestionHistory]=useState<InterviewQuestion[]>([]);
  const [activeQuestionIndex,setActiveQuestionIndex]=useState(0);
  const [selected,setSelected]=useState('');
  const [custom,setCustom]=useState('');
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [accessModal,setAccessModal]=useState(false);
  const [pendingAction,setPendingAction]=useState<null|(()=>Promise<void>)>(null);
  const [result,setResult]=useState<{passport:CharacterPassport;shareCode:string;editToken:string}|null>(null);

  function storedCode(){ return typeof window!=='undefined' ? localStorage.getItem('chara_ai_access_code')||'' : ''; }
  async function gate(action:(code:string)=>Promise<void>){
    const code=storedCode();
    if(!code){ setPendingAction(()=>()=>action(storedCode())); setAccessModal(true); return; }
    await action(code);
  }
  function handleApiError(status:number, body:any, retry:()=>Promise<void>){
    if(status===401 && body?.error==='CODE_INVALID'){
      localStorage.removeItem('chara_ai_access_code'); setPendingAction(()=>retry); setAccessModal(true); return true;
    }
    setError(body?.error==='RATE_LIMITED'?'요청이 너무 많아요. 잠시 뒤 다시 시도해주세요.':`처리 중 오류가 발생했어요. (${body?.error||status})`); return false;
  }

  async function parse(code:string){
    setBusy(true); setError('');
    try{
      const r=await fetch('/api/characters/parse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,profileText,secretProfileText,accessCode:code})});
      const body=await r.json();
      if(!r.ok){handleApiError(r.status,body,()=>gate(parse));return;}
      setDraft(body.draft); setStage('review');
    }finally{setBusy(false)}
  }

  function verdict(id:string,ownerVerdict:'confirmed'|'ambiguous'|'rejected'){
    if(!draft)return;
    setDraft({...draft,aiInferences:draft.aiInferences.map(x=>{
      if(x.id!==id)return x;
      if(ownerVerdict==='confirmed'){
        const {ownerFeedback: _ownerFeedback,...rest}=x;
        return {...rest,ownerVerdict};
      }
      return {...x,ownerVerdict};
    })});
  }

  function inferenceFeedback(id:string,ownerFeedback:string){
    if(!draft)return;
    setDraft({...draft,aiInferences:draft.aiInferences.map(x=>x.id===id?{...x,ownerFeedback}:x)});
  }

  function restoreAnswerFor(index:number, q:InterviewQuestion){
    const saved=answers[index];
    setQuestion(q);
    setActiveQuestionIndex(index);
    if(!saved){
      setSelected(''); setCustom(''); setReason('');
      return;
    }
    const matchedOption=q.options.includes(saved.answer);
    setSelected(matchedOption?saved.answer:'');
    setCustom(matchedOption?'':saved.answer);
    setReason(saved.reason||'');
  }

  async function nextQuestion(code:string, currentAnswers=answers, historyBase=questionHistory){
    if(!draft)return;
    setBusy(true); setError('');
    try{
      const r=await fetch('/api/characters/questions/next',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,answers:currentAnswers,accessCode:code})});
      const body=await r.json();
      if(!r.ok){handleApiError(r.status,body,()=>gate(c=>nextQuestion(c,currentAnswers,historyBase)));return;}
      if(body.done){ await finalize(code,currentAnswers); return; }
      const nextHistory=[...historyBase,body.question];
      setQuestionHistory(nextHistory);
      setQuestion(body.question);
      setActiveQuestionIndex(nextHistory.length-1);
      setSelected(''); setCustom(''); setReason('');
      setStage('interview');
    }finally{setBusy(false)}
  }

  function buildCurrentAnswer(){
    if(!question)return null;
    const answer=(custom.trim()||selected).trim();
    if(!answer)return null;
    const reasonText=reason.trim();
    return {
      order:question.order,
      question:question.question,
      answer,
      ...(reasonText?{reason:reasonText}:{}),
      branchContext:{
        category:question.category,
        mode:question.mode,
        format:question.format,
        targetHook:question.targetHook,
        hypothesis:question.hypothesis,
      },
    } satisfies InterviewAnswer;
  }

  async function answerCurrent(){
    if(!question)return;
    const current=buildCurrentAnswer();
    if(!current)return;

    const editingPast=activeQuestionIndex<questionHistory.length-1;
    if(editingPast){
      const next=[...answers.slice(0,activeQuestionIndex),current];
      const nextHistory=questionHistory.slice(0,activeQuestionIndex+1);
      setAnswers(next);
      setQuestionHistory(nextHistory);
      if(next.length===20){ await gate(code=>finalize(code,next)); }
      else { await gate(code=>nextQuestion(code,next,nextHistory)); }
      return;
    }

    const next=[...answers,current];
    setAnswers(next);
    if(next.length===20){ await gate(code=>finalize(code,next)); }
    else { await gate(code=>nextQuestion(code,next,questionHistory)); }
  }

  function previousQuestion(){
    if(busy||activeQuestionIndex<=0)return;
    const previousIndex=activeQuestionIndex-1;
    const previous=questionHistory[previousIndex];
    if(previous)restoreAnswerFor(previousIndex,previous);
  }

  function forwardQuestion(){
    if(busy||activeQuestionIndex>=questionHistory.length-1)return;
    const nextIndex=activeQuestionIndex+1;
    const next=questionHistory[nextIndex];
    if(next)restoreAnswerFor(nextIndex,next);
  }

  async function finalize(code:string, finalAnswers=answers){
    if(!draft)return; setStage('finalizing'); setBusy(true); setError('');
    try{
      const r=await fetch('/api/characters/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,answers:finalAnswers,accessCode:code})});
      const body=await r.json();
      if(!r.ok){handleApiError(r.status,body,()=>gate(c=>finalize(c,finalAnswers))); setStage('interview'); return;}
      localStorage.setItem(`chara_edit_${body.shareCode}`,body.editToken);
      setResult(body); setStage('done');
    }finally{setBusy(false)}
  }

  const confidence=draft?.analysisConfidence??0;
  const freeResponse=question?.format==='free_response';
  const viewingPastQuestion=activeQuestionIndex<questionHistory.length-1;
  const savedAtCurrent=answers[activeQuestionIndex];
  const currentDraftAnswer=(custom.trim()||selected).trim();
  const currentAnswerChanged=!!savedAtCurrent&&(
    currentDraftAnswer!==savedAtCurrent.answer || reason.trim()!==(savedAtCurrent.reason||'')
  );

  return <>
    <AccessCodeModal open={accessModal} onClose={()=>setAccessModal(false)} onValidated={async()=>{const fn=pendingAction;setPendingAction(null);if(fn)await fn();}} />
    {stage==='input' && <div className="card" aria-busy={busy}>
      <div className="field"><label className="label">캐릭터 이름</label><input disabled={busy} className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="예: 한서진" /></div>
      <div className="field"><label className="label">공개 프로필</label><textarea disabled={busy} className="textarea" value={profileText} onChange={e=>setProfileText(e.target.value)} placeholder="커뮤에서 공개했던 프로필 내용을 붙여넣으세요. 성격, 외관, 관계, 설정 등을 그대로 넣어도 됩니다." /></div>
      <div className="field"><label className="label">비밀 프로필 <span className="muted">(선택)</span></label><textarea disabled={busy} className="textarea" value={secretProfileText} onChange={e=>setSecretProfileText(e.target.value)} placeholder="오너만 알고 있던 비밀 설정, 숨겨진 동기, 과거, 공개 프로필에 적지 않았던 내용을 붙여넣으세요. 없다면 비워두면 됩니다." /></div>
      <div className="notice">공개 프로필과 비밀 프로필은 서로 다른 정보층으로 구분해 함께 분석합니다. 비밀 프로필 원문은 공유 코드로 보는 Character Passport에 직접 노출하지 않습니다.</div>
      {busy&&<div role="status" aria-live="polite" style={{marginTop:18,padding:'18px 20px',border:'1px solid var(--line)',borderRadius:16,background:'var(--accent-soft)',display:'flex',gap:16,alignItems:'flex-start'}}>
        <div className="loading" style={{fontSize:18,fontWeight:900,whiteSpace:'nowrap'}}>AI 분석 중 <i className="dot"/><i className="dot"/><i className="dot"/></div>
        <div><strong style={{display:'block',marginBottom:5}}>프로필을 읽고 있어요.</strong><p className="muted" style={{margin:0,lineHeight:1.6}}>공개·비밀 프로필을 비교하고 캐릭터 설정, 사실 근거, AI 추론을 정리하는 중입니다. 분석이 끝나면 자동으로 다음 화면으로 이동해요.</p></div>
      </div>}
      {error&&<p className="error">{error}</p>}
      <div className="actions"><button className="btn primary" disabled={busy||name.trim().length<1||profileText.trim().length<20} onClick={()=>gate(parse)}>{busy?<span className="loading">AI 분석 진행 중 <i className="dot"/><i className="dot"/><i className="dot"/></span>:'AI 분석 시작'}</button></div>
    </div>}

    {stage==='review' && draft && <div className="stack">
      <div className="card"><div className="eyebrow">AI first read</div><h2 style={{marginTop:10}}>{draft.basicProfile.name}을 이렇게 이해했어요.</h2><div className="two-col"><div><div className="label">분석 정밀도</div><div style={{fontSize:40,fontWeight:900}}>{Math.round(confidence)}%</div></div><div><div className="label">확인된 설정</div><div style={{fontSize:40,fontWeight:900}}>{draft.confirmedFacts.length}</div></div></div><div className="progress" style={{marginTop:16}}><span style={{width:`${confidence}%`}}/></div></div>
      <div className="card"><h3>AI 추론 검수</h3><p className="muted">프로필의 서로 다른 근거를 연결해 한 단계 더 해석한 내용만 표시합니다. 애매하거나 틀린 해석은 직접 보충해주면 이후 질문과 최종 캐해에 반영돼요.</p>{draft.aiInferences.map(x=><div className="inference" key={x.id}><div className="inference-top"><p>{x.text}</p><span className="muted">{Math.round(x.confidence)}%</span></div>{x.evidence.length>0&&<div style={{marginTop:10}}><div className="label">근거</div><div className="tags" style={{marginTop:7}}>{x.evidence.map((e,i)=><span className="tag" key={`${x.id}-e-${i}`}>{e}</span>)}</div></div>}<div style={{display:'flex',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginTop:10}}><div className="pills" style={{marginTop:0}}><button className={`pill ${x.ownerVerdict==='confirmed'?'active':''}`} onClick={()=>verdict(x.id,'confirmed')}>맞음</button><button className={`pill ${x.ownerVerdict==='ambiguous'?'active':''}`} onClick={()=>verdict(x.id,'ambiguous')}>애매함</button><button className={`pill ${x.ownerVerdict==='rejected'?'active':''}`} onClick={()=>verdict(x.id,'rejected')}>아님</button></div>{(x.ownerVerdict==='ambiguous'||x.ownerVerdict==='rejected')&&<div style={{flex:'1 1 320px',minWidth:240}}><label className="label">{x.ownerVerdict==='ambiguous'?'어떤 부분이 맞고, 어떤 부분이 다른가요?':'실제로는 어떤가요?'}</label><textarea className="input" style={{minHeight:84,resize:'vertical',marginTop:7}} maxLength={1200} value={x.ownerFeedback||''} onChange={e=>inferenceFeedback(x.id,e.target.value)} placeholder={x.ownerVerdict==='ambiguous'?'예: 앞부분은 맞지만, 가까운 사람에게는 오히려 반대로 행동해요.':'예: 실제로는 부탁을 거절하는 데 부담이 없고, 급한 일만 도와줘요.'}/><span className="muted">여기에 적은 내용은 AI 추론보다 오너의 직접 설정으로 우선 반영돼요.</span></div>}</div></div>)}</div>
      <div className="actions"><button className="btn primary" onClick={()=>{setQuestionHistory([]);setAnswers([]);setActiveQuestionIndex(0);gate(c=>nextQuestion(c,[],[]))}}>20문항 인터뷰 시작</button><button className="btn" onClick={()=>setStage('input')}>프로필 다시 입력</button></div>
    </div>}

    {stage==='interview' && question && <div className="card question-card">
      <div><div className="q-meta"><span>{question.order} / 20</span>{viewingPastQuestion&&<span>이전 질문 확인 중</span>}</div><div className="progress" style={{marginTop:10}}><span style={{width:`${(question.order-1)/20*100}%`}}/></div><h2 className="q-title">{question.question}</h2>{!freeResponse&&<div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}</div>}<div className="field"><label className="label">{freeResponse?'직접 답변':'직접 입력'}</label><textarea disabled={busy} className="input" style={{minHeight:freeResponse?130:80,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} placeholder={freeResponse?'이 캐릭터라면 어떤지 자유롭게 적어주세요.':'선택지에 맞는 답이 없다면 직접 적어주세요.'} /></div><div className="field"><label className="label">{freeResponse?'덧붙일 이유·맥락':'왜 그렇게 행동할까요?'} <span className="muted">(선택)</span></label><textarea disabled={busy} className="input" style={{minHeight:78,resize:'vertical'}} value={reason} onChange={e=>setReason(e.target.value)} placeholder={freeResponse?'답변에 덧붙이고 싶은 이유나 예외가 있다면 적어주세요.':'그 행동을 하는 이유나, 사람·상황에 따라 달라지는 조건이 있다면 적어주세요.'} /><span className="muted">이유를 적으면 다음 질문의 분기와 최종 캐해에 함께 반영돼요.</span></div></div>
      <div>{error&&<p className="error">{error}</p>}{busy&&<p className="muted">방금 답한 내용을 유지한 채 다음 질문을 만들고 있어요.</p>}<div className="actions" style={{marginTop:16}}>{activeQuestionIndex>0&&<button className="btn" disabled={busy} onClick={previousQuestion}>← 이전 질문</button>}{viewingPastQuestion&&<button className="btn" disabled={busy} onClick={forwardQuestion}>다음 질문 보기 →</button>}<button className="btn primary" disabled={busy||!(selected||custom.trim())||(!viewingPastQuestion&&question.order<20&&false)} onClick={answerCurrent}>{busy?'다음 질문 만드는 중…':viewingPastQuestion?(currentAnswerChanged?'수정하고 여기서부터 다시 진행':'이 답변부터 다시 진행'):question.order===20?'20문항 완료하고 최종 캐해':'답변하고 다음 질문'}</button></div></div>
    </div>}

    {stage==='finalizing' && <div className="card" style={{textAlign:'center',padding:'90px 24px'}}><div className="loading" style={{fontSize:20,fontWeight:900}}>최종 캐해를 정리하고 있어요 <i className="dot"/><i className="dot"/><i className="dot"/></div><p className="muted">20개의 답변과 답변 이유, 공개·비밀 프로필을 합쳐 Character Passport를 만들고 있습니다.</p>{error&&<p className="error">{error}</p>}</div>}

    {stage==='done' && result && <div className="stack"><div className="card result-hero"><div><div className="eyebrow">Analysis complete</div><h2 style={{marginTop:10}}>Character Passport가 저장됐어요.</h2><p className="muted">다른 프로젝트나 다른 기기에서 이 코드로 캐릭터를 불러올 수 있습니다.</p></div><div><div className="label">공유 코드</div><div className="share-code">{result.shareCode}</div><button className="btn soft" onClick={()=>navigator.clipboard.writeText(result.shareCode)}>코드 복사</button></div></div><div className="actions"><button className="btn primary" onClick={()=>router.push(`/character/${result.shareCode}`)}>완성된 캐해 보기</button><button className="btn" onClick={()=>{setStage('input');setName('');setProfileText('');setSecretProfileText('');setDraft(null);setAnswers([]);setQuestion(null);setQuestionHistory([]);setActiveQuestionIndex(0);setSelected('');setCustom('');setReason('');setResult(null)}}>다른 캐릭터 분석</button></div></div>}
  </>;
}