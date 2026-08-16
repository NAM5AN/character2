'use client';
import { useEffect, useRef, useState } from 'react';
import type { CharacterDraft, InterviewAnswer } from '@/lib/schemas/character';
import type { InterviewQuestion, QuestionResponseType } from '@/lib/schemas/question';
import type { CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';

type Stage = 'input'|'review'|'interview'|'finalizing'|'done';
type FinalizeResult={preview:CharacterReportPreview;shareCode:string;editToken:string};
type SavedStage='input'|'review'|'interview'|'finalizing';
type SavedAnalysisSession={
  version:1;
  stage:SavedStage;
  name:string;
  profileText:string;
  secretProfileText:string;
  draft:CharacterDraft|null;
  answers:InterviewAnswer[];
  question:InterviewQuestion|null;
  questionHistory:InterviewQuestion[];
  activeQuestionIndex:number;
  selected:string;
  custom:string;
  reason:string;
  multiSelected?:string[];
  ranking?:string[];
  sliderValue?:number;
  matrixAnswers?:Record<string,string>;
  secondary?:string;
};

type ResponseData={
  selected?:string;
  custom?:string;
  multiSelected?:string[];
  ranking?:string[];
  sliderValue?:number;
  matrixAnswers?:Record<string,string>;
  secondary?:string;
};

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';

const RESPONSE_TYPE_LABELS:Record<QuestionResponseType,string>={
  fill_blank:'빈칸 채우기',
  sentence_continue:'문장 이어쓰기',
  dialogue_choice:'대사 고르기',
  bipolar_scale:'두 문장 사이',
  ranking:'순위 매기기',
  forced_choice:'둘 중 하나',
  multi_select:'복수 선택',
  least_likely:'가장 하지 않을 것',
  slider:'가능성 슬라이더',
  relationship_matrix:'관계별 반응',
  inner_outer:'속마음 · 실제 행동',
  temporal_compare:'시간별 반응',
  condition_followup:'조건 변화 비교',
  in_character_response:'캐릭터 대사 직접 쓰기',
  owner_meta:'오너 메타 질문',
};

function responseTypeOf(question:InterviewQuestion):QuestionResponseType{
  const candidate=(question as InterviewQuestion&{responseType?:QuestionResponseType}).responseType;
  if(candidate)return candidate;
  return question.format==='free_response'?'in_character_response':'fill_blank';
}

function responseConfigOf(question:InterviewQuestion){
  return (question as InterviewQuestion&{responseConfig?:InterviewQuestion['responseConfig']}).responseConfig||{rows:[],columns:[]};
}

function isSavedSession(value:unknown):value is SavedAnalysisSession{
  if(!value||typeof value!=='object')return false;
  const saved=value as Partial<SavedAnalysisSession>;
  return saved.version===1&&typeof saved.stage==='string';
}

function hasMeaningfulProgress(saved:SavedAnalysisSession){
  return !!(
    saved.name.trim()||saved.profileText.trim()||saved.secretProfileText.trim()||saved.draft||
    saved.answers.length||saved.question||saved.questionHistory.length||saved.selected||saved.custom.trim()||saved.reason.trim()||
    saved.multiSelected?.length||saved.ranking?.length||saved.secondary?.trim()||Object.keys(saved.matrixAnswers||{}).length
  );
}

function responseDataFromAnswer(answer:InterviewAnswer|undefined):ResponseData{
  if(!answer?.branchContext||typeof answer.branchContext!=='object')return{};
  const raw=(answer.branchContext as Record<string,unknown>).responseData;
  if(!raw||typeof raw!=='object')return{};
  return raw as ResponseData;
}

export function AnalyzeFlow(){
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
  const [multiSelected,setMultiSelected]=useState<string[]>([]);
  const [ranking,setRanking]=useState<string[]>([]);
  const [sliderValue,setSliderValue]=useState(50);
  const [matrixAnswers,setMatrixAnswers]=useState<Record<string,string>>({});
  const [secondary,setSecondary]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState<FinalizeResult|null>(null);
  const [resumeCandidate,setResumeCandidate]=useState<SavedAnalysisSession|null>(null);
  const hydrated=useRef(false);
  const persistenceEnabled=useRef(false);

  function resetResponseDraft(){
    setSelected('');
    setCustom('');
    setReason('');
    setMultiSelected([]);
    setRanking([]);
    setSliderValue(50);
    setMatrixAnswers({});
    setSecondary('');
  }

  function restoreSavedSession(saved:SavedAnalysisSession){
    const restoredDraft=saved.draft&&typeof saved.draft==='object'?saved.draft as CharacterDraft:null;
    const restoredAnswers=Array.isArray(saved.answers)?saved.answers as InterviewAnswer[]:[];
    const restoredHistory=Array.isArray(saved.questionHistory)?saved.questionHistory as InterviewQuestion[]:[];
    const requestedIndex=Number.isInteger(saved.activeQuestionIndex)?Number(saved.activeQuestionIndex):Math.max(0,restoredHistory.length-1);
    const restoredIndex=restoredHistory.length?Math.max(0,Math.min(requestedIndex,restoredHistory.length-1)):0;
    const restoredQuestion=(saved.question&&typeof saved.question==='object'?saved.question:null) as InterviewQuestion|null || restoredHistory[restoredIndex] || null;

    setName(typeof saved.name==='string'?saved.name:'');
    setProfileText(typeof saved.profileText==='string'?saved.profileText:'');
    setSecretProfileText(typeof saved.secretProfileText==='string'?saved.secretProfileText:'');
    setDraft(restoredDraft);
    setAnswers(restoredAnswers);
    setQuestionHistory(restoredHistory);
    setQuestion(restoredQuestion);
    setActiveQuestionIndex(restoredIndex);
    setSelected(typeof saved.selected==='string'?saved.selected:'');
    setCustom(typeof saved.custom==='string'?saved.custom:'');
    setReason(typeof saved.reason==='string'?saved.reason:'');
    setMultiSelected(Array.isArray(saved.multiSelected)?saved.multiSelected:[]);
    setRanking(Array.isArray(saved.ranking)?saved.ranking:[]);
    setSliderValue(typeof saved.sliderValue==='number'?saved.sliderValue:50);
    setMatrixAnswers(saved.matrixAnswers&&typeof saved.matrixAnswers==='object'?saved.matrixAnswers:{});
    setSecondary(typeof saved.secondary==='string'?saved.secondary:'');
    setError('');

    if((saved.stage==='interview'||saved.stage==='finalizing')&&restoredDraft&&restoredQuestion)setStage('interview');
    else if(saved.stage==='review'&&restoredDraft)setStage('review');
    else setStage('input');
  }

  function clearProgressState(){
    setStage('input');
    setName('');
    setProfileText('');
    setSecretProfileText('');
    setDraft(null);
    setAnswers([]);
    setQuestion(null);
    setQuestionHistory([]);
    setActiveQuestionIndex(0);
    resetResponseDraft();
    setBusy(false);
    setError('');
    setResult(null);
  }

  useEffect(()=>{
    try{
      const localRaw=localStorage.getItem(ANALYSIS_SESSION_KEY);
      const legacyRaw=sessionStorage.getItem(ANALYSIS_SESSION_KEY);
      const raw=localRaw||legacyRaw;
      if(raw){
        const parsed=JSON.parse(raw) as unknown;
        if(isSavedSession(parsed)&&hasMeaningfulProgress(parsed)){
          if(!localRaw)localStorage.setItem(ANALYSIS_SESSION_KEY,raw);
          sessionStorage.removeItem(ANALYSIS_SESSION_KEY);
          setResumeCandidate(parsed);
          persistenceEnabled.current=false;
        }else{
          localStorage.removeItem(ANALYSIS_SESSION_KEY);
          sessionStorage.removeItem(ANALYSIS_SESSION_KEY);
          persistenceEnabled.current=true;
        }
      }else persistenceEnabled.current=true;
    }catch{
      localStorage.removeItem(ANALYSIS_SESSION_KEY);
      sessionStorage.removeItem(ANALYSIS_SESSION_KEY);
      persistenceEnabled.current=true;
    }finally{
      hydrated.current=true;
    }
  },[]);

  useEffect(()=>{
    if(!hydrated.current||!persistenceEnabled.current||stage==='done')return;
    const timer=window.setTimeout(()=>{
      try{
        const saved:SavedAnalysisSession={
          version:1,
          stage:stage as SavedStage,
          name,
          profileText,
          secretProfileText,
          draft,
          answers,
          question,
          questionHistory,
          activeQuestionIndex,
          selected,
          custom,
          reason,
          multiSelected,
          ranking,
          sliderValue,
          matrixAnswers,
          secondary,
        };
        if(hasMeaningfulProgress(saved))localStorage.setItem(ANALYSIS_SESSION_KEY,JSON.stringify(saved));
        else localStorage.removeItem(ANALYSIS_SESSION_KEY);
      }catch{}
    },150);
    return()=>window.clearTimeout(timer);
  },[stage,name,profileText,secretProfileText,draft,answers,question,questionHistory,activeQuestionIndex,selected,custom,reason,multiSelected,ranking,sliderValue,matrixAnswers,secondary]);

  function continueSavedAnalysis(){
    if(!resumeCandidate)return;
    persistenceEnabled.current=false;
    restoreSavedSession(resumeCandidate);
    setResumeCandidate(null);
    window.setTimeout(()=>{persistenceEnabled.current=true},0);
  }

  function startFreshAnalysis(){
    persistenceEnabled.current=false;
    localStorage.removeItem(ANALYSIS_SESSION_KEY);
    sessionStorage.removeItem(ANALYSIS_SESSION_KEY);
    setResumeCandidate(null);
    clearProgressState();
    window.setTimeout(()=>{persistenceEnabled.current=true},0);
  }

  function handleApiError(status:number,body:any){setError(body?.error==='RATE_LIMITED'?'요청이 너무 많아요. 잠시 뒤 다시 시도해주세요.':`처리 중 오류가 발생했어요. (${body?.error||status})`)}
  async function parse(){setBusy(true);setError('');try{const r=await fetch('/api/characters/parse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,profileText,secretProfileText})});const body=await r.json();if(!r.ok){handleApiError(r.status,body);return}setDraft(body.draft);setStage('review')}finally{setBusy(false)}}
  function verdict(id:string,ownerVerdict:'confirmed'|'ambiguous'|'rejected'){if(!draft)return;setDraft({...draft,aiInferences:draft.aiInferences.map(x=>{if(x.id!==id)return x;if(ownerVerdict==='confirmed'){const {ownerFeedback:_ownerFeedback,...rest}=x;return {...rest,ownerVerdict}}return {...x,ownerVerdict}})})}
  function inferenceFeedback(id:string,ownerFeedback:string){if(!draft)return;setDraft({...draft,aiInferences:draft.aiInferences.map(x=>x.id===id?{...x,ownerFeedback}:x)})}

  function restoreAnswerFor(index:number,q:InterviewQuestion){
    const saved=answers[index];
    const data=responseDataFromAnswer(saved);
    setQuestion(q);
    setActiveQuestionIndex(index);
    resetResponseDraft();
    if(!saved)return;
    if(Object.keys(data).length){
      setSelected(typeof data.selected==='string'?data.selected:'');
      setCustom(typeof data.custom==='string'?data.custom:'');
      setMultiSelected(Array.isArray(data.multiSelected)?data.multiSelected:[]);
      setRanking(Array.isArray(data.ranking)?data.ranking:[]);
      setSliderValue(typeof data.sliderValue==='number'?data.sliderValue:50);
      setMatrixAnswers(data.matrixAnswers&&typeof data.matrixAnswers==='object'?data.matrixAnswers:{});
      setSecondary(typeof data.secondary==='string'?data.secondary:'');
    }else{
      const matched=q.options.includes(saved.answer);
      setSelected(matched?saved.answer:'');
      setCustom(matched?'':saved.answer);
    }
    setReason(saved.reason||'');
  }

  async function nextQuestion(currentAnswers=answers,historyBase=questionHistory){if(!draft)return;setBusy(true);setError('');try{const r=await fetch('/api/characters/questions/next',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,answers:currentAnswers})});const body=await r.json();if(!r.ok){handleApiError(r.status,body);return}if(body.done){await finalize(currentAnswers);return}const nextHistory=[...historyBase,body.question];setQuestionHistory(nextHistory);setQuestion(body.question);setActiveQuestionIndex(nextHistory.length-1);resetResponseDraft();setStage('interview')}finally{setBusy(false)}}

  function buildCurrentAnswer(){
    if(!question)return null;
    const type=responseTypeOf(question);
    const config=responseConfigOf(question);
    const customAnswer=custom.trim();
    const reasonText=reason.trim();
    let answer='';
    let answerSource:'choice'|'custom'|'structured'='structured';

    if(type==='fill_blank'||type==='dialogue_choice'||type==='owner_meta'){
      answer=(customAnswer||selected).trim();
      answerSource=customAnswer?'custom':'choice';
    }else if(type==='sentence_continue'||type==='in_character_response'){
      answer=customAnswer;
      answerSource='custom';
    }else if(type==='bipolar_scale'){
      if(selected)answer=`${config.leftLabel||'A'} ← ${selected}/5 → ${config.rightLabel||'B'}`;
    }else if(type==='ranking'){
      if(ranking.length===question.options.length)answer=ranking.map((item,index)=>`${index+1}위 ${item}`).join(' > ');
    }else if(type==='forced_choice'){
      answer=selected;
      answerSource='choice';
    }else if(type==='multi_select'){
      if(multiSelected.length)answer=`복수 선택: ${multiSelected.join(', ')}`;
    }else if(type==='least_likely'){
      if(selected)answer=`가장 하지 않을 것: ${selected}`;
      answerSource='choice';
    }else if(type==='slider'){
      answer=`${sliderValue}/100 (${config.minLabel||'낮음'} ↔ ${config.maxLabel||'높음'})`;
    }else if(type==='relationship_matrix'){
      const rows=config.rows||[];
      if(rows.length&&rows.every(row=>matrixAnswers[row]))answer=rows.map(row=>`${row}: ${matrixAnswers[row]}`).join(' / ');
    }else if(type==='inner_outer'){
      if(customAnswer&&secondary.trim())answer=`속마음: ${customAnswer} / 실제 행동: ${secondary.trim()}`;
      answerSource='custom';
    }else if(type==='temporal_compare'){
      if(selected&&secondary)answer=`${config.leftLabel||'처음'}: ${selected} / ${config.rightLabel||'나중'}: ${secondary}`;
    }else if(type==='condition_followup'){
      if(selected&&secondary)answer=`기본 상황: ${selected} / 조건 변경 후: ${secondary}`;
    }

    if(!answer.trim())return null;
    const responseData:ResponseData={selected,custom,multiSelected,ranking,sliderValue,matrixAnswers,secondary};
    return {
      order:question.order,
      question:question.question,
      answer:answer.trim(),
      ...(reasonText?{reason:reasonText}:{}),
      branchContext:{
        category:question.category,
        mode:question.mode,
        format:question.format,
        responseType:type,
        targetHook:question.targetHook,
        hypothesis:question.hypothesis,
        answerSource,
        responseData,
      },
    } satisfies InterviewAnswer;
  }

  async function answerCurrent(){if(!question)return;const current=buildCurrentAnswer();if(!current)return;const editingPast=activeQuestionIndex<questionHistory.length-1;if(editingPast){const next=[...answers.slice(0,activeQuestionIndex),current];const nextHistory=questionHistory.slice(0,activeQuestionIndex+1);setAnswers(next);setQuestionHistory(nextHistory);if(next.length===20)await finalize(next);else await nextQuestion(next,nextHistory);return}const next=[...answers,current];setAnswers(next);if(next.length===20)await finalize(next);else await nextQuestion(next,questionHistory)}
  function previousQuestion(){if(busy||activeQuestionIndex<=0)return;const i=activeQuestionIndex-1;const q=questionHistory[i];if(q)restoreAnswerFor(i,q)}
  function forwardQuestion(){if(busy||activeQuestionIndex>=questionHistory.length-1)return;const i=activeQuestionIndex+1;const q=questionHistory[i];if(q)restoreAnswerFor(i,q)}
  async function finalize(finalAnswers=answers){if(!draft)return;setStage('finalizing');setBusy(true);setError('');try{const r=await fetch('/api/characters/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,answers:finalAnswers})});const body=await r.json();if(!r.ok){handleApiError(r.status,body);setStage('interview');return}persistenceEnabled.current=false;localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);localStorage.setItem(`chara_edit_${body.shareCode}`,body.editToken);setResult(body);setStage('done')}finally{setBusy(false)}}

  function toggleMulti(option:string){
    const max=question?responseConfigOf(question).maxSelections:undefined;
    setMultiSelected(current=>{
      if(current.includes(option))return current.filter(item=>item!==option);
      if(max&&current.length>=max)return current;
      return [...current,option];
    });
  }

  function addRank(option:string){setRanking(current=>current.includes(option)?current:[...current,option])}
  function removeRank(option:string){setRanking(current=>current.filter(item=>item!==option))}
  function moveRank(index:number,direction:-1|1){setRanking(current=>{const next=[...current];const target=index+direction;if(target<0||target>=next.length)return current;[next[index],next[target]]=[next[target],next[index]];return next})}

  function renderResponseControls(){
    if(!question)return null;
    const type=responseTypeOf(question);
    const config=responseConfigOf(question);

    if(type==='fill_blank')return <>
      <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}</div>
      <div className="field"><label className="label">직접 빈칸 채우기</label><textarea disabled={busy} className="input" style={{minHeight:76,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} /></div>
    </>;

    if(type==='sentence_continue')return <div className="field"><label className="label">문장을 이어 써주세요</label><textarea disabled={busy} className="input" style={{minHeight:120,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></div>;

    if(type==='dialogue_choice')return <>
      <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>“{o}”</button>)}</div>
      <div className="field"><label className="label">직접 대사 입력</label><textarea disabled={busy} className="input" style={{minHeight:76,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} /></div>
    </>;

    if(type==='bipolar_scale')return <div style={{marginTop:20}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,fontWeight:800,fontSize:14}}><span>{config.leftLabel}</span><span style={{textAlign:'right'}}>{config.rightLabel}</span></div>
      <div className="options" style={{gridTemplateColumns:'repeat(5,minmax(0,1fr))',marginTop:10}}>{[
        ['1','A에 매우 가까움'],['2','A에 조금 가까움'],['3','반반'],['4','B에 조금 가까움'],['5','B에 매우 가까움'],
      ].map(([value,label])=><button disabled={busy} key={value} className={`option ${selected===value?'selected':''}`} style={{padding:'14px 8px'}} onClick={()=>setSelected(value)}>{label}</button>)}</div>
    </div>;

    if(type==='ranking'){
      const remaining=question.options.filter(o=>!ranking.includes(o));
      return <div style={{marginTop:18}}>
        <p className="muted">중요한 순서대로 눌러주세요. 먼저 누른 항목이 1위가 됩니다.</p>
        {ranking.length>0&&<div className="stack" style={{gap:8,marginBottom:14}}>{ranking.map((item,index)=><div key={item} style={{display:'flex',alignItems:'center',gap:8,padding:'12px 14px',border:'1px solid var(--line)',borderRadius:12}}><strong style={{minWidth:40}}>{index+1}위</strong><span style={{flex:1}}>{item}</span><button className="btn" disabled={busy||index===0} style={{padding:'6px 9px'}} onClick={()=>moveRank(index,-1)}>↑</button><button className="btn" disabled={busy||index===ranking.length-1} style={{padding:'6px 9px'}} onClick={()=>moveRank(index,1)}>↓</button><button className="btn" disabled={busy} style={{padding:'6px 9px'}} onClick={()=>removeRank(item)}>×</button></div>)}</div>}
        {remaining.length>0&&<div className="options">{remaining.map(o=><button disabled={busy} key={o} className="option" onClick={()=>addRank(o)}>{o}</button>)}</div>}
      </div>;
    }

    if(type==='forced_choice')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div>;

    if(type==='multi_select')return <>
      <p className="muted" style={{marginTop:18}}>해당되는 것을 모두 골라주세요.{config.maxSelections?` 최대 ${config.maxSelections}개까지 선택할 수 있어요.`:''}</p>
      <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${multiSelected.includes(o)?'selected':''}`} onClick={()=>toggleMulti(o)}>{multiSelected.includes(o)?'✓ ':''}{o}</button>)}</div>
    </>;

    if(type==='least_likely')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div>;

    if(type==='slider')return <div style={{marginTop:24}}>
      <div style={{textAlign:'center',fontSize:34,fontWeight:900,marginBottom:10}}>{sliderValue}<span className="muted" style={{fontSize:16}}> / 100</span></div>
      <input disabled={busy} type="range" min={0} max={100} step={1} value={sliderValue} onChange={e=>setSliderValue(Number(e.target.value))} style={{width:'100%'}} />
      <div style={{display:'flex',justifyContent:'space-between',gap:20,marginTop:8,fontSize:13,fontWeight:700}}><span>{config.minLabel}</span><span style={{textAlign:'right'}}>{config.maxLabel}</span></div>
    </div>;

    if(type==='relationship_matrix')return <div style={{marginTop:20}}>{config.rows.map(row=><div key={row} style={{padding:'14px 0',borderBottom:'1px solid var(--line)'}}><div className="label" style={{marginBottom:8}}>{row}</div><div className="options">{config.columns.map(column=><button disabled={busy} key={column} className={`option ${matrixAnswers[row]===column?'selected':''}`} onClick={()=>setMatrixAnswers(current=>({...current,[row]:column}))}>{column}</button>)}</div></div>)}</div>;

    if(type==='inner_outer')return <>
      <div className="field"><label className="label">속으로 가장 먼저 드는 생각</label><textarea disabled={busy} className="input" style={{minHeight:100,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></div>
      <div className="field"><label className="label">{config.prompt2||'실제로 겉으로 보이는 행동'}</label><textarea disabled={busy} className="input" style={{minHeight:100,resize:'vertical'}} value={secondary} onChange={e=>setSecondary(e.target.value)} /></div>
    </>;

    if(type==='temporal_compare')return <div className="two-col" style={{marginTop:20}}>
      <div className="field"><label className="label">{config.leftLabel||'직후'}</label><select disabled={busy} className="input" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">선택</option>{question.options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
      <div className="field"><label className="label">{config.rightLabel||'시간이 지난 뒤'}</label><select disabled={busy} className="input" value={secondary} onChange={e=>setSecondary(e.target.value)}><option value="">선택</option>{question.options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
    </div>;

    if(type==='condition_followup')return <>
      <div className="field"><label className="label">기본 상황</label><select disabled={busy} className="input" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">선택</option>{question.options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
      <div className="field"><label className="label">{config.prompt2}</label><select disabled={busy} className="input" value={secondary} onChange={e=>setSecondary(e.target.value)}><option value="">선택</option>{question.options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
    </>;

    if(type==='in_character_response')return <div className="field"><label className="label">캐릭터라면 뭐라고 말할까요?</label><textarea disabled={busy} className="input" style={{minHeight:130,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></div>;

    return <>
      <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}</div>
      <div className="field"><label className="label">직접 입력</label><textarea disabled={busy} className="input" style={{minHeight:84,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} /></div>
    </>;
  }

  const confidence=draft?.analysisConfidence??0;
  const viewingPastQuestion=activeQuestionIndex<questionHistory.length-1;
  const savedAtCurrent=answers[activeQuestionIndex];
  const currentBuilt=buildCurrentAnswer();
  const currentAnswerChanged=!!savedAtCurrent&&!!currentBuilt&&(currentBuilt.answer!==savedAtCurrent.answer||(currentBuilt.reason||'')!==(savedAtCurrent.reason||''));
  const hasCurrentResponse=!!currentBuilt;
  const responseType=question?responseTypeOf(question):null;
  const resumeProgress=resumeCandidate
    ? (resumeCandidate.stage==='interview'||resumeCandidate.stage==='finalizing')
      ? `인터뷰 ${Math.min(20,resumeCandidate.answers.length+(resumeCandidate.question?1:0))}/20 진행 중`
      : resumeCandidate.stage==='review'
        ? '프로필 분석과 AI 추론 검수 단계'
        : '프로필 작성 중'
    : '';

  return <>
    {stage==='input'&&<div className="card" aria-busy={busy}>
      {resumeCandidate&&<div style={{marginBottom:24,padding:'20px 22px',border:'1px solid var(--line)',borderRadius:16,background:'var(--accent-soft)'}}>
        <div className="eyebrow">Saved progress</div>
        <h3 style={{margin:'8px 0 8px'}}>작성하던 캐릭터 분석이 있어요.</h3>
        <p className="muted" style={{margin:'0 0 4px'}}>이전에 입력한 프로필과 답변을 불러와서 계속할까요?</p>
        <p style={{margin:'0 0 16px',fontWeight:800}}>{resumeCandidate.name||'이름 미입력'} · {resumeProgress}</p>
        <div className="actions" style={{marginTop:0}}><button className="btn primary" onClick={continueSavedAnalysis}>이어하기</button><button className="btn" onClick={startFreshAnalysis}>처음부터 하기</button></div>
      </div>}
      <div className="field"><label className="label">캐릭터 이름</label><input disabled={busy||!!resumeCandidate} className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="예: 한서진" /></div>
      <div className="field"><label className="label">공개 프로필</label><textarea disabled={busy||!!resumeCandidate} className="textarea" value={profileText} onChange={e=>setProfileText(e.target.value)} placeholder="커뮤에서 공개했던 프로필 내용을 붙여넣으세요. 성격, 외관, 관계, 설정 등을 그대로 넣어도 됩니다." /></div>
      <div className="field"><label className="label">비밀 프로필 <span className="muted">(선택)</span></label><textarea disabled={busy||!!resumeCandidate} className="textarea" value={secretProfileText} onChange={e=>setSecretProfileText(e.target.value)} placeholder="오너만 알고 있던 비밀 설정, 숨겨진 동기, 과거, 공개 프로필에 적지 않았던 내용을 붙여넣으세요. 없다면 비워두면 됩니다." /></div>
      <div className="notice">공개 프로필과 비밀 프로필은 서로 다른 정보층으로 구분해 함께 분석합니다. 비밀 프로필 원문은 공유 코드로 보는 Character Passport에 직접 노출하지 않습니다.</div>
      {busy&&<div role="status" aria-live="polite" style={{marginTop:18,padding:'18px 20px',border:'1px solid var(--line)',borderRadius:16,background:'var(--accent-soft)',display:'flex',gap:16,alignItems:'flex-start'}}><div className="loading" style={{fontSize:18,fontWeight:900,whiteSpace:'nowrap'}}>AI 분석 중 <i className="dot"/><i className="dot"/><i className="dot"/></div><div><strong style={{display:'block',marginBottom:5}}>프로필을 읽고 있어요.</strong><p className="muted" style={{margin:0,lineHeight:1.6}}>공개·비밀 프로필을 비교하고 캐릭터 설정, 사실 근거, AI 추론을 정리하는 중입니다. 분석이 끝나면 자동으로 다음 화면으로 이동해요.</p></div></div>}
      {error&&<p className="error">{error}</p>}
      <div className="actions"><button className="btn primary" disabled={busy||!!resumeCandidate||name.trim().length<1||profileText.trim().length<20} onClick={parse}>{busy?<span className="loading">AI 분석 진행 중 <i className="dot"/><i className="dot"/><i className="dot"/></span>:'AI 분석 시작'}</button></div>
    </div>}

    {stage==='review'&&draft&&<div className="stack" aria-busy={busy}>
      <div className="card"><div className="eyebrow">AI first read</div><h2 style={{marginTop:10}}>{draft.basicProfile.name}을 이렇게 이해했어요.</h2><div className="two-col"><div><div className="label">분석 정밀도</div><div style={{fontSize:40,fontWeight:900}}>{Math.round(confidence)}%</div></div><div><div className="label">확인된 설정</div><div style={{fontSize:40,fontWeight:900}}>{draft.confirmedFacts.length}</div></div></div><div className="progress" style={{marginTop:16}}><span style={{width:`${confidence}%`}}/></div></div>
      <div className="card"><h3>AI 추론 검수</h3><p className="muted">프로필의 서로 다른 근거를 연결해 한 단계 더 해석한 내용만 표시합니다. 애매하거나 틀린 해석은 직접 보충해주면 이후 질문과 최종 캐해에 반영돼요.</p>{draft.aiInferences.map(x=><div className="inference" key={x.id}><div className="inference-top"><p>{x.text}</p><span className="muted">{Math.round(x.confidence)}%</span></div>{x.evidence.length>0&&<div style={{marginTop:10}}><div className="label">근거</div><div className="tags" style={{marginTop:7}}>{x.evidence.map((e,i)=><span className="tag" key={`${x.id}-e-${i}`}>{e}</span>)}</div></div>}<div style={{display:'flex',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginTop:10}}><div className="pills" style={{marginTop:0}}><button disabled={busy} className={`pill ${x.ownerVerdict==='confirmed'?'active':''}`} onClick={()=>verdict(x.id,'confirmed')}>맞음</button><button disabled={busy} className={`pill ${x.ownerVerdict==='ambiguous'?'active':''}`} onClick={()=>verdict(x.id,'ambiguous')}>애매함</button><button disabled={busy} className={`pill ${x.ownerVerdict==='rejected'?'active':''}`} onClick={()=>verdict(x.id,'rejected')}>아님</button></div>{(x.ownerVerdict==='ambiguous'||x.ownerVerdict==='rejected')&&<div style={{flex:'1 1 320px',minWidth:240}}><label className="label">{x.ownerVerdict==='ambiguous'?'어떤 부분이 맞고, 어떤 부분이 다른가요?':'실제로는 어떤가요?'}</label><textarea disabled={busy} className="input" style={{minHeight:84,resize:'vertical',marginTop:7}} maxLength={1200} value={x.ownerFeedback||''} onChange={e=>inferenceFeedback(x.id,e.target.value)} /><span className="muted">여기에 적은 내용은 AI 추론보다 오너의 직접 설정으로 우선 반영돼요.</span></div>}</div></div>)}</div>
      {busy&&<div role="status" aria-live="polite" className="card" style={{padding:'22px 24px',background:'var(--accent-soft)',display:'flex',gap:16,alignItems:'flex-start'}}><div className="loading" style={{fontSize:18,fontWeight:900,whiteSpace:'nowrap'}}>인터뷰 질문 준비 중 <i className="dot"/><i className="dot"/><i className="dot"/></div><div><strong style={{display:'block',marginBottom:5}}>첫 질문을 만들고 있어요.</strong><p className="muted" style={{margin:0,lineHeight:1.6}}>프로필과 방금 검수한 AI 추론을 바탕으로 이 캐릭터에게 맞는 첫 인터뷰 질문을 생성하는 중입니다.</p></div></div>}
      <div className="actions"><button disabled={busy} className="btn primary" onClick={()=>{setQuestionHistory([]);setAnswers([]);setActiveQuestionIndex(0);nextQuestion([],[])}}>{busy?<span className="loading">인터뷰 질문 준비 중 <i className="dot"/><i className="dot"/><i className="dot"/></span>:'20문항 인터뷰 시작'}</button><button disabled={busy} className="btn" onClick={()=>setStage('input')}>프로필 다시 입력</button></div>
    </div>}

    {stage==='interview'&&question&&<div className="card question-card">
      <div>
        <div className="q-meta"><span>{question.order} / 20</span>{responseType&&<span>{RESPONSE_TYPE_LABELS[responseType]}</span>}{viewingPastQuestion&&<span>이전 질문 확인 중</span>}</div>
        <div className="progress" style={{marginTop:10}}><span style={{width:`${(question.order-1)/20*100}%`}}/></div>
        <h2 className="q-title">{question.question}</h2>
        {renderResponseControls()}
        <div className="field"><label className="label">왜 그렇게 답했나요? <span className="muted">(선택)</span></label><textarea disabled={busy} className="input" style={{minHeight:78,resize:'vertical'}} value={reason} onChange={e=>setReason(e.target.value)} /><span className="muted">여기에 적은 이유·맥락은 원문 그대로 다음 질문과 최종 캐해에 반영돼요.</span></div>
      </div>
      <div>{error&&<p className="error">{error}</p>}{busy&&<p className="muted">방금 답한 내용을 유지한 채 다음 질문을 만들고 있어요.</p>}<div className="actions" style={{marginTop:16}}>{activeQuestionIndex>0&&<button className="btn" disabled={busy} onClick={previousQuestion}>← 이전 질문</button>}{viewingPastQuestion&&<button className="btn" disabled={busy} onClick={forwardQuestion}>다음 질문 보기 →</button>}<button className="btn primary" disabled={busy||!hasCurrentResponse} onClick={answerCurrent}>{busy?'다음 질문 만드는 중…':viewingPastQuestion?(currentAnswerChanged?'수정하고 여기서부터 다시 진행':'이 답변부터 다시 진행'):question.order===20?'20문항 완료하고 요약 보기':'답변하고 다음 질문'}</button></div></div>
    </div>}

    {stage==='finalizing'&&<div className="card" style={{textAlign:'center',padding:'90px 24px'}}><div className="loading" style={{fontSize:20,fontWeight:900}}>캐릭터 요약을 정리하고 있어요 <i className="dot"/><i className="dot"/><i className="dot"/></div><p className="muted">20개의 답변과 프로필을 합쳐 무료 요약을 만들고 있습니다. 상세 리포트는 결제 코드 확인 후에만 생성돼요.</p>{error&&<p className="error">{error}</p>}</div>}
    {stage==='done'&&result&&<CharacterReportView preview={result.preview} creatorEditToken={result.editToken}/>} 
  </>;
}
