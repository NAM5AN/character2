'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterDraft, InterviewAnswer } from '@/lib/schemas/character';
import type { InterviewQuestion, QuestionResponseType } from '@/lib/schemas/question';
import type { CharacterReportPreview } from '@/lib/character-report';
import { CharacterReportView } from '@/components/CharacterReportView';
import { AppearanceImageInput, clearAppearanceImages, getAppearanceImagesForRequest } from '@/components/AppearanceImageInput';
import { postJsonStream } from '@/lib/stream-client';

type Stage='input'|'review'|'interview'|'finalizing'|'done';
type FinalizeResult={preview:CharacterReportPreview;shareCode:string;editToken:string};
type SavedStage='input'|'review'|'interview'|'finalizing';
type SavedAnalysisSession={version:1;stage:SavedStage;name:string;profileText:string;secretProfileText:string;draft:CharacterDraft|null;answers:InterviewAnswer[];question:InterviewQuestion|null;questionHistory:InterviewQuestion[];activeQuestionIndex:number;selected:string;custom:string;reason:string;multiSelected?:string[];ranking?:string[];sliderValue?:number;matrixAnswers?:Record<string,string>;secondary?:string};
type ResponseData={selected?:string;custom?:string;multiSelected?:string[];ranking?:string[];sliderValue?:number;matrixAnswers?:Record<string,string>;secondary?:string};

