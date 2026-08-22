import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const BASE = 'https://www.cha-lab.com';
const PROFILE = `27세. 말수가 적지만 가까운 사람 앞에서는 장난이 많다.
약속 시간은 거의 어기지 않고, 다른 사람이 늦는 건 한두 번은 넘어가지만 반복되면 이유를 직접 묻는다.
동생이 곤란한 일을 겪으면 먼저 해결책을 찾지만 본인이 힘들 때는 도움을 잘 요청하지 않는다.
게임이나 승부에서는 지는 걸 싫어하지만 상대가 실수해서 이기는 건 찝찝해한다.
여행을 다녀오면 표, 영수증, 작은 안내지를 모아 상자에 보관한다.
사람이 많은 장소에서는 오래 있으면 지치며, 혼자 걷거나 조용한 카페에서 쉬는 걸 좋아한다.
누군가 부당하게 대우받는 걸 보면 모른 척하지 못하고 상황을 확인한 뒤 필요한 말을 한다.
화가 났을 때 바로 소리치기보다 말을 줄이고 혼자 정리한 다음 다시 대화하는 편이다.
사과할 때 긴 설명보다 잘못한 부분을 고치거나 다음 행동으로 보여주는 쪽을 편하게 느낀다.
친하지 않은 사람이 사적인 질문을 계속하면 웃으며 넘기다가 선을 긋는다.
일을 맡으면 끝까지 책임지려 하지만, 계획이 틀어지면 혼자서라도 원래 수준을 맞추려고 무리하는 경향이 있다.`;
const SECRET = `가족의 경제 사정이 좋지 않았던 시기가 길어서 돈이나 빚 이야기에 예민하다.
본인이 누군가에게 부담이 되는 상황을 특히 싫어해 부탁을 미루는 편이다.
친한 사람에게 실망했을 때 관계를 바로 끊기보다 한 번은 이유를 확인하지만, 같은 문제가 반복되면 조용히 거리를 둔다.
어릴 때부터 모아온 여행 표와 영수증 중 일부는 힘들었던 시기의 기억과 연결되어 있어 버리지 못한다.`;

const draft = {
  basicProfile: { name: '테스트 캐릭터 윤서', age: '27', gender: null, profileText: PROFILE, secretProfileText: SECRET },
  traits: { sociability: 38, responsibility: 82, impulsivity: 25, competitiveness: 68 },
  relationshipTraits: { trust: 58, boundaries: 74, helpSeeking: 24 },
  confirmedFacts: [
    { key: 'anger', value: '화가 나면 말을 줄이고 혼자 정리한 뒤 대화한다', source: 'profile' },
    { key: 'help', value: '타인은 먼저 돕지만 본인이 힘들 때 도움 요청은 잘 하지 않는다', source: 'profile' },
    { key: 'memory', value: '여행 표와 영수증 일부는 힘든 시기 기억과 연결되어 있다', source: 'profile' },
  ],
  aiInferences: [],
  personalityTags: { aiInitial: [], ownerSelected: [], interviewAdaptive: [], finalAdaptive: [] },
  analysisConfidence: 78,
};

const seedMeta = [
  ['core','pivot','가까운 사람 앞의 장난','가까운 사람 앞에서만 장난이 늘어나는 이유','가까운 사람과 있으면 말수가 늘어난다.'],
  ['relationship','pivot','도움 요청 회피','본인이 힘들 때 도움을 요청하지 않는 기준','먼저 혼자 해결해보는 편이다.'],
  ['conflict','pivot','반복 지각 대응','반복되는 약속 위반에서 선을 긋는 기준','두 번째부터는 이유를 직접 묻는다.'],
  ['inner','pivot','불공정한 승리 거부감','이기는 것보다 공정함을 중시하는 순간','상대 실수 덕분에 이기면 찝찝하다.'],
  ['validation','pivot','여행 기록 보관','여행 종이를 버리지 못하는 의미','기억이 남아 있어서 보관한다.'],
  ['inner','pivot','화난 뒤 혼자 정리','감정을 바로 표출하지 않는 이유','말을 줄이고 생각부터 정리한다.'],
  ['conflict','branch','사과보다 행동','사과에서 행동 변화를 중시하는 기준','말보다 다음 행동이 더 중요하다.'],
  ['relationship','pivot','사적 질문 경계','낯선 사람에게 선을 긋는 시점','반복되면 웃어넘기지 않고 선을 긋는다.'],
  ['inner','counter','책임감과 무리','책임감을 지키려다 무리하는 임계점','원래 수준을 맞추려고 혼자 무리한다.'],
  ['conflict','pivot','부당함 개입','타인의 부당한 대우에 개입하는 기준','상황을 확인한 뒤 필요한 말을 한다.'],
  ['core','branch','혼자 쉬는 방식','사람이 많은 곳에서 회복하는 방식','혼자 걷거나 조용한 카페에서 쉰다.'],
  ['relationship','pivot','친한 사람의 반복 실망','가까운 사람에게 주는 두 번째 기회','한 번은 이유를 확인하지만 반복되면 거리를 둔다.'],
  ['inner','counter','부담이 되기 싫음','도움을 청하지 않는 태도와 부담감의 연결','누군가에게 부담이 되는 상황을 특히 싫어한다.'],
  ['conflict','pivot','돈과 빚 민감성','경제적 주제가 판단에 영향을 주는 지점','돈이나 빚 이야기에 예민하다.'],
] as const;
const responseTypes = ['fill_blank','sentence_continue','dialogue_choice','bipolar_scale','ranking','multi_select','least_likely','slider','relationship_matrix','inner_outer','temporal_compare','condition_followup','owner_meta','fill_blank'];

