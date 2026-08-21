'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CharacterDraft, InterviewAnswer } from '@/lib/schemas/character';
import type { InterviewQuestion, QuestionResponseType } from '@/lib/schemas/question';
import type { CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';
import { AppearanceImageInput, clearAppearanceImages, getAppearanceImagesForRequest } from '@/components/AppearanceImageInput';
import { postJsonStream } from '@/lib/stream-client';
import { useRotatingFlavor } from '@/lib/loading-flavor';
import { applyName } from '@/lib/josa';

type Stage='input'|'review'|'interview'|'finalizing'|'done'|'replay';
type FinalizeResult={preview:CharacterReportPreview;shareCode:string;editToken:string};
type SavedStage='input'|'review'|'interview'|'finalizing';
type SavedAnalysisSession={version:1;stage:SavedStage;name:string;profileText:string;secretProfileText:string;draft:CharacterDraft|null;answers:InterviewAnswer[];question:InterviewQuestion|null;questionHistory:InterviewQuestion[];activeQuestionIndex:number;selected:string;custom:string;reason:string;multiSelected?:string[];ranking?:string[];sliderValue?:number;matrixAnswers?:Record<string,string>;secondary?:string};
type ResponseData={selected?:string;custom?:string;multiSelected?:string[];ranking?:string[];sliderValue?:number;matrixAnswers?:Record<string,string>;secondary?:string};

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';

function responseTypeOf(question:InterviewQuestion):QuestionResponseType{const candidate=(question as InterviewQuestion&{responseType?:QuestionResponseType}).responseType;return candidate||(question.format==='free_response'?'in_character_response':'fill_blank')}
function responseConfigOf(question:InterviewQuestion){return (question as InterviewQuestion&{responseConfig?:InterviewQuestion['responseConfig']}).responseConfig||{rows:[],columns:[],rowOptions:{},options2:[]}}
function isSavedSession(value:unknown):value is SavedAnalysisSession{if(!value||typeof value!=='object')return false;const saved=value as Partial<SavedAnalysisSession>;return saved.version===1&&typeof saved.stage==='string'}
function uniqueAnswersByOrder(items:InterviewAnswer[]){const byOrder=new Map<number,InterviewAnswer>();for(const item of items){if(Number.isInteger(item.order)&&item.order>=1&&item.order<=20)byOrder.set(item.order,item)}return [...byOrder.values()].sort((a,b)=>a.order-b.order)}
function upsertAnswer(items:InterviewAnswer[],answer:InterviewAnswer){return uniqueAnswersByOrder([...items.filter(item=>item.order!==answer.order),answer])}
function firstMissingOrder(items:InterviewAnswer[]){const orders=new Set(uniqueAnswersByOrder(items).map(item=>item.order));for(let order=1;order<=20;order+=1)if(!orders.has(order))return order;return null}
function mergeQuestionHistory(base:InterviewQuestion[],incoming:InterviewQuestion[]){const byOrder=new Map<number,InterviewQuestion>();for(const item of base)byOrder.set(item.order,item);for(const item of incoming)byOrder.set(item.order,item);return [...byOrder.values()].sort((a,b)=>a.order-b.order)}
function hasMeaningfulProgress(saved:SavedAnalysisSession){return !!(saved.name.trim()||saved.profileText.trim()||saved.secretProfileText.trim()||saved.draft||saved.answers.length||saved.question||saved.questionHistory.length||saved.selected||saved.custom.trim()||saved.reason.trim()||saved.multiSelected?.length||saved.ranking?.length||saved.secondary?.trim()||Object.keys(saved.matrixAnswers||{}).length)}
function responseDataFromAnswer(answer:InterviewAnswer|undefined):ResponseData{if(!answer?.branchContext||typeof answer.branchContext!=='object')return{};const raw=(answer.branchContext as Record<string,unknown>).responseData;return raw&&typeof raw==='object'?raw as ResponseData:{}}
function RankingActionIcon({direction}:{direction:'up'|'down'|'remove'}){
  const path=direction==='up'?'M5 10.5 12 3.5l7 7M12 4v16':direction==='down'?'M5 13.5 12 20.5l7-7M12 20V4':'M5.5 5.5l13 13M18.5 5.5l-13 13';
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d={path} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
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
  const [draggingRankItem,setDraggingRankItem]=useState<string|null>(null);
  const [sliderValue,setSliderValue]=useState(50);
  const [matrixAnswers,setMatrixAnswers]=useState<Record<string,string>>({});
  const [secondary,setSecondary]=useState('');
  const [busy,setBusy]=useState(false);
  const [parseProgress,setParseProgress]=useState(0);
  const [finalizeProgress,setFinalizeProgress]=useState(0);
  const [error,setError]=useState('');
  const [result,setResult]=useState<FinalizeResult|null>(null);
  const [resumeCandidate,setResumeCandidate]=useState<SavedAnalysisSession|null>(null);
  const hydrated=useRef(false);
  const persistenceEnabled=useRef(false);
  const questionHistoryRef=useRef<InterviewQuestion[]>([]);
  const batchRequests=useRef<Map<number,Promise<InterviewQuestion[]>>>(new Map());
  const temporalRepairRequests=useRef<Set<string>>(new Set());
  const rankingDragIndexRef=useRef<number|null>(null);
  const rankingDragPointerOffsetRef=useRef(0);
  const rankingListRef=useRef<HTMLDivElement|null>(null);
  const rankingRowRefs=useRef<Map<string,HTMLDivElement>>(new Map());
  const rankingDragPositionsRef=useRef<Map<string,number>|null>(null);

  useEffect(()=>{questionHistoryRef.current=questionHistory},[questionHistory]);
  useLayoutEffect(()=>{const previous=rankingDragPositionsRef.current;if(!previous)return;rankingDragPositionsRef.current=null;ranking.forEach(item=>{const row=rankingRowRefs.current.get(item);const before=previous.get(item);if(!row||before===undefined)return;const delta=before-row.getBoundingClientRect().top;if(Math.abs(delta)<1)return;const scale=draggingRankItem===item?' scale(1.015)':'';row.animate([{transform:`translateY(${delta}px)${scale}`},{transform:`translateY(0)${scale}`}],{duration:220,easing:'cubic-bezier(.22, 1, .36, 1)'})})},[ranking,draggingRankItem]);

  function resetResponseDraft(){setSelected('');setCustom('');setReason('');setMultiSelected([]);setRanking([]);rankingDragIndexRef.current=null;setDraggingRankItem(null);setSliderValue(50);setMatrixAnswers({});setSecondary('')}
  function setHistory(next:InterviewQuestion[]){questionHistoryRef.current=next;setQuestionHistory(next)}

  function applyQuestion(q:InterviewQuestion,history:InterviewQuestion[],answerList=answers){
    const index=Math.max(0,history.findIndex(item=>item.order===q.order));
    const saved=answerList.find(answer=>answer.order===q.order);
    const data=responseDataFromAnswer(saved);
    setHistory(history);setQuestion(q);setActiveQuestionIndex(index);resetResponseDraft();setError('');
    if(responseTypeOf(q)==='temporal_compare'){
      const config=responseConfigOf(q);const first=q.options.slice(0,4).map(item=>item.trim()).sort();const second=(config.options2||[]).slice(0,4).map(item=>item.trim()).sort();const same=first.length===4&&second.length===4&&first.join('\u0001')===second.join('\u0001');const repairKey=`${draft?.usageSessionId||'session'}:${q.order}`;
      if((second.length!==4||same)&&draft&&!temporalRepairRequests.current.has(repairKey)){
        temporalRepairRequests.current.add(repairKey);
        void (async()=>{try{const r=await fetch('/api/characters/questions/temporal-options',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,question:q})});const body=await r.json().catch(()=>({}));if(!r.ok||!Array.isArray(body.options2)||body.options2.length!==4)return;const patched={...q,responseConfig:{...q.responseConfig,options2:body.options2}} as InterviewQuestion;setQuestion(current=>current?.order===q.order?patched:current);setHistory(questionHistoryRef.current.map(item=>item.order===q.order?patched:item))}catch{}})();
      }
    }
    if(saved){
      if(Object.keys(data).length){setSelected(typeof data.selected==='string'?data.selected:'');setCustom(typeof data.custom==='string'?data.custom:'');setMultiSelected(Array.isArray(data.multiSelected)?data.multiSelected:[]);setRanking(Array.isArray(data.ranking)?data.ranking:[]);setSliderValue(typeof data.sliderValue==='number'?data.sliderValue:50);setMatrixAnswers(data.matrixAnswers&&typeof data.matrixAnswers==='object'?data.matrixAnswers:{});setSecondary(typeof data.secondary==='string'?data.secondary:'')}
      else{const matched=q.options.includes(saved.answer);setSelected(matched?saved.answer:'');setCustom(matched?'':saved.answer)}
      setReason(saved.reason||'');
    }
    setStage('interview');
    if(q.order<20&&!history.some(item=>item.order===q.order+1)){
      void requestBatch(q.order+1,answerList,history).catch(()=>{});
    }
  }

  function restoreSavedSession(saved:SavedAnalysisSession){
    const restoredDraft=saved.draft&&typeof saved.draft==='object'?saved.draft as CharacterDraft:null;
    const restoredAnswers=Array.isArray(saved.answers)?uniqueAnswersByOrder(saved.answers as InterviewAnswer[]):[];
    const restoredHistory=Array.isArray(saved.questionHistory)?mergeQuestionHistory([],saved.questionHistory as InterviewQuestion[]):[];
    const requestedIndex=Number.isInteger(saved.activeQuestionIndex)?Number(saved.activeQuestionIndex):Math.max(0,restoredHistory.length-1);
    const restoredIndex=restoredHistory.length?Math.max(0,Math.min(requestedIndex,restoredHistory.length-1)):0;
    const restoredQuestion=(saved.question&&typeof saved.question==='object'?saved.question:null) as InterviewQuestion|null || restoredHistory[restoredIndex] || null;
    setName(typeof saved.name==='string'?saved.name:'');setProfileText(typeof saved.profileText==='string'?saved.profileText:'');setSecretProfileText(typeof saved.secretProfileText==='string'?saved.secretProfileText:'');setDraft(restoredDraft);setAnswers(restoredAnswers);setHistory(restoredHistory);setQuestion(restoredQuestion);setActiveQuestionIndex(restoredIndex);setSelected(typeof saved.selected==='string'?saved.selected:'');setCustom(typeof saved.custom==='string'?saved.custom:'');setReason(typeof saved.reason==='string'?saved.reason:'');setMultiSelected(Array.isArray(saved.multiSelected)?saved.multiSelected:[]);setRanking(Array.isArray(saved.ranking)?saved.ranking:[]);setSliderValue(typeof saved.sliderValue==='number'?saved.sliderValue:50);setMatrixAnswers(saved.matrixAnswers&&typeof saved.matrixAnswers==='object'?saved.matrixAnswers:{});setSecondary(typeof saved.secondary==='string'?saved.secondary:'');setError('');
    if((saved.stage==='interview'||saved.stage==='finalizing')&&restoredDraft&&restoredQuestion)setStage('interview');else if(saved.stage==='review'&&restoredDraft)setStage('review');else setStage('input');
  }

  function clearProgressState(){setStage('input');setName('');setProfileText('');setSecretProfileText('');clearAppearanceImages();setDraft(null);setAnswers([]);setQuestion(null);setHistory([]);setActiveQuestionIndex(0);resetResponseDraft();setBusy(false);setError('');setResult(null);batchRequests.current.clear();temporalRepairRequests.current.clear()}

  async function loadReplay(shareCode:string){
    persistenceEnabled.current=false;setBusy(true);setError('');
    try{
      const r=await fetch(`/api/admin/data/${shareCode}/replay`,{method:'POST'});
      const body=await r.json().catch(()=>({}));
      if(!r.ok){setError(body?.error==='ADMIN_AUTH_INVALID'?'관리자 콘솔에 로그인한 상태에서 실행해주세요.':`불러오지 못했어요: ${body?.error||r.status}`);setStage('input');return}
      const d=body.draft as CharacterDraft;const a=uniqueAnswersByOrder(body.answers as InterviewAnswer[]);
      setDraft(d);setAnswers(a);setName(d.basicProfile.name);setProfileText(d.basicProfile.profileText);setSecretProfileText(d.basicProfile.secretProfileText||'');
      setStage('replay');
    }catch{setError('불러오는 중 오류가 발생했어요.');setStage('input')}
    finally{setBusy(false)}
  }

  useEffect(()=>{
    const replay=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('replay'):null;
    if(replay&&/^[A-HJ-NP-Z2-9]{8}$/.test(replay)){hydrated.current=true;persistenceEnabled.current=false;void loadReplay(replay);return}
    try{const localRaw=localStorage.getItem(ANALYSIS_SESSION_KEY);const legacyRaw=sessionStorage.getItem(ANALYSIS_SESSION_KEY);const raw=localRaw||legacyRaw;if(raw){const parsed=JSON.parse(raw) as unknown;if(isSavedSession(parsed)&&hasMeaningfulProgress(parsed)){if(!localRaw)localStorage.setItem(ANALYSIS_SESSION_KEY,raw);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);setResumeCandidate(parsed);persistenceEnabled.current=false}else{localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);persistenceEnabled.current=true}}else persistenceEnabled.current=true}catch{localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);persistenceEnabled.current=true}finally{hydrated.current=true}
  },[]);

  useEffect(()=>{
    if(!hydrated.current||!persistenceEnabled.current||stage==='done')return;
    const timer=window.setTimeout(()=>{try{const saved:SavedAnalysisSession={version:1,stage:stage as SavedStage,name,profileText,secretProfileText,draft,answers:uniqueAnswersByOrder(answers),question,questionHistory,activeQuestionIndex,selected,custom,reason,multiSelected,ranking,sliderValue,matrixAnswers,secondary};if(hasMeaningfulProgress(saved))localStorage.setItem(ANALYSIS_SESSION_KEY,JSON.stringify(saved));else localStorage.removeItem(ANALYSIS_SESSION_KEY)}catch{}},150);
    return()=>window.clearTimeout(timer);
  },[stage,name,profileText,secretProfileText,draft,answers,question,questionHistory,activeQuestionIndex,selected,custom,reason,multiSelected,ranking,sliderValue,matrixAnswers,secondary]);

  const characterSignalText=useMemo(()=>{
    const parts:string[]=[profileText,secretProfileText];
    if(draft){
      parts.push(...draft.aiInferences.map(x=>x.text));
      parts.push(...draft.confirmedFacts.map(f=>`${f.key} ${String(f.value)}`));
      parts.push(...Object.keys(draft.traits||{}));
      parts.push(...Object.keys(draft.relationshipTraits||{}));
    }
    parts.push(...answers.map(a=>`${a.answer} ${a.reason||''}`));
    return parts.join(' ');
  },[profileText,secretProfileText,draft,answers]);

  const flavorName=draft?.basicProfile.name||name||'이 캐릭터';
  // 요약 생성 화면에서 쓸 확정 성격 태그(오너 선택 우선, 없으면 AI 초기 선택).
  const settledFlavorTags=useMemo(()=>{
    const tags=draft?.personalityTags;
    const owner=tags?.ownerSelected??[];
    const ai=tags?.aiInitial??[];
    return owner.length?owner:ai;
  },[draft]);
  // 프로필 파싱 화면은 성격을 아직 모르므로 공통(any) 문구만, 요약 생성 화면은 확정 태그를
  // 직접 넘겨 성격별 문구가 나오게 한다. (빈 배열 = 공통만, 키워드 감지에 의존하지 않음)
  const flavorMessage=useRotatingFlavor(characterSignalText,flavorName,busy,stage==='finalizing'?settledFlavorTags:[]);

  function continueSavedAnalysis(){if(!resumeCandidate)return;persistenceEnabled.current=false;restoreSavedSession(resumeCandidate);setResumeCandidate(null);window.setTimeout(()=>{persistenceEnabled.current=true},0)}
  function startFreshAnalysis(){persistenceEnabled.current=false;localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);setResumeCandidate(null);clearProgressState();window.setTimeout(()=>{persistenceEnabled.current=true},0)}
  function handleApiError(status:number,body:unknown){const record=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};const code=record.error||status;const codeText=typeof code==='string'?code:'';const details=typeof record.details==='string'&&record.details.trim()?record.details.trim():'';const safeDetails=details&&(codeText==='INVALID_REQUEST'||codeText==='REQUEST_TOO_LARGE'||codeText==='MODEL_OUTPUT_INVALID'||codeText.startsWith('PROFILE_'))?details:'';setError(code==='RATE_LIMITED'?'요청이 너무 많아요. 잠시 뒤 다시 시도해주세요.':`처리 중 오류가 발생했어요. (${codeText||JSON.stringify(code)})${safeDetails?` · ${safeDetails}`:''}`)}
  async function parse(){setBusy(true);setError('');setParseProgress(0);try{const body=await postJsonStream<{draft:CharacterDraft}>('/api/characters/parse',{name,profileText,secretProfileText,appearanceImages:getAppearanceImagesForRequest()},r=>setParseProgress(Math.min(99,Math.round(r*100))));setDraft(body.draft);setStage('review')}catch(err){const e=err as Error&{status?:number;body?:unknown};handleApiError(e.status||500,e.body||{error:e.message})}finally{setBusy(false)}}
  function verdict(id:string,ownerVerdict:'confirmed'|'ambiguous'|'rejected'){if(!draft)return;setDraft({...draft,aiInferences:draft.aiInferences.map(x=>{if(x.id!==id)return x;if(ownerVerdict==='confirmed'){const {ownerFeedback:_ownerFeedback,...rest}=x;return {...rest,ownerVerdict}}return {...x,ownerVerdict}})})}
  function inferenceFeedback(id:string,ownerFeedback:string){if(!draft)return;setDraft({...draft,aiInferences:draft.aiInferences.map(x=>x.id===id?{...x,ownerFeedback}:x)})}

  // 첫 질문은 오너 검수 결과를 쓰지 않고 프로필에 사실로 적힌 내용만으로 만들어진다
  // (questions/next 의 첫 배치 처리). 그래서 검수 화면에 들어서는 순간 미리 만들어 둘 수 있고,
  // 검수를 어떻게 고치든 이 질문은 낡아지지 않으므로 버려지는 호출도 생기지 않는다.
  const firstQuestionPrefetch=useRef<Promise<InterviewQuestion[]>|null>(null);

  useEffect(()=>{
    if(stage!=='review'||!draft||firstQuestionPrefetch.current)return;
    firstQuestionPrefetch.current=requestBatch(1,[],[]).catch(()=>[] as InterviewQuestion[]);
  // requestBatch 는 렌더마다 새로 만들어지므로 의존성에 넣지 않는다. 검수 단계 진입에만 반응한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[stage,draft]);

  async function requestBatch(startOrder:number,currentAnswers:InterviewAnswer[],plannedBase=questionHistoryRef.current){
    if(!draft||startOrder>20)return[];const count=Math.min(1,21-startOrder);const existing=plannedBase.filter(q=>q.order>=startOrder&&q.order<startOrder+count);if(existing.length===count)return existing.sort((a,b)=>a.order-b.order);const pending=batchRequests.current.get(startOrder);if(pending)return pending;
    const promise=(async()=>{const normalizedAnswers=uniqueAnswersByOrder(currentAnswers);const r=await fetch('/api/characters/questions/next',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,answers:normalizedAnswers,plannedQuestions:plannedBase,startOrder,batchSize:count})});const body=await r.json();if(!r.ok){const err=new Error(typeof body?.error==='string'?body.error:`HTTP_${r.status}`) as Error&{status?:number;body?:unknown};err.status=r.status;err.body=body;throw err}const incoming=(Array.isArray(body.questions)?body.questions:body.question?[body.question]:[]) as InterviewQuestion[];const merged=mergeQuestionHistory(questionHistoryRef.current,incoming);setHistory(merged);return incoming.sort((a,b)=>a.order-b.order)})();
    batchRequests.current.set(startOrder,promise);try{return await promise}finally{batchRequests.current.delete(startOrder)}
  }

  async function goToOrder(order:number,currentAnswers:InterviewAnswer[],historyBase=questionHistoryRef.current){
    if(order>20){await finalize(currentAnswers);return}const existing=historyBase.find(item=>item.order===order)||questionHistoryRef.current.find(item=>item.order===order);if(existing){const history=mergeQuestionHistory(historyBase,questionHistoryRef.current);applyQuestion(existing,history,currentAnswers);return}setBusy(true);setError('');try{const questions=await requestBatch(order,currentAnswers,historyBase);const history=questionHistoryRef.current;const q=questions.find(item=>item.order===order)||history.find(item=>item.order===order);if(!q){setError('다음 질문 묶음을 불러오지 못했어요. 다시 시도해주세요.');return}applyQuestion(q,history,currentAnswers)}catch(err){const e=err as Error&{status?:number;body?:unknown};handleApiError(e.status||500,e.body||{error:e.message})}finally{setBusy(false)}
  }

  async function startInterview(){setAnswers([]);setQuestion(null);setHistory([]);setActiveQuestionIndex(0);
    // 검수 화면에 들어설 때 미리 만들어 둔 첫 질문을 그대로 쓴다(추가 대기 없음).
    const reusable=firstQuestionPrefetch.current;
    batchRequests.current.clear();temporalRepairRequests.current.clear();setBusy(true);setError('');try{const ready=reusable?await reusable:[];const first=ready.length?ready:await requestBatch(1,[],[]);const history=questionHistoryRef.current;const q=first.find(item=>item.order===1)||history.find(item=>item.order===1);if(q)applyQuestion(q,history,[]);else setError('첫 질문 묶음을 만들지 못했어요.')}catch(err){const e=err as Error&{status?:number;body?:unknown};handleApiError(e.status||500,e.body||{error:e.message})}finally{setBusy(false)}}

  function buildCurrentAnswer(){
    if(!question)return null;const type=responseTypeOf(question);const config=responseConfigOf(question);const customAnswer=custom.trim();const reasonText=reason.trim();let answer='';let answerSource:'choice'|'custom'|'structured'='structured';
    if(type==='fill_blank'||type==='dialogue_choice'||type==='owner_meta'){answer=(customAnswer||selected).trim();answerSource=customAnswer?'custom':'choice'}else if(type==='sentence_continue'||type==='in_character_response'){answer=customAnswer;answerSource='custom'}else if(type==='bipolar_scale'){if(selected){const right=Math.max(0,Math.min(100,Math.round(sliderValue)));const left=100-right;answer=`${config.leftLabel||'A'} ${left}% / ${config.rightLabel||'B'} ${right}%`}}else if(type==='ranking'){if(ranking.length===question.options.length)answer=ranking.map((item,index)=>`${index+1}위 ${item}`).join(' > ')}else if(type==='forced_choice'){answer=selected;answerSource='choice'}else if(type==='multi_select'){if(multiSelected.length)answer=`복수 선택: ${multiSelected.join(', ')}`}else if(type==='least_likely'){if(selected)answer=`가장 하지 않을 것: ${selected}`;answerSource='choice'}else if(type==='slider'){answer=`${sliderValue}/100 (${config.minLabel||'낮음'} ↔ ${config.maxLabel||'높음'})`}else if(type==='relationship_matrix'){const rows=config.rows||[];if(rows.length&&rows.every(row=>matrixAnswers[row]?.trim()))answer=rows.map(row=>`${row}: ${matrixAnswers[row].trim()}`).join(' / ')}else if(type==='inner_outer'){if(customAnswer&&secondary.trim())answer=`속마음: ${customAnswer} / 실제 행동: ${secondary.trim()}`;answerSource='custom'}else if(type==='temporal_compare'){const leftValue=(customAnswer||selected).trim();const rightValue=secondary.trim();if(leftValue&&rightValue)answer=`${config.leftLabel||'처음'}: ${leftValue} / ${config.rightLabel||'나중'}: ${rightValue}`;answerSource=customAnswer?'custom':'structured'}else if(type==='condition_followup'){const baseValue=(customAnswer||selected).trim();const shiftedValue=secondary.trim();if(baseValue&&shiftedValue)answer=`기본 상황: ${baseValue} / 조건 변경 후: ${shiftedValue}`;answerSource=customAnswer?'custom':'structured'}
    if(!answer.trim())return null;const responseData:ResponseData={selected,custom,multiSelected,ranking,sliderValue,matrixAnswers,secondary};return {order:question.order,question:question.question,answer:answer.trim(),...(reasonText?{reason:reasonText}:{}),branchContext:{category:question.category,mode:question.mode,format:question.format,responseType:type,targetHook:question.targetHook,hypothesis:question.hypothesis,answerSource,responseData}} satisfies InterviewAnswer;
  }

  async function answerCurrent(){
    if(!question)return;const current=buildCurrentAnswer();if(!current)return;const editingPast=answers.some(answer=>answer.order>current.order);const next=editingPast?uniqueAnswersByOrder([...answers.filter(answer=>answer.order<current.order),current]):upsertAnswer(answers,current);const nextHistory=editingPast?questionHistory.filter(item=>item.order<=current.order):questionHistory;setAnswers(next);if(editingPast){batchRequests.current.clear();setHistory(nextHistory)}
    if(question.order===20){const missing=firstMissingOrder(next);if(missing!==null){const repairedAnswers=next.filter(answer=>answer.order<missing);const repairedHistory=nextHistory.filter(item=>item.order<missing);setAnswers(repairedAnswers);setHistory(repairedHistory);await goToOrder(missing,repairedAnswers,repairedHistory);return}await finalize(next);return}await goToOrder(question.order+1,next,nextHistory);
  }

  function previousQuestion(){if(busy||!question)return;const previous=questionHistory.filter(item=>item.order<question.order).at(-1);if(previous)applyQuestion(previous,questionHistory,answers)}
  function forwardQuestion(){if(busy||!question)return;const next=questionHistory.find(item=>item.order===question.order+1);if(next)applyQuestion(next,questionHistory,answers)}
  async function finalize(finalAnswers=answers){if(!draft)return;const normalizedAnswers=uniqueAnswersByOrder(finalAnswers);if(normalizedAnswers.length!==20){setStage('interview');setError('답변 순서를 복구하는 중이에요. 마지막으로 완료하지 못한 질문부터 다시 이어주세요.');return}setStage('finalizing');setFinalizeProgress(4);setBusy(true);setError('');try{const body=await postJsonStream<{preview:unknown;shareCode:string;editToken:string}>('/api/characters/finalize',{draft,answers:normalizedAnswers},r=>setFinalizeProgress(Math.max(4,Math.min(99,Math.round(r*100)))));persistenceEnabled.current=false;localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);localStorage.setItem(`chara_edit_${body.shareCode}`,body.editToken);setResult(body as never);setStage('done')}catch(err){const e=err as Error&{status?:number;body?:unknown};handleApiError(e.status||500,e.body||{error:e.message});setStage('interview')}finally{setBusy(false)}}

  function toggleMulti(option:string){const max=question?responseConfigOf(question).maxSelections:undefined;setMultiSelected(current=>{if(current.includes(option))return current.filter(item=>item!==option);if(max&&current.length>=max)return current;return [...current,option]})}
  function addRank(option:string){setRanking(current=>current.includes(option)?current:[...current,option])}
  function removeRank(option:string){setRanking(current=>current.filter(item=>item!==option))}
  function moveRank(index:number,direction:-1|1){setRanking(current=>{const next=[...current];const target=index+direction;if(target<0||target>=next.length)return current;[next[index],next[target]]=[next[target],next[index]];return next})}
  function startRankDrag(index:number,item:string,event:ReactPointerEvent<HTMLDivElement>){if(busy||event.button!==0||(event.target as HTMLElement).closest('button'))return;rankingDragIndexRef.current=index;rankingDragPointerOffsetRef.current=event.clientY-event.currentTarget.getBoundingClientRect().top;setDraggingRankItem(item);event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault()}
  function dragRank(event:ReactPointerEvent<HTMLDivElement>){const from=rankingDragIndexRef.current;const list=rankingListRef.current;if(from===null||!list)return;event.preventDefault();const draggedCenter=event.clientY-list.getBoundingClientRect().top-rankingDragPointerOffsetRef.current+event.currentTarget.offsetHeight/2;const currentCenter=event.currentTarget.offsetTop+event.currentTarget.offsetHeight/2;let to=from;if(draggedCenter>currentCenter){for(let index=from+1;index<ranking.length;index+=1){const candidate=rankingRowRefs.current.get(ranking[index]);if(candidate&&draggedCenter>candidate.offsetTop+candidate.offsetHeight/2)to=index}}else if(draggedCenter<currentCenter){for(let index=from-1;index>=0;index-=1){const candidate=rankingRowRefs.current.get(ranking[index]);if(candidate&&draggedCenter<candidate.offsetTop+candidate.offsetHeight/2)to=index}}if(to===from)return;const positions=new Map<string,number>();rankingRowRefs.current.forEach((element,item)=>positions.set(item,element.getBoundingClientRect().top));rankingRowRefs.current.forEach(element=>element.getAnimations().forEach(animation=>animation.cancel()));rankingDragPositionsRef.current=positions;setRanking(current=>{if(from>=current.length||to>=current.length)return current;const next=[...current];const [moved]=next.splice(from,1);next.splice(to,0,moved);return next});rankingDragIndexRef.current=to}
  function stopRankDrag(event:ReactPointerEvent<HTMLDivElement>){if(rankingDragIndexRef.current===null)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);rankingDragIndexRef.current=null;setDraggingRankItem(null)}

  function renderInlineCustomOption(){return <div className={`option ${custom?'selected':''}`} style={{display:'block',cursor:'text'}}><strong style={{display:'block',marginBottom:8}}>직접 입력</strong><input disabled={busy} className="input" style={{width:'100%',padding:'9px 10px'}} placeholder="직접 적어주세요." value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}}/></div>}

  function renderResponseControls(){
    if(!question)return null;const type=responseTypeOf(question);const config=responseConfigOf(question);
    if(type==='fill_blank')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}{renderInlineCustomOption()}</div>;
    if(type==='sentence_continue')return <div className="field"><label className="label"><span className="label-text">문장을 이어 써주세요</span><textarea disabled={busy} className="input" style={{minHeight:120,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></label></div>;
    if(type==='dialogue_choice')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>“{o}”</button>)}{renderInlineCustomOption()}</div>;
    if(type==='bipolar_scale')return <div className="bipolar-control"><div className="bipolar-labels"><strong>{config.leftLabel||'A'}</strong><strong>{config.rightLabel||'B'}</strong></div><div className="bipolar-track"><input aria-label="A와 B 사이에서 가까운 위치 선택" disabled={busy} className="bipolar-range" type="range" min={0} max={100} step={1} value={sliderValue} onPointerDown={()=>setSelected('dial')} onKeyDown={()=>setSelected('dial')} onChange={e=>{setSliderValue(Number(e.target.value));setSelected('dial')}} /></div><div className="bipolar-hints"><span>A에 가까움</span><span>반반</span><span>B에 가까움</span></div>{selected&&<div className="bipolar-current">{sliderValue===50?'정중앙':sliderValue<50?`${config.leftLabel||'A'} 쪽에 더 가까움`:`${config.rightLabel||'B'} 쪽에 더 가까움`}</div>}</div>;
    if(type==='ranking'){
      const remaining=question.options.filter(o=>!ranking.includes(o));
      const actionStyle={padding:0,width:34,height:34,display:'inline-grid',placeItems:'center',flex:'0 0 auto',color:'var(--character-accent, var(--accent))'} as const;
      return <div style={{marginTop:18}}>
        <p className="muted">중요한 순서대로 눌러주세요. 선택한 항목은 위아래로 끌거나 화살표로 순서를 바꿀 수 있어요.</p>
        {ranking.length>0&&<div ref={rankingListRef} className="stack" style={{gap:8,marginBottom:14,position:'relative'}}>{ranking.map((item,index)=>{const isDragging=draggingRankItem===item;return <div
          key={item}
          ref={element=>{if(element)rankingRowRefs.current.set(item,element);else rankingRowRefs.current.delete(item)}}
          data-ranking-index={index}
          onPointerDown={event=>startRankDrag(index,item,event)}
          onPointerMove={dragRank}
          onPointerUp={stopRankDrag}
          onPointerCancel={stopRankDrag}
          style={{display:'flex',alignItems:'center',gap:8,padding:'12px 14px',border:'1px solid var(--line)',borderRadius:12,background:isDragging?'var(--character-accent-soft, var(--accent-soft))':'transparent',boxShadow:isDragging?'0 0 0 2px var(--character-accent, var(--accent)), 0 10px 24px rgba(0,0,0,.12)':'none',transform:isDragging?'scale(1.015)':'none',transition:'background-color .16s ease, box-shadow .16s ease, transform .16s ease',touchAction:'none',userSelect:'none',cursor:busy?'default':isDragging?'grabbing':'grab',position:'relative',zIndex:isDragging?2:1}}
        >
          <strong style={{minWidth:40}}>{index+1}위</strong>
          <span style={{flex:1,minWidth:0}}>{item}</span>
          <button type="button" aria-label={`${item} 순위를 위로 이동`} className="btn" disabled={busy||index===0} style={actionStyle} onClick={()=>moveRank(index,-1)}><RankingActionIcon direction="up"/></button>
          <button type="button" aria-label={`${item} 순위를 아래로 이동`} className="btn" disabled={busy||index===ranking.length-1} style={actionStyle} onClick={()=>moveRank(index,1)}><RankingActionIcon direction="down"/></button>
          <button type="button" aria-label={`${item} 순위에서 제거`} className="btn" disabled={busy} style={actionStyle} onClick={()=>removeRank(item)}><RankingActionIcon direction="remove"/></button>
        </div>})}</div>}
        {remaining.length>0&&<div className="options">{remaining.map(o=><button disabled={busy} key={o} className="option" onClick={()=>addRank(o)}>{o}</button>)}</div>}
      </div>
    }
    if(type==='forced_choice')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div>;
    if(type==='multi_select')return <><p className="muted" style={{marginTop:18}}>해당되는 것을 모두 골라주세요.{config.maxSelections?` 최대 ${config.maxSelections}개까지 선택할 수 있어요.`:''}</p><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${multiSelected.includes(o)?'selected':''}`} onClick={()=>toggleMulti(o)}>{multiSelected.includes(o)?'✓ ':''}{o}</button>)}</div></>;
    if(type==='least_likely')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div>;
    if(type==='slider')return <div style={{marginTop:24}}><div style={{textAlign:'center',fontSize:34,fontWeight:900,marginBottom:10}}>{sliderValue}<span className="muted" style={{fontSize:16}}> / 100</span></div><input disabled={busy} type="range" min={0} max={100} step={1} value={sliderValue} onChange={e=>setSliderValue(Number(e.target.value))} style={{width:'100%'}} /><div style={{display:'flex',justifyContent:'space-between',gap:20,marginTop:8,fontSize:13,fontWeight:700}}><span>{config.minLabel}</span><span style={{textAlign:'right'}}>{config.maxLabel}</span></div></div>;
    if(type==='relationship_matrix')return <div style={{marginTop:20}}>{config.rows.map(row=>{const choices=(config.rowOptions?.[row]?.length?config.rowOptions[row]:config.columns).slice(0,4);const current=matrixAnswers[row]||'';const customValue=choices.includes(current)?'':current;return <div key={row} style={{padding:'14px 0',borderBottom:'1px solid var(--line)'}}><div className="label" style={{marginBottom:8}}>{row}</div><div className="options">{choices.map(choice=><button disabled={busy} key={choice} className={`option ${current===choice?'selected':''}`} onClick={()=>setMatrixAnswers(values=>({...values,[row]:choice}))}>{choice}</button>)}<div className={`option ${customValue?'selected':''}`} style={{display:'block',cursor:'text'}}><strong style={{display:'block',marginBottom:8}}>직접 입력</strong><input disabled={busy} className="input" style={{width:'100%',padding:'9px 10px'}} placeholder="이 상대라면 어떻게 답할지 직접 적어주세요." value={customValue} onChange={e=>setMatrixAnswers(values=>({...values,[row]:e.target.value}))}/></div></div></div>})}</div>;
    if(type==='inner_outer')return <><div className="field"><label className="label"><span className="label-text">속으로 가장 먼저 드는 생각</span><textarea disabled={busy} className="input" style={{minHeight:100,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></label></div><div className="field"><label className="label"><span className="label-text">{config.prompt2||'실제로 겉으로 보이는 행동'}</span><textarea disabled={busy} className="input" style={{minHeight:100,resize:'vertical'}} value={secondary} onChange={e=>setSecondary(e.target.value)} /></label></div></>;
    if(type==='temporal_compare'){const leftChoices=question.options.slice(0,4);const rightChoices=(config.options2?.length?config.options2:question.options).slice(0,4);const leftCustom=selected?'':custom;const rightCustom=rightChoices.includes(secondary)?'':secondary;return <div className="two-col" style={{marginTop:20}}><div className="field"><label className="label">{config.leftLabel||'직후'}</label><div className="options">{leftChoices.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}<div className={`option ${leftCustom?'selected':''}`} style={{display:'block',cursor:'text'}}><strong style={{display:'block',marginBottom:8}}>직접 입력</strong><input disabled={busy} className="input" style={{width:'100%',padding:'9px 10px'}} placeholder="이 시점의 반응을 직접 적어주세요." value={leftCustom} onChange={e=>{setCustom(e.target.value);setSelected('')}}/></div></div></div><div className="field"><label className="label">{config.rightLabel||'시간이 지난 뒤'}</label><div className="options">{rightChoices.map(o=><button disabled={busy} key={o} className={`option ${secondary===o?'selected':''}`} onClick={()=>setSecondary(o)}>{o}</button>)}<div className={`option ${rightCustom?'selected':''}`} style={{display:'block',cursor:'text'}}><strong style={{display:'block',marginBottom:8}}>직접 입력</strong><input disabled={busy} className="input" style={{width:'100%',padding:'9px 10px'}} placeholder="이 시점의 반응을 직접 적어주세요." value={rightCustom} onChange={e=>setSecondary(e.target.value)}/></div></div></div></div>}
    if(type==='condition_followup'){
      const baseChoices=question.options;
      const shiftedChoices=config.options2?.length?config.options2:question.options;
      // 보기를 고르면 직접 입력은 비우고, 직접 입력하면 보기 선택을 푼다(둘 중 하나만 답이 된다).
      const baseCustom=selected?'':custom;
      const shiftedCustom=shiftedChoices.includes(secondary)?'':secondary;
      return <><div className="field"><div className="label" id="base-situation-label">기본 상황</div><div className="options" role="group" aria-labelledby="base-situation-label">{baseChoices.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}<div className={`option ${baseCustom?'selected':''}`} style={{display:'block',cursor:'text'}}><strong style={{display:'block',marginBottom:8}}>직접 입력</strong><input disabled={busy} className="input" style={{width:'100%',padding:'9px 10px'}} placeholder="이 상황에서 할 행동을 직접 적어주세요." value={baseCustom} onChange={e=>{setCustom(e.target.value);setSelected('')}}/></div></div></div><div className="field"><div className="label" id="shifted-situation-label">{config.prompt2}</div><div className="options" role="group" aria-labelledby="shifted-situation-label">{shiftedChoices.map(o=><button disabled={busy} key={o} className={`option ${secondary===o?'selected':''}`} onClick={()=>setSecondary(o)}>{o}</button>)}<div className={`option ${shiftedCustom?'selected':''}`} style={{display:'block',cursor:'text'}}><strong style={{display:'block',marginBottom:8}}>직접 입력</strong><input disabled={busy} className="input" style={{width:'100%',padding:'9px 10px'}} placeholder="조건이 바뀌었을 때 할 행동을 직접 적어주세요." value={shiftedCustom} onChange={e=>setSecondary(e.target.value)}/></div></div></div></>;
    }
    if(type==='in_character_response')return <div className="field"><label className="label"><span className="label-text">캐릭터라면 뭐라고 말할까요?</span><textarea disabled={busy} className="input" style={{minHeight:130,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></label></div>;
    return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}{renderInlineCustomOption()}</div>;
  }

  const viewingPastQuestion=!!question&&answers.some(answer=>answer.order>question.order);
  const savedAtCurrent=question?answers.find(answer=>answer.order===question.order):undefined;
  const currentBuilt=buildCurrentAnswer();
  const currentAnswerChanged=!!savedAtCurrent&&!!currentBuilt&&(currentBuilt.answer!==savedAtCurrent.answer||(currentBuilt.reason||'')!==(savedAtCurrent.reason||''));
  const hasCurrentResponse=!!currentBuilt;
  const resumeProgress=resumeCandidate?(resumeCandidate.stage==='interview'||resumeCandidate.stage==='finalizing')?`인터뷰 ${Math.min(20,uniqueAnswersByOrder(resumeCandidate.answers).length+(resumeCandidate.question?1:0))}/20 진행 중`:resumeCandidate.stage==='review'?'프로필 첫 해석 확인 단계':'프로필 작성 중':'';

  return <>
    {stage==='input'&&resumeCandidate&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="resume-analysis-title" aria-describedby="resume-analysis-description"><div className="eyebrow">Saved progress</div><h3 id="resume-analysis-title">작성하던 캐릭터 분석이 있어요.</h3><p id="resume-analysis-description" className="muted">이전에 입력한 프로필과 답변을 불러와서 계속할까요?</p><p style={{margin:'0 0 18px',fontWeight:800}}>{resumeCandidate.name||'이름 미입력'} · {resumeProgress}</p><div className="actions" style={{marginTop:0}}><button autoFocus className="btn primary" onClick={continueSavedAnalysis}>이어하기</button><button className="btn" onClick={startFreshAnalysis}>처음부터 하기</button></div></div></div>}

    {stage==='input'&&<div className="card" aria-busy={busy}><div className="field"><label className="label"><span className="label-text">캐릭터 이름</span><input disabled={busy||!!resumeCandidate} className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="예: 한서진" /></label></div><div className="field"><label className="label"><span className="label-text">공개 프로필</span><textarea disabled={busy||!!resumeCandidate} className="textarea" value={profileText} onChange={e=>setProfileText(e.target.value)} placeholder="커뮤에서 공개했던 프로필 내용을 붙여넣으세요. 성격, 외관, 관계, 설정 등을 그대로 넣어도 됩니다." /></label></div><div className="field"><label className="label"><span className="label-text">비밀 프로필 <span className="muted">(선택)</span></span><textarea disabled={busy||!!resumeCandidate} className="textarea" value={secretProfileText} onChange={e=>setSecretProfileText(e.target.value)} placeholder="오너만 알고 있던 비밀 설정, 숨겨진 동기, 과거, 공개 프로필에 적지 않았던 내용을 붙여넣으세요. 없다면 비워두면 됩니다." /></label></div><AppearanceImageInput disabled={busy||!!resumeCandidate}/>{busy&&<div role="status" aria-live="polite" style={{marginTop:18,padding:'18px 20px',border:'1px solid var(--line)',borderRadius:16,background:'var(--accent-soft)'}}><div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:16}}><strong>프로필을 읽고 첫 해석을 만드는 중이에요</strong><strong style={{fontSize:20,fontVariantNumeric:'tabular-nums'}}>{parseProgress}%</strong></div><div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={parseProgress} aria-label="프로필 해석 진행률" style={{height:9,borderRadius:999,overflow:'hidden',background:'rgba(23,24,22,.12)',marginTop:10}}><div style={{height:'100%',width:`${parseProgress}%`,borderRadius:999,background:'rgba(23,24,22,.78)',transition:'width .5s ease'}}/></div><p className="muted" style={{margin:'10px 0 0',lineHeight:1.5}}>{flavorMessage}</p></div>}{error&&<p className="error">{error}</p>}<div className="actions"><button className="btn primary" disabled={busy||!!resumeCandidate||name.trim().length<1||profileText.trim().length<20} onClick={parse}>{busy?`프로필을 읽는 중… ${parseProgress}%`:'프로필 해석 시작'}</button></div></div>}

    {stage==='review'&&draft&&<div className="stack" aria-busy={busy}><div className="card"><h2 style={{marginTop:10}}>{applyName('제가 {name}을 잘 이해한게 맞나요?',draft.basicProfile.name)}</h2></div><div className="card">{draft.aiInferences.map(x=><div className="inference" key={x.id}><div className="inference-top"><p>{x.text}</p><span className="muted">{Math.round(x.confidence)}%</span></div><div style={{display:'flex',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginTop:10}}><div className="pills" style={{marginTop:0}}><button disabled={busy} className={`pill ${x.ownerVerdict==='confirmed'?'active':''}`} onClick={()=>verdict(x.id,'confirmed')}>맞음</button><button disabled={busy} className={`pill ${x.ownerVerdict==='ambiguous'?'active':''}`} onClick={()=>verdict(x.id,'ambiguous')}>애매함</button><button disabled={busy} className={`pill ${x.ownerVerdict==='rejected'?'active':''}`} onClick={()=>verdict(x.id,'rejected')}>아님</button></div>{(x.ownerVerdict==='ambiguous'||x.ownerVerdict==='rejected')&&<div style={{flex:'1 1 320px',minWidth:240}}><label className="label"><span className="label-text">{x.ownerVerdict==='ambiguous'?'어떤 부분이 맞고, 어떤 부분이 다른가요?':'실제로는 어떤가요?'}</span><textarea disabled={busy} className="input" style={{minHeight:84,resize:'vertical',marginTop:7}} maxLength={1200} value={x.ownerFeedback||''} onChange={e=>inferenceFeedback(x.id,e.target.value)} /></label></div>}</div></div>)}</div><div className="actions"><button disabled={busy} className="btn primary" onClick={startInterview}>{busy?'첫 5문항 준비 중…':'20문항 인터뷰 시작'}</button><button disabled={busy} className="btn" onClick={()=>setStage('input')}>프로필 다시 입력</button></div></div>}

    {stage==='interview'&&question&&<div className="card question-card"><div><div className="q-meta"><span>{question.order} / 20</span>{viewingPastQuestion&&<span>이전 질문 확인 중</span>}</div><div className="progress" style={{marginTop:10}}><span style={{width:`${(question.order-1)/20*100}%`}}/></div><h2 className="q-title">{question.question}</h2>{renderResponseControls()}<div className="field"><label className="label"><span className="label-text">왜 그렇게 답했나요? <span className="muted">(선택)</span></span><textarea disabled={busy} className="input" style={{minHeight:78,resize:'vertical'}} value={reason} onChange={e=>setReason(e.target.value)} /></label></div></div><div>{error&&<p className="error">{error}</p>}{busy&&<p className="muted">다음 질문 묶음 준비를 마치는 중이에요.</p>}<div className="actions" style={{marginTop:16}}>{question.order===1&&<button className="btn" disabled={busy} onClick={()=>setStage('input')}>← 프로필 다시 작성하기</button>}{question.order>1&&<button className="btn" disabled={busy} onClick={previousQuestion}>← 이전 질문</button>}{viewingPastQuestion&&questionHistory.some(item=>item.order===question.order+1)&&<button className="btn" disabled={busy} onClick={forwardQuestion}>다음 질문 보기 →</button>}<button className="btn primary" disabled={busy||!hasCurrentResponse} onClick={answerCurrent}>{busy?'질문 준비 중…':viewingPastQuestion?(currentAnswerChanged?'수정하고 여기서부터 다시 진행':'이 답변부터 다시 진행'):question.order===20?'20문항 완료하고 요약 보기':'답변하고 다음 질문'}</button></div></div></div>}

    {stage==='replay'&&<div className="card" aria-busy={busy}>
      <div className="eyebrow">사용자 시점 요약 테스트</div>
      <h2 style={{marginTop:10}}>{applyName('{name}의 저장된 답변으로 요약을 생성해요.',draft?.basicProfile.name||name)}</h2>
      <p className="muted" style={{lineHeight:1.7}}>저장된 20개 답변이 준비됐어요. 실제 사용자처럼 아래 버튼을 누르면 요약 리포트 생성 과정이 그대로 진행돼요. 제출하면 테스트용 새 캐릭터가 하나 생성되니, 확인 후 관리자에서 삭제하면 됩니다.</p>
      {error&&<p className="error">{error}</p>}
      <div className="actions"><button className="btn primary" disabled={busy||!draft||answers.length!==20} onClick={()=>void finalize(answers)}>답변 제출하고 요약 생성 ({answers.length}/20)</button></div>
    </div>}

    {stage==='finalizing'&&<div className="card" style={{textAlign:'center',padding:'64px 24px'}}><div className="loading" style={{fontSize:20,fontWeight:900,justifyContent:'center'}}>답변을 살펴보고 있어요 <i className="dot"/><i className="dot"/><i className="dot"/></div><div style={{maxWidth:440,margin:'22px auto 0'}}><div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:16}}><span className="muted" style={{textAlign:'left',lineHeight:1.5,minHeight:'2.6em'}}>{flavorMessage||' '}</span><strong style={{fontSize:20,fontVariantNumeric:'tabular-nums'}}>{finalizeProgress}%</strong></div><div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={finalizeProgress} aria-label="요약 리포트 생성 진행률" style={{height:10,borderRadius:999,overflow:'hidden',background:'rgba(23,24,22,.12)',marginTop:10}}><div style={{height:'100%',width:`${finalizeProgress}%`,borderRadius:999,background:'rgba(23,24,22,.78)',transition:'width .6s ease'}}/></div><p className="muted" style={{margin:'10px 0 0',fontSize:12,lineHeight:1.5}}>3~5분쯤 걸릴 수 있어요. 창을 닫지 말고 기다려 주세요.</p></div>{error&&<p className="error">{error}</p>}</div>}
    {stage==='done'&&result&&<CharacterReportView preview={result.preview} creatorEditToken={result.editToken}/>} 
  </>;
}