const ANALYSIS_SESSION_KEY='chara_lab_analysis_session_v1';
// 심즈 로딩 문구 스타일: 상담(인터뷰) 자리에서 캐릭터가 벌일 법한 짓 "~하는 중".
// 뜬금없어도 '그 자리에서 일어날 수 있는' 것이면 OK. 각 문구에 어울리는 성격 태그를 달아두고,
// 이미 분석한 텍스트(프로필·추론·성향 라벨·문답)에서 감지한 태그와 겹치는 문구만 노출합니다.
// AI를 쓰지 않는 순수 키워드 매칭이라 토큰이 들지 않습니다.
type Flavor={t:string;g:string[]};
const FLAVOR_POOL:Flavor[]=[
  // any: 성격과 무관하게 늘 어울리는 상담실 기본 상황 (대사 없이 행동만)
  {t:'{name}가 의자에 앉자마자 자세부터 고쳐 앉는 중',g:['any']},
  {t:'{name}가 카톡 읽씹해놓고 혼자 죄책감 느끼는 중',g:['any']},
  {t:'{name}가 괜히 시계 보며 끝나길 기다리는 중',g:['any']},
  {t:'{name}가 물컵만 만지작대며 딴청 부리는 중',g:['any']},
  {t:'{name}가 대기실에서 연습한 말 다 까먹은 중',g:['any']},
  // shy: 소심·수줍·내성
  {t:'{name}가 대답할수록 목소리가 작아지는 중',g:['shy']},
  {t:'{name}가 손 어디 둘지 몰라 무릎에 얹었다 뗐다 하는 중',g:['shy']},
  {t:'{name}가 발끝만 내려다보며 겨우 대답하는 중',g:['shy']},
  {t:'{name}가 말 꺼내려다 몇 번이나 다시 삼키는 중',g:['shy']},
  {t:'{name}가 얼굴 빨개져 소매 끝만 끌어당기는 중',g:['shy']},
  // proud: 도도·자신감·거만
  {t:'{name}가 다리 꼬고 여유로운 척 앉아있는 중',g:['proud']},
  {t:'{name}가 질문을 시시하다는 듯 웃어넘기는 중',g:['proud']},
  {t:'{name}가 턱을 살짝 들고 상담사를 내려다보는 중',g:['proud']},
  {t:'{name}가 자기 대답에 스스로 만족해 미소 짓는 중',g:['proud']},
  {t:'{name}가 머리 쓸어넘기며 여유를 뽐내는 중',g:['proud']},
  // cold: 차갑·시크·무뚝뚝·무심
  {t:'{name}가 단답으로 끊고 침묵으로 버티는 중',g:['cold']},
  {t:'{name}가 표정 하나 안 바꾸고 앉아있는 중',g:['cold']},
  {t:'{name}가 시계만 흘깃 보고 다시 무표정인 중',g:['cold']},
  {t:'{name}가 팔짱 낀 채 필요한 말만 하는 중',g:['cold']},
  {t:'{name}가 관심 없다는 듯 창밖으로 시선 돌리는 중',g:['cold']},
  // warm: 다정·따뜻·배려
  {t:'{name}가 상담사 컨디션까지 걱정해주는 중',g:['warm']},
  {t:'{name}가 대답 끝에 괜히 한 번 웃어주는 중',g:['warm']},
  {t:'{name}가 상담사 물잔 비면 슬쩍 채워주는 중',g:['warm']},
  {t:'{name}가 무거운 질문에도 부드럽게 고개 끄덕이는 중',g:['warm']},
  {t:'{name}가 어색해하는 상담사를 되려 다독이는 중',g:['warm']},
  // playful: 장난·짓궂·능글
  {t:'{name}가 질문을 농담으로 되받아치는 중',g:['playful']},
  {t:'{name}가 상담사 표정 따라 하며 장난치는 중',g:['playful']},
  {t:'{name}가 일부러 엉뚱한 답으로 반응 떠보는 중',g:['playful']},
  {t:'{name}가 의자 빙글빙글 돌리며 딴짓하는 중',g:['playful']},
  {t:'{name}가 상담사 펜을 슬쩍 가져가 돌리는 중',g:['playful']},
  // cheerful: 활발·밝·명랑
  {t:'{name}가 신나서 안 물어본 것까지 말하는 중',g:['cheerful']},
  {t:'{name}가 손짓 발짓 다 써가며 설명하는 중',g:['cheerful']},
  {t:'{name}가 웃음소리로 상담실을 채우는 중',g:['cheerful']},
  {t:'{name}가 자기 얘기하다 신나서 목소리 커지는 중',g:['cheerful']},
  {t:'{name}가 상담사한테 되레 질문을 쏟아내는 중',g:['cheerful']},
  // anxious: 예민·불안·눈치
  {t:'{name}가 이 대답이 맞았나 계속 곱씹는 중',g:['anxious']},
  {t:'{name}가 상담사 눈치를 세 번째 보는 중',g:['anxious']},
  {t:'{name}가 다리를 쉴 새 없이 떠는 중',g:['anxious']},
  {t:'{name}가 손톱 옆 거스러미만 계속 뜯는 중',g:['anxious']},
  {t:'{name}가 별말 아닌데 괜히 변명을 덧붙이는 중',g:['anxious']},
  // chaotic: 충동·엉뚱·산만·4차원
  {t:'{name}가 창밖 비둘기랑 눈싸움하는 중',g:['chaotic']},
  {t:'{name}가 질문은 잊고 천장 무늬 세는 중',g:['chaotic']},
  {t:'{name}가 갑자기 딴 얘기로 새는 중',g:['chaotic']},
  {t:'{name}가 대답하다 방금 무슨 말 했는지 까먹는 중',g:['chaotic']},
  {t:'{name}가 의자에서 자세를 열 번쯤 바꾸는 중',g:['chaotic']},
  // serious: 진지·원칙·논리
  {t:'{name}가 질문 의도부터 정색하고 따지는 중',g:['serious']},
  {t:'{name}가 대답을 논리적으로 정리해 말하는 중',g:['serious']},
  {t:'{name}가 대답하기 전 잠시 생각을 정돈하는 중',g:['serious']},
  {t:'{name}가 애매한 표현은 하나하나 바로잡는 중',g:['serious']},
  {t:'{name}가 상담 규칙부터 확인하고 시작하는 중',g:['serious']},
  // gloomy: 우울·냉소·무기력
  {t:'{name}가 시선을 바닥에 오래 두는 중',g:['gloomy']},
  {t:'{name}가 대답 끝마다 작게 한숨 쉬는 중',g:['gloomy']},
  {t:'{name}가 창밖 흐린 하늘만 오래 바라보는 중',g:['gloomy']},
  {t:'{name}가 기대 없는 얼굴로 어깨를 축 늘어뜨리는 중',g:['gloomy']},
  {t:'{name}가 다 부질없다는 듯 무기력하게 앉아있는 중',g:['gloomy']},
  // aggressive: 공격·다혈질·까칠
  {t:'{name}가 질문이 마음에 안 들어 발끈하는 중',g:['aggressive']},
  {t:'{name}가 언성부터 높였다 스스로 놀라는 중',g:['aggressive']},
  {t:'{name}가 책상을 툭 치고는 시선 홱 돌리는 중',g:['aggressive']},
  {t:'{name}가 마음에 안 드는 질문에 콧방귀 뀌는 중',g:['aggressive']},
  {t:'{name}가 다리 떨다 발을 쿵 내려놓는 중',g:['aggressive']},
  // guarded: 츤데레·방어·경계
  {t:'{name}가 별거 아닌 척 속마음은 끝까지 숨기는 중',g:['guarded']},
  {t:'{name}가 쿠션 끌어안고 방어 태세 잡는 중',g:['guarded']},
  {t:'{name}가 핵심 질문마다 슬쩍 말을 돌리는 중',g:['guarded']},
  {t:'{name}가 웃는 얼굴 뒤로 한 발 물러서는 중',g:['guarded']},
  {t:'{name}가 진짜 얘기는 끝까지 아껴두는 중',g:['guarded']},
  // calm: 침착·차분·담담
  {t:'{name}가 물 한 모금 마시고 차분히 답하는 중',g:['calm']},
  {t:'{name}가 서두르지 않고 한 박자 쉬어 말하는 중',g:['calm']},
  {t:'{name}가 어떤 질문에도 표정 흔들림 없이 답하는 중',g:['calm']},
  {t:'{name}가 손을 가지런히 모으고 천천히 대답하는 중',g:['calm']},
  {t:'{name}가 급할 것 없다는 듯 여유롭게 앉아있는 중',g:['calm']},
  // lazy: 게으름·느긋·귀찮
  {t:'{name}가 의자에 늘어져 반쯤 눕는 중',g:['lazy']},
  {t:'{name}가 다 귀찮다는 듯 대충 답하는 중',g:['lazy']},
  {t:'{name}가 하품 참으며 느릿느릿 대답하는 중',g:['lazy']},
  {t:'{name}가 질문 반쯤 흘려듣고 대충 끄덕이는 중',g:['lazy']},
  {t:'{name}가 턱 괴고 나른하게 천장 보는 중',g:['lazy']},
];
const FLAVOR_KEYWORDS:Record<string,string[]>={
  shy:['소심','수줍','낯가림','낯을','내성적','부끄','숫기','조용','움츠','쭈뼛'],
  proud:['도도','거만','오만','자신감','당당','자부심','콧대','우월','자존심','프라이드','고고'],
  cold:['차가','시크','무뚝뚝','냉정','무심','쌀쌀','건조','무표정','까칠'],
  warm:['다정','따뜻','상냥','배려','친절','포근','자상','챙기','살가'],
  playful:['장난','짓궂','까불','능글','유쾌','익살','너스레','농담'],
  cheerful:['활발','명랑','쾌활','발랄','에너지','텐션','싹싹','밝은','밝고','밝다'],
  anxious:['예민','불안','걱정','눈치','긴장','초조','신경질','노심','조마'],
  chaotic:['충동','즉흥','엉뚱','산만','사차원','4차원','제멋대로','변덕','자유분방','괴짜','기이','파괴','정신없','종잡'],
  serious:['진지','원칙','규칙','완고','엄격','고지식','반듯','철저','책임감','논리','성실','올곧'],
  gloomy:['우울','어둡','무기력','냉소','비관','침울','그늘','자조','염세','시니컬'],
  aggressive:['공격','다혈질','폭력','사나','과격','거칠','호전','불같','성깔','욱하','드센'],
  guarded:['츤데레','방어적','경계','무장','내숭','새침','벽을','벽이','속마음','비밀'],
  calm:['침착','차분','냉철','담담','평온','태연','의젓','묵직'],
  lazy:['게으','느긋','태평','귀찮','나태','늘어지','늘어진'],
};
function detectFlavorTags(text:string):Set<string>{
  const t=(text||'').toLowerCase();
  const tags=new Set<string>();
  for(const tag of Object.keys(FLAVOR_KEYWORDS)){
    if(FLAVOR_KEYWORDS[tag].some(word=>t.includes(word)))tags.add(tag);
  }
  return tags;
}
function pickFlavors(text:string):string[]{
  const tags=detectFlavorTags(text);
  const out:string[]=[];
  const seen=new Set<string>();
  for(const flavor of FLAVOR_POOL){
    if(!flavor.g.some(tag=>tag==='any'||tags.has(tag)))continue;
    if(seen.has(flavor.t))continue;
    seen.add(flavor.t);
    out.push(flavor.t);
  }
  return out.length?out:FLAVOR_POOL.filter(f=>f.g.includes('any')).map(f=>f.t);
}
const RESPONSE_TYPE_LABELS:Record<QuestionResponseType,string>={fill_blank:'빈칸 채우기',sentence_continue:'문장 이어쓰기',dialogue_choice:'대사 고르기',bipolar_scale:'A/B 가까움',ranking:'순위 매기기',forced_choice:'둘 중 하나',multi_select:'복수 선택',least_likely:'가장 하지 않을 것',slider:'가능성 슬라이더',relationship_matrix:'관계별 반응',inner_outer:'속마음 · 실제 행동',temporal_compare:'시간별 반응',condition_followup:'조건 변화 비교',in_character_response:'캐릭터 대사 직접 쓰기',owner_meta:'오너 메타 질문'};