function seedAnswers(count:number){return seedMeta.slice(0,count).map((item,index)=>({order:index+1,question:item[3],answer:item[4],reason:index%2?'상황과 상대에 따라 예외가 있지만 기본적으로 그렇다.':'이 기준이 평소 선택에서 자주 드러난다.',branchContext:{category:item[0],mode:item[1],format:'scenario',responseType:responseTypes[index],targetHook:item[2],hypothesis:item[3],answerSource:'custom'}}));}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function post(body:unknown){let last='';for(let attempt=1;attempt<=4;attempt+=1){const response=await fetch(`${BASE}/api/characters/questions/next`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const text=await response.text();last=`${response.status}: ${text.slice(0,900)}`;if(response.ok)return JSON.parse(text);if(response.status<500)throw new Error(last);await sleep(attempt*900);}throw new Error(last);}
function answerFrom(q:Record<string,any>,order:number){const c=q.responseConfig||{},o:string[]=q.options||[];const pick=(a:string[]|undefined,i=0)=>a?.length?a[Math.min(i,a.length-1)]:'';let answer='';switch(q.responseType){case'fill_blank':case'dialogue_choice':case'owner_meta':answer=pick(o,order%Math.max(1,o.length));break;case'sentence_continue':answer='상황을 먼저 정리한 뒤 필요한 말을 한다.';break;case'bipolar_scale':answer=`${c.leftLabel||'A'} 55% / ${c.rightLabel||'B'} 45%`;break;case'ranking':answer=o.map((x,i)=>`${i+1}위 ${x}`).join(' > ');break;case'multi_select':answer=`복수 선택: ${o.slice(0,2).join(', ')}`;break;case'least_likely':answer=`가장 하지 않을 것: ${pick(o)}`;break;case'slider':answer=`60/100 (${c.minLabel||'낮음'} ↔ ${c.maxLabel||'높음'})`;break;case'relationship_matrix':answer=(c.rows||[]).map((row:string)=>`${row}: ${pick((c.rowOptions||{})[row]||[])}`).join(' / ');break;case'inner_outer':answer='속마음: 먼저 혼자 정리하고 싶다 / 실제 행동: 바로 대답하지 않고 시간을 둔다';break;case'temporal_compare':answer=`${c.leftLabel||'처음'}: ${pick(o)} / ${c.rightLabel||'나중'}: ${pick(c.options2||[])}`;break;case'condition_followup':answer=`기본 상황: ${pick(o)} / 조건 변경 후: ${pick(c.options2||[])}`;break;default:answer=pick(o)||'상황을 먼저 확인한다.';}if(!answer)answer='상황을 먼저 확인한다.';return{order:q.order,question:q.question,answer,reason:order%2?'가까운 사람에게는 예외가 생길 수 있지만 기본 반응은 이쪽이다.':'상대와 책임의 정도를 본 뒤 결정하는 편이다.',branchContext:{category:q.category,mode:q.mode,format:q.format,responseType:q.responseType,targetHook:q.targetHook,hypothesis:q.hypothesis,answerSource:'structured'}};}

export async function GET(request:NextRequest){
  try{
    const phase=request.nextUrl.searchParams.get('phase')||'early';
    const start=phase==='middle'?7:phase==='deep'?15:1;
    const answers:any[]=seedAnswers(start-1);
    const questions:Record<string,any>[]=[];
    for(let order=start;order<start+4;order+=1){const body=await post({draft,answers,plannedQuestions:[],startOrder:order,batchSize:1});const q=body.question||body.questions?.[0];if(!q)throw new Error(`missing Q${order}`);questions.push(q);answers.push(answerFrom(q,order));}
    return NextResponse.json({phase,start,seedLastMode:start>1?answers[start-2]?.branchContext?.mode:null,questions:questions.map(q=>({order:q.order,category:q.category,mode:q.mode,responseType:q.responseType,targetHook:q.targetHook,question:q.question}))});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:500});}
}