function responseTypeOf(question:InterviewQuestion):QuestionResponseType{const candidate=(question as InterviewQuestion&{responseType?:QuestionResponseType}).responseType;return candidate||(question.format==='free_response'?'in_character_response':'fill_blank')}
function responseConfigOf(question:InterviewQuestion){return (question as InterviewQuestion&{responseConfig?:InterviewQuestion['responseConfig']}).responseConfig||{rows:[],columns:[]}}
function isSavedSession(value:unknown):value is SavedAnalysisSession{if(!value||typeof value!=='object')return false;const saved=value as Partial<SavedAnalysisSession>;return saved.version===1&&typeof saved.stage==='string'}
function uniqueAnswersByOrder(items:InterviewAnswer[]){const byOrder=new Map<number,InterviewAnswer>();for(const item of items){if(Number.isInteger(item.order)&&item.order>=1&&item.order<=20)byOrder.set(item.order,item)}return [...byOrder.values()].sort((a,b)=>a.order-b.order)}
function upsertAnswer(items:InterviewAnswer[],answer:InterviewAnswer){return uniqueAnswersByOrder([...items.filter(item=>item.order!==answer.order),answer])}
function firstMissingOrder(items:InterviewAnswer[]){const orders=new Set(uniqueAnswersByOrder(items).map(item=>item.order));for(let order=1;order<=20;order+=1)if(!orders.has(order))return order;return null}
function mergeQuestionHistory(base:InterviewQuestion[],incoming:InterviewQuestion[]){const byOrder=new Map<number,InterviewQuestion>();for(const item of base)byOrder.set(item.order,item);for(const item of incoming)byOrder.set(item.order,item);return [...byOrder.values()].sort((a,b)=>a.order-b.order)}
function hasMeaningfulProgress(saved:SavedAnalysisSession){return !!(saved.name.trim()||saved.profileText.trim()||saved.secretProfileText.trim()||saved.draft||saved.answers.length||saved.question||saved.questionHistory.length||saved.selected||saved.custom.trim()||saved.reason.trim()||saved.multiSelected?.length||saved.ranking?.length||saved.secondary?.trim()||Object.keys(saved.matrixAnswers||{}).length)}
function responseDataFromAnswer(answer:InterviewAnswer|undefined):ResponseData{if(!answer?.branchContext||typeof answer.branchContext!=='object')return{};const raw=(answer.branchContext as Record<string,unknown>).responseData;return raw&&typeof raw==='object'?raw as ResponseData:{}}

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
  const [parseProgress,setParseProgress]=useState(0);
  const [finalizeProgress,setFinalizeProgress]=useState(0);
  const [flavorTick,setFlavorTick]=useState(0);
  const [error,setError]=useState('');
  const [result,setResult]=useState<FinalizeResult|null>(null);
  const [resumeCandidate,setResumeCandidate]=useState<SavedAnalysisSession|null>(null);
  const hydrated=useRef(false);
  const persistenceEnabled=useRef(false);
  const questionHistoryRef=useRef<InterviewQuestion[]>([]);
  const batchRequests=useRef<Map<number,Promise<InterviewQuestion[]>>>(new Map());

  useEffect(()=>{questionHistoryRef.current=questionHistory},[questionHistory]);

  function resetResponseDraft(){setSelected('');setCustom('');setReason('');setMultiSelected([]);setRanking([]);setSliderValue(50);setMatrixAnswers({});setSecondary('')}
  function setHistory(next:InterviewQuestion[]){questionHistoryRef.current=next;setQuestionHistory(next)}

  function applyQuestion(q:InterviewQuestion,history:InterviewQuestion[],answerList=answers){
    const index=Math.max(0,history.findIndex(item=>item.order===q.order));
    const saved=answerList.find(answer=>answer.order===q.order);
    const data=responseDataFromAnswer(saved);
    setHistory(history);setQuestion(q);setActiveQuestionIndex(index);resetResponseDraft();setError('');
    if(saved){
      if(Object.keys(data).length){setSelected(typeof data.selected==='string'?data.selected:'');setCustom(typeof data.custom==='string'?data.custom:'');setMultiSelected(Array.isArray(data.multiSelected)?data.multiSelected:[]);setRanking(Array.isArray(data.ranking)?data.ranking:[]);setSliderValue(typeof data.sliderValue==='number'?data.sliderValue:50);setMatrixAnswers(data.matrixAnswers&&typeof data.matrixAnswers==='object'?data.matrixAnswers:{});setSecondary(typeof data.secondary==='string'?data.secondary:'')}
      else{const matched=q.options.includes(saved.answer);setSelected(matched?saved.answer:'');setCustom(matched?'':saved.answer)}
      setReason(saved.reason||'');
    }
    setStage('interview');
    // Prefetch exactly one question ahead, generated with every answer known at
    // this moment, so the next question reflects prior answers with no wait.
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

  function clearProgressState(){setStage('input');setName('');setProfileText('');setSecretProfileText('');clearAppearanceImages();setDraft(null);setAnswers([]);setQuestion(null);setHistory([]);setActiveQuestionIndex(0);resetResponseDraft();setBusy(false);setError('');setResult(null);batchRequests.current.clear()}

  useEffect(()=>{
    try{const localRaw=localStorage.getItem(ANALYSIS_SESSION_KEY);const legacyRaw=sessionStorage.getItem(ANALYSIS_SESSION_KEY);const raw=localRaw||legacyRaw;if(raw){const parsed=JSON.parse(raw) as unknown;if(isSavedSession(parsed)&&hasMeaningfulProgress(parsed)){if(!localRaw)localStorage.setItem(ANALYSIS_SESSION_KEY,raw);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);setResumeCandidate(parsed);persistenceEnabled.current=false}else{localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);persistenceEnabled.current=true}}else persistenceEnabled.current=true}catch{localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);persistenceEnabled.current=true}finally{hydrated.current=true}
  },[]);

  useEffect(()=>{
    if(!hydrated.current||!persistenceEnabled.current||stage==='done')return;
    const timer=window.setTimeout(()=>{try{const saved:SavedAnalysisSession={version:1,stage:stage as SavedStage,name,profileText,secretProfileText,draft,answers:uniqueAnswersByOrder(answers),question,questionHistory,activeQuestionIndex,selected,custom,reason,multiSelected,ranking,sliderValue,matrixAnswers,secondary};if(hasMeaningfulProgress(saved))localStorage.setItem(ANALYSIS_SESSION_KEY,JSON.stringify(saved));else localStorage.removeItem(ANALYSIS_SESSION_KEY)}catch{}},150);
    return()=>window.clearTimeout(timer);
  },[stage,name,profileText,secretProfileText,draft,answers,question,questionHistory,activeQuestionIndex,selected,custom,reason,multiSelected,ranking,sliderValue,matrixAnswers,secondary]);

  // Everything we've analyzed so far, used to pick character-fitting loading flavor
  // without any AI call. At parse time this is the pasted profile; by finalize it also
  // includes inferences, confirmed facts, trait labels and the 20 answers.
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
  const matchedFlavors=useMemo(()=>pickFlavors(characterSignalText),[characterSignalText]);

  // Cute rotating "loading flavor" text while a generation step runs.
  useEffect(()=>{
    if(!busy)return;
    setFlavorTick(Math.floor(Math.random()*997));
    const id=window.setInterval(()=>setFlavorTick(t=>t+1),2600);
    return()=>window.clearInterval(id);
  },[busy]);
  const flavorName=(draft?.basicProfile.name||name||'이 캐릭터').trim()||'이 캐릭터';
  const flavorMessage=(matchedFlavors[flavorTick%matchedFlavors.length]||'').replace('{name}',flavorName);

  function continueSavedAnalysis(){if(!resumeCandidate)return;persistenceEnabled.current=false;restoreSavedSession(resumeCandidate);setResumeCandidate(null);window.setTimeout(()=>{persistenceEnabled.current=true},0)}
  function startFreshAnalysis(){persistenceEnabled.current=false;localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);setResumeCandidate(null);clearProgressState();window.setTimeout(()=>{persistenceEnabled.current=true},0)}
  function handleApiError(status:number,body:any){const code=body?.error||status;setError(code==='RATE_LIMITED'?'요청이 너무 많아요. 잠시 뒤 다시 시도해주세요.':`처리 중 오류가 발생했어요. (${typeof code==='string'?code:JSON.stringify(code)})`)}
  async function parse(){setBusy(true);setError('');setParseProgress(0);try{const body=await postJsonStream<{draft:CharacterDraft}>('/api/characters/parse',{name,profileText,secretProfileText,appearanceImages:getAppearanceImagesForRequest()},r=>setParseProgress(Math.min(99,Math.round(r*100))));setDraft(body.draft);setStage('review')}catch(err){const e=err as Error&{status?:number;body?:any};handleApiError(e.status||500,e.body||{error:e.message})}finally{setBusy(false)}}
  function verdict(id:string,ownerVerdict:'confirmed'|'ambiguous'|'rejected'){if(!draft)return;setDraft({...draft,aiInferences:draft.aiInferences.map(x=>{if(x.id!==id)return x;if(ownerVerdict==='confirmed'){const {ownerFeedback:_ownerFeedback,...rest}=x;return {...rest,ownerVerdict}}return {...x,ownerVerdict}})})}
  function inferenceFeedback(id:string,ownerFeedback:string){if(!draft)return;setDraft({...draft,aiInferences:draft.aiInferences.map(x=>x.id===id?{...x,ownerFeedback}:x)})}

  async function requestBatch(startOrder:number,currentAnswers:InterviewAnswer[],plannedBase=questionHistoryRef.current){
    if(!draft||startOrder>20)return[];const count=Math.min(1,21-startOrder);const existing=plannedBase.filter(q=>q.order>=startOrder&&q.order<startOrder+count);if(existing.length===count)return existing.sort((a,b)=>a.order-b.order);const pending=batchRequests.current.get(startOrder);if(pending)return pending;
    const promise=(async()=>{const normalizedAnswers=uniqueAnswersByOrder(currentAnswers);const r=await fetch('/api/characters/questions/next',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,answers:normalizedAnswers,plannedQuestions:plannedBase,startOrder,batchSize:count})});const body=await r.json();if(!r.ok){const err=new Error(typeof body?.error==='string'?body.error:`HTTP_${r.status}`) as Error&{status?:number;body?:any};err.status=r.status;err.body=body;throw err}const incoming=(Array.isArray(body.questions)?body.questions:body.question?[body.question]:[]) as InterviewQuestion[];const merged=mergeQuestionHistory(questionHistoryRef.current,incoming);setHistory(merged);return incoming.sort((a,b)=>a.order-b.order)})();
    batchRequests.current.set(startOrder,promise);try{return await promise}finally{batchRequests.current.delete(startOrder)}
  }

  async function goToOrder(order:number,currentAnswers:InterviewAnswer[],historyBase=questionHistoryRef.current){
    if(order>20){await finalize(currentAnswers);return}const existing=historyBase.find(item=>item.order===order)||questionHistoryRef.current.find(item=>item.order===order);if(existing){const history=mergeQuestionHistory(historyBase,questionHistoryRef.current);applyQuestion(existing,history,currentAnswers);return}setBusy(true);setError('');try{const questions=await requestBatch(order,currentAnswers,historyBase);const history=questionHistoryRef.current;const q=questions.find(item=>item.order===order)||history.find(item=>item.order===order);if(!q){setError('다음 질문 묶음을 불러오지 못했어요. 다시 시도해주세요.');return}applyQuestion(q,history,currentAnswers)}catch(err){const e=err as Error&{status?:number;body?:any};handleApiError(e.status||500,e.body||{error:e.message})}finally{setBusy(false)}
  }

  async function startInterview(){setAnswers([]);setQuestion(null);setHistory([]);setActiveQuestionIndex(0);batchRequests.current.clear();setBusy(true);setError('');try{const first=await requestBatch(1,[],[]);const history=questionHistoryRef.current;const q=first.find(item=>item.order===1)||history.find(item=>item.order===1);if(q)applyQuestion(q,history,[]);else setError('첫 질문 묶음을 만들지 못했어요.')}catch(err){const e=err as Error&{status?:number;body?:any};handleApiError(e.status||500,e.body||{error:e.message})}finally{setBusy(false)}}

  function buildCurrentAnswer(){
    if(!question)return null;const type=responseTypeOf(question);const config=responseConfigOf(question);const customAnswer=custom.trim();const reasonText=reason.trim();let answer='';let answerSource:'choice'|'custom'|'structured'='structured';
    if(type==='fill_blank'||type==='dialogue_choice'||type==='owner_meta'){answer=(customAnswer||selected).trim();answerSource=customAnswer?'custom':'choice'}else if(type==='sentence_continue'||type==='in_character_response'){answer=customAnswer;answerSource='custom'}else if(type==='bipolar_scale'){if(selected){const right=Math.max(0,Math.min(100,Math.round(sliderValue)));const left=100-right;answer=`${config.leftLabel||'A'} ${left}% / ${config.rightLabel||'B'} ${right}%`}}else if(type==='ranking'){if(ranking.length===question.options.length)answer=ranking.map((item,index)=>`${index+1}위 ${item}`).join(' > ')}else if(type==='forced_choice'){answer=selected;answerSource='choice'}else if(type==='multi_select'){if(multiSelected.length)answer=`복수 선택: ${multiSelected.join(', ')}`}else if(type==='least_likely'){if(selected)answer=`가장 하지 않을 것: ${selected}`;answerSource='choice'}else if(type==='slider'){answer=`${sliderValue}/100 (${config.minLabel||'낮음'} ↔ ${config.maxLabel||'높음'})`}else if(type==='relationship_matrix'){const rows=config.rows||[];if(rows.length&&rows.every(row=>matrixAnswers[row]))answer=rows.map(row=>`${row}: ${matrixAnswers[row]}`).join(' / ')}else if(type==='inner_outer'){if(customAnswer&&secondary.trim())answer=`속마음: ${customAnswer} / 실제 행동: ${secondary.trim()}`;answerSource='custom'}else if(type==='temporal_compare'){if(selected&&secondary)answer=`${config.leftLabel||'처음'}: ${selected} / ${config.rightLabel||'나중'}: ${secondary}`}else if(type==='condition_followup'){if(selected&&secondary)answer=`기본 상황: ${selected} / 조건 변경 후: ${secondary}`}
    if(!answer.trim())return null;const responseData:ResponseData={selected,custom,multiSelected,ranking,sliderValue,matrixAnswers,secondary};return {order:question.order,question:question.question,answer:answer.trim(),...(reasonText?{reason:reasonText}:{}),branchContext:{category:question.category,mode:question.mode,format:question.format,responseType:type,targetHook:question.targetHook,hypothesis:question.hypothesis,answerSource,responseData}} satisfies InterviewAnswer;
  }

  async function answerCurrent(){
    if(!question)return;const current=buildCurrentAnswer();if(!current)return;const editingPast=answers.some(answer=>answer.order>current.order);const next=editingPast?uniqueAnswersByOrder([...answers.filter(answer=>answer.order<current.order),current]):upsertAnswer(answers,current);const nextHistory=editingPast?questionHistory.filter(item=>item.order<=current.order):questionHistory;setAnswers(next);if(editingPast){batchRequests.current.clear();setHistory(nextHistory)}
    if(question.order===20){const missing=firstMissingOrder(next);if(missing!==null){const repairedAnswers=next.filter(answer=>answer.order<missing);const repairedHistory=nextHistory.filter(item=>item.order<missing);setAnswers(repairedAnswers);setHistory(repairedHistory);await goToOrder(missing,repairedAnswers,repairedHistory);return}await finalize(next);return}await goToOrder(question.order+1,next,nextHistory);
  }

  function previousQuestion(){if(busy||!question)return;const previous=questionHistory.filter(item=>item.order<question.order).at(-1);if(previous)applyQuestion(previous,questionHistory,answers)}
  function forwardQuestion(){if(busy||!question)return;const next=questionHistory.find(item=>item.order===question.order+1);if(next)applyQuestion(next,questionHistory,answers)}
  async function finalize(finalAnswers=answers){if(!draft)return;const normalizedAnswers=uniqueAnswersByOrder(finalAnswers);if(normalizedAnswers.length!==20){setStage('interview');setError('답변 순서를 복구하는 중이에요. 마지막으로 완료하지 못한 질문부터 다시 이어주세요.');return}setStage('finalizing');setBusy(true);setError('');setFinalizeProgress(0);try{const body=await postJsonStream<FinalizeResult&{shareCode:string;editToken:string}>('/api/characters/finalize',{draft,answers:normalizedAnswers},r=>setFinalizeProgress(Math.min(99,Math.round(r*100))));persistenceEnabled.current=false;localStorage.removeItem(ANALYSIS_SESSION_KEY);sessionStorage.removeItem(ANALYSIS_SESSION_KEY);localStorage.setItem(`chara_edit_${body.shareCode}`,body.editToken);setResult(body);setStage('done')}catch(err){const e=err as Error&{status?:number;body?:any};handleApiError(e.status||500,e.body||{error:e.message});setStage('interview')}finally{setBusy(false)}}

  function toggleMulti(option:string){const max=question?responseConfigOf(question).maxSelections:undefined;setMultiSelected(current=>{if(current.includes(option))return current.filter(item=>item!==option);if(max&&current.length>=max)return current;return [...current,option]})}
  function addRank(option:string){setRanking(current=>current.includes(option)?current:[...current,option])}
  function removeRank(option:string){setRanking(current=>current.filter(item=>item!==option))}
  function moveRank(index:number,direction:-1|1){setRanking(current=>{const next=[...current];const target=index+direction;if(target<0||target>=next.length)return current;[next[index],next[target]]=[next[target],next[index]];return next})}

  function renderResponseControls(){
    if(!question)return null;const type=responseTypeOf(question);const config=responseConfigOf(question);
    if(type==='fill_blank')return <><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}</div><div className="field"><label className="label">직접 빈칸 채우기</label><textarea disabled={busy} className="input" style={{minHeight:76,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} /></div></>;
    if(type==='sentence_continue')return <div className="field"><label className="label">문장을 이어 써주세요</label><textarea disabled={busy} className="input" style={{minHeight:120,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></div>;
    if(type==='dialogue_choice')return <><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>“{o}”</button>)}</div><div className="field"><label className="label">직접 대사 입력</label><textarea disabled={busy} className="input" style={{minHeight:76,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} /></div></>;
    if(type==='bipolar_scale')return <div className="bipolar-control"><div className="bipolar-labels"><strong>{config.leftLabel||'A'}</strong><strong>{config.rightLabel||'B'}</strong></div><div className="bipolar-track"><input aria-label="A와 B 사이에서 가까운 위치 선택" disabled={busy} className="bipolar-range" type="range" min={0} max={100} step={1} value={sliderValue} onPointerDown={()=>setSelected('dial')} onKeyDown={()=>setSelected('dial')} onChange={e=>{setSliderValue(Number(e.target.value));setSelected('dial')}} /></div><div className="bipolar-hints"><span>A에 가까움</span><span>반반</span><span>B에 가까움</span></div>{selected&&<div className="bipolar-current">{sliderValue===50?'정중앙':sliderValue<50?`${config.leftLabel||'A'} 쪽에 더 가까움`:`${config.rightLabel||'B'} 쪽에 더 가까움`}</div>}</div>;
    if(type==='ranking'){const remaining=question.options.filter(o=>!ranking.includes(o));return <div style={{marginTop:18}}><p className="muted">중요한 순서대로 눌러주세요. 먼저 누른 항목이 1위가 됩니다.</p>{ranking.length>0&&<div className="stack" style={{gap:8,marginBottom:14}}>{ranking.map((item,index)=><div key={item} style={{display:'flex',alignItems:'center',gap:8,padding:'12px 14px',border:'1px solid var(--line)',borderRadius:12}}><strong style={{minWidth:40}}>{index+1}위</strong><span style={{flex:1}}>{item}</span><button className="btn" disabled={busy||index===0} style={{padding:'6px 9px'}} onClick={()=>moveRank(index,-1)}>↑</button><button className="btn" disabled={busy||index===ranking.length-1} style={{padding:'6px 9px'}} onClick={()=>moveRank(index,1)}>↓</button><button className="btn" disabled={busy} style={{padding:'6px 9px'}} onClick={()=>removeRank(item)}>×</button></div>)}</div>}{remaining.length>0&&<div className="options">{remaining.map(o=><button disabled={busy} key={o} className="option" onClick={()=>addRank(o)}>{o}</button>)}</div>}</div>}
    if(type==='forced_choice')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div>;
    if(type==='multi_select')return <><p className="muted" style={{marginTop:18}}>해당되는 것을 모두 골라주세요.{config.maxSelections?` 최대 ${config.maxSelections}개까지 선택할 수 있어요.`:''}</p><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${multiSelected.includes(o)?'selected':''}`} onClick={()=>toggleMulti(o)}>{multiSelected.includes(o)?'✓ ':''}{o}</button>)}</div></>;
    if(type==='least_likely')return <div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div>;
    if(type==='slider')return <div style={{marginTop:24}}><div style={{textAlign:'center',fontSize:34,fontWeight:900,marginBottom:10}}>{sliderValue}<span className="muted" style={{fontSize:16}}> / 100</span></div><input disabled={busy} type="range" min={0} max={100} step={1} value={sliderValue} onChange={e=>setSliderValue(Number(e.target.value))} style={{width:'100%'}} /><div style={{display:'flex',justifyContent:'space-between',gap:20,marginTop:8,fontSize:13,fontWeight:700}}><span>{config.minLabel}</span><span style={{textAlign:'right'}}>{config.maxLabel}</span></div></div>;
    if(type==='relationship_matrix')return <div style={{marginTop:20}}>{config.rows.map(row=><div key={row} style={{padding:'14px 0',borderBottom:'1px solid var(--line)'}}><div className="label" style={{marginBottom:8}}>{row}</div><div className="options">{config.columns.map(column=><button disabled={busy} key={column} className={`option ${matrixAnswers[row]===column?'selected':''}`} onClick={()=>setMatrixAnswers(current=>({...current,[row]:column}))}>{column}</button>)}</div></div>)}</div>;
    if(type==='inner_outer')return <><div className="field"><label className="label">속으로 가장 먼저 드는 생각</label><textarea disabled={busy} className="input" style={{minHeight:100,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></div><div className="field"><label className="label">{config.prompt2||'실제로 겉으로 보이는 행동'}</label><textarea disabled={busy} className="input" style={{minHeight:100,resize:'vertical'}} value={secondary} onChange={e=>setSecondary(e.target.value)} /></div></>;
    if(type==='temporal_compare')return <div className="two-col" style={{marginTop:20}}><div className="field"><label className="label">{config.leftLabel||'직후'}</label><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div></div><div className="field"><label className="label">{config.rightLabel||'시간이 지난 뒤'}</label><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${secondary===o?'selected':''}`} onClick={()=>setSecondary(o)}>{o}</button>)}</div></div></div>;
    if(type==='condition_followup')return <><div className="field"><label className="label">기본 상황</label><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>setSelected(o)}>{o}</button>)}</div></div><div className="field"><label className="label">{config.prompt2}</label><div className="options">{(config.options2?.length?config.options2:question.options).map(o=><button disabled={busy} key={o} className={`option ${secondary===o?'selected':''}`} onClick={()=>setSecondary(o)}>{o}</button>)}</div></div></>;
    if(type==='in_character_response')return <div className="field"><label className="label">캐릭터라면 뭐라고 말할까요?</label><textarea disabled={busy} className="input" style={{minHeight:130,resize:'vertical'}} value={custom} onChange={e=>setCustom(e.target.value)} /></div>;
    return <><div className="options">{question.options.map(o=><button disabled={busy} key={o} className={`option ${selected===o?'selected':''}`} onClick={()=>{setSelected(o);setCustom('')}}>{o}</button>)}</div><div className="field"><label className="label">직접 입력</label><textarea disabled={busy} className="input" style={{minHeight:84,resize:'vertical'}} value={custom} onChange={e=>{setCustom(e.target.value);setSelected('')}} /></div></>;
  }

  const confidence=draft?.analysisConfidence??0;
  const viewingPastQuestion=!!question&&answers.some(answer=>answer.order>question.order);
  const savedAtCurrent=question?answers.find(answer=>answer.order===question.order):undefined;
  const currentBuilt=buildCurrentAnswer();
  const currentAnswerChanged=!!savedAtCurrent&&!!currentBuilt&&(currentBuilt.answer!==savedAtCurrent.answer||(currentBuilt.reason||'')!==(savedAtCurrent.reason||''));
  const hasCurrentResponse=!!currentBuilt;
  const responseType=question?responseTypeOf(question):null;
  const resumeProgress=resumeCandidate?(resumeCandidate.stage==='interview'||resumeCandidate.stage==='finalizing')?`인터뷰 ${Math.min(20,uniqueAnswersByOrder(resumeCandidate.answers).length+(resumeCandidate.question?1:0))}/20 진행 중`:resumeCandidate.stage==='review'?'프로필 첫 해석 확인 단계':'프로필 작성 중':'';

  return <>
    {stage==='input'&&<div className="card" aria-busy={busy}>{resumeCandidate&&<div style={{marginBottom:24,padding:'20px 22px',border:'1px solid var(--line)',borderRadius:16,background:'var(--accent-soft)'}}><div className="eyebrow">Saved progress</div><h3 style={{margin:'8px 0 8px'}}>작성하던 캐릭터 분석이 있어요.</h3><p className="muted" style={{margin:'0 0 4px'}}>이전에 입력한 프로필과 답변을 불러와서 계속할까요?</p><p style={{margin:'0 0 16px',fontWeight:800}}>{resumeCandidate.name||'이름 미입력'} · {resumeProgress}</p><div className="actions" style={{marginTop:0}}><button className="btn primary" onClick={continueSavedAnalysis}>이어하기</button><button className="btn" onClick={startFreshAnalysis}>처음부터 하기</button></div></div>}<div className="field"><label className="label">캐릭터 이름</label><input disabled={busy||!!resumeCandidate} className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="예: 한서진" /></div><div className="field"><label className="label">공개 프로필</label><textarea disabled={busy||!!resumeCandidate} className="textarea" value={profileText} onChange={e=>setProfileText(e.target.value)} placeholder="커뮤에서 공개했던 프로필 내용을 붙여넣으세요. 성격, 외관, 관계, 설정 등을 그대로 넣어도 됩니다." /></div><div className="field"><label className="label">비밀 프로필 <span className="muted">(선택)</span></label><textarea disabled={busy||!!resumeCandidate} className="textarea" value={secretProfileText} onChange={e=>setSecretProfileText(e.target.value)} placeholder="오너만 알고 있던 비밀 설정, 숨겨진 동기, 과거, 공개 프로필에 적지 않았던 내용을 붙여넣으세요. 없다면 비워두면 됩니다." /></div><AppearanceImageInput disabled={busy||!!resumeCandidate}/><div className="notice">공개 프로필과 비밀 프로필은 서로 다른 정보층으로 구분해 함께 분석합니다. 비밀 프로필 원문은 공유 코드로 보는 Character Passport에 직접 노출하지 않습니다.</div>{busy&&<div role="status" aria-live="polite" style={{marginTop:18,padding:'18px 20px',border:'1px solid var(--line)',borderRadius:16,background:'var(--accent-soft)'}}><div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:16}}><strong>프로필을 읽고 첫 해석을 만드는 중이에요</strong><strong style={{fontSize:20,fontVariantNumeric:'tabular-nums'}}>{parseProgress}%</strong></div><div aria-hidden="true" style={{height:9,borderRadius:999,overflow:'hidden',background:'rgba(23,24,22,.12)',marginTop:10}}><div style={{height:'100%',width:`${parseProgress}%`,borderRadius:999,background:'rgba(23,24,22,.78)',transition:'width .5s ease'}}/></div><p className="muted" style={{margin:'10px 0 0',lineHeight:1.5}}>{flavorMessage}</p></div>}{error&&<p className="error">{error}</p>}<div className="actions"><button className="btn primary" disabled={busy||!!resumeCandidate||name.trim().length<1||profileText.trim().length<20} onClick={parse}>{busy?`프로필을 읽는 중… ${parseProgress}%`:'프로필 해석 시작'}</button></div></div>}

    {stage==='review'&&draft&&<div className="stack" aria-busy={busy}><div className="card"><div className="eyebrow">첫 해석</div><h2 style={{marginTop:10}}>{draft.basicProfile.name}을 이렇게 이해했어요.</h2><div className="two-col"><div><div className="label">분석 정밀도</div><div style={{fontSize:40,fontWeight:900}}>{Math.round(confidence)}%</div></div><div><div className="label">확인된 설정</div><div style={{fontSize:40,fontWeight:900}}>{draft.confirmedFacts.length}</div></div></div><div className="progress" style={{marginTop:16}}><span style={{width:`${confidence}%`}}/></div></div><div className="card"><h3>첫 해석 확인</h3><p className="muted">애매하거나 틀린 해석은 직접 보충하면 이후 질문과 최종 해석에 반영돼요.</p>{draft.aiInferences.map(x=><div className="inference" key={x.id}><div className="inference-top"><p>{x.text}</p><span className="muted">{Math.round(x.confidence)}%</span></div>{x.evidence.length>0&&<div style={{marginTop:10}}><div className="label">근거</div><div className="tags" style={{marginTop:7}}>{x.evidence.map((e,i)=><span className="tag" key={`${x.id}-e-${i}`}>{e}</span>)}</div></div>}<div style={{display:'flex',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginTop:10}}><div className="pills" style={{marginTop:0}}><button disabled={busy} className={`pill ${x.ownerVerdict==='confirmed'?'active':''}`} onClick={()=>verdict(x.id,'confirmed')}>맞음</button><button disabled={busy} className={`pill ${x.ownerVerdict==='ambiguous'?'active':''}`} onClick={()=>verdict(x.id,'ambiguous')}>애매함</button><button disabled={busy} className={`pill ${x.ownerVerdict==='rejected'?'active':''}`} onClick={()=>verdict(x.id,'rejected')}>아님</button></div>{(x.ownerVerdict==='ambiguous'||x.ownerVerdict==='rejected')&&<div style={{flex:'1 1 320px',minWidth:240}}><label className="label">{x.ownerVerdict==='ambiguous'?'어떤 부분이 맞고, 어떤 부분이 다른가요?':'실제로는 어떤가요?'}</label><textarea disabled={busy} className="input" style={{minHeight:84,resize:'vertical',marginTop:7}} maxLength={1200} value={x.ownerFeedback||''} onChange={e=>inferenceFeedback(x.id,e.target.value)} /></div>}</div></div>)}</div>{busy&&<div role="status" aria-live="polite" className="card" style={{background:'var(--accent-soft)'}}><div className="loading" style={{fontWeight:900}}>첫 5문항을 준비하고 있어요 <i className="dot"/><i className="dot"/><i className="dot"/></div><p className="muted" style={{marginBottom:0}}>처음 5개를 한 번에 만든 뒤, 답변하는 동안 다음 5개를 뒤에서 미리 준비합니다.</p></div>}<div className="actions"><button disabled={busy} className="btn primary" onClick={startInterview}>{busy?'첫 5문항 준비 중…':'20문항 인터뷰 시작'}</button><button disabled={busy} className="btn" onClick={()=>setStage('input')}>프로필 다시 입력</button></div></div>}

    {stage==='interview'&&question&&<div className="card question-card"><div><div className="q-meta"><span>{question.order} / 20</span>{responseType&&<span>{RESPONSE_TYPE_LABELS[responseType]}</span>}{viewingPastQuestion&&<span>이전 질문 확인 중</span>}</div><div className="progress" style={{marginTop:10}}><span style={{width:`${(question.order-1)/20*100}%`}}/></div><h2 className="q-title">{question.question}</h2>{renderResponseControls()}<div className="field"><label className="label">왜 그렇게 답했나요? <span className="muted">(선택)</span></label><textarea disabled={busy} className="input" style={{minHeight:78,resize:'vertical'}} value={reason} onChange={e=>setReason(e.target.value)} /><span className="muted">여기에 적은 이유·맥락은 원문 그대로 다음 질문과 최종 해석에 반영돼요.</span></div></div><div>{error&&<p className="error">{error}</p>}{busy&&<p className="muted">다음 질문 묶음 준비를 마치는 중이에요.</p>}<div className="actions" style={{marginTop:16}}>{question.order>1&&<button className="btn" disabled={busy} onClick={previousQuestion}>← 이전 질문</button>}{viewingPastQuestion&&questionHistory.some(item=>item.order===question.order+1)&&<button className="btn" disabled={busy} onClick={forwardQuestion}>다음 질문 보기 →</button>}<button className="btn primary" disabled={busy||!hasCurrentResponse} onClick={answerCurrent}>{busy?'질문 준비 중…':viewingPastQuestion?(currentAnswerChanged?'수정하고 여기서부터 다시 진행':'이 답변부터 다시 진행'):question.order===20?'20문항 완료하고 요약 보기':'답변하고 다음 질문'}</button></div></div></div>}

    {stage==='finalizing'&&<div className="card" style={{textAlign:'center',padding:'72px 24px'}}><div className="loading" style={{fontSize:20,fontWeight:900,justifyContent:'center'}}>캐릭터 요약을 정리하고 있어요 <i className="dot"/><i className="dot"/><i className="dot"/></div><div style={{maxWidth:420,margin:'22px auto 0'}}><div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:16}}><span className="muted" style={{textAlign:'left',lineHeight:1.5}}>{flavorMessage}</span><strong style={{fontSize:22,fontVariantNumeric:'tabular-nums'}}>{finalizeProgress}%</strong></div><div aria-hidden="true" style={{height:10,borderRadius:999,overflow:'hidden',background:'rgba(23,24,22,.12)',marginTop:10}}><div style={{height:'100%',width:`${finalizeProgress}%`,borderRadius:999,background:'rgba(23,24,22,.78)',transition:'width .5s ease'}}/></div></div>{error&&<p className="error">{error}</p>}</div>}
    {stage==='done'&&result&&<CharacterReportView preview={result.preview} creatorEditToken={result.editToken}/>} 
  </>;
}
