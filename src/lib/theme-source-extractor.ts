import { colorSeparationScore, deriveThemePalette, type CharacterThemePalette, type ThemeSource } from '@/lib/theme-palette';

type ColorMention={index:number;term:string;color:string};
type RoleColor={color:string;score:number;partial:boolean};
type Seed={mainColor?:string;pointColor?:string;altColor?:string};

const COLORS:{term:string;color:string}[]=[
  {term:'플래티넘 블론드',color:'#DDD6C7'},{term:'플래티넘',color:'#DDD6C7'},{term:'백금발',color:'#DDD6C7'},
  {term:'은회색',color:'#B8BBC1'},{term:'은빛',color:'#C9CBD0'},{term:'은색',color:'#C9CBD0'},{term:'은발',color:'#C9CBD0'},
  {term:'백발',color:'#DDDCD5'},{term:'하얀색',color:'#D9D8D2'},{term:'하얀',color:'#D9D8D2'},{term:'흰색',color:'#D9D8D2'},{term:'흰',color:'#D9D8D2'},{term:'화이트',color:'#D9D8D2'},
  {term:'금빛',color:'#C39D35'},{term:'금색',color:'#C39D35'},{term:'금발',color:'#D4B258'},{term:'골드',color:'#C39D35'},{term:'노란색',color:'#D0B54F'},{term:'노랑',color:'#D0B54F'},
  {term:'적갈색',color:'#8D4939'},{term:'밤색',color:'#654331'},{term:'갈색',color:'#75503A'},{term:'갈발',color:'#75503A'},{term:'브라운',color:'#75503A'},
  {term:'주황색',color:'#C46C36'},{term:'주황',color:'#C46C36'},{term:'오렌지',color:'#C46C36'},{term:'코랄',color:'#C86F69'},
  {term:'분홍색',color:'#D78DA8'},{term:'분홍',color:'#D78DA8'},{term:'핑크',color:'#D78DA8'},{term:'자홍',color:'#B64C79'},
  {term:'버건디',color:'#6F3646'},{term:'와인색',color:'#713C4C'},{term:'와인',color:'#713C4C'},
  {term:'붉은색',color:'#B44743'},{term:'붉은',color:'#B44743'},{term:'빨간색',color:'#B44743'},{term:'빨강',color:'#B44743'},{term:'적색',color:'#B44743'},{term:'레드',color:'#B44743'},
  {term:'하늘색',color:'#76A9CE'},{term:'푸른색',color:'#4E75A4'},{term:'푸른',color:'#4E75A4'},{term:'파란색',color:'#4E75A4'},{term:'파란',color:'#4E75A4'},{term:'파랑',color:'#4E75A4'},{term:'청색',color:'#4E75A4'},{term:'블루',color:'#4E75A4'},{term:'남색',color:'#394D72'},{term:'네이비',color:'#394D72'},
  {term:'청록색',color:'#4C8986'},{term:'청록',color:'#4C8986'},{term:'민트색',color:'#79AF9F'},{term:'민트',color:'#79AF9F'},
  {term:'연두색',color:'#8FAE70'},{term:'연두',color:'#8FAE70'},{term:'초록색',color:'#5D805F'},{term:'초록',color:'#5D805F'},{term:'녹색',color:'#5D805F'},{term:'녹빛',color:'#5D805F'},{term:'그린',color:'#5D805F'},
  {term:'보라색',color:'#785E93'},{term:'보랏빛',color:'#785E93'},{term:'보라',color:'#785E93'},{term:'퍼플',color:'#785E93'},{term:'라벤더',color:'#9A88B2'},
  {term:'회색빛',color:'#7A7E82'},{term:'회색',color:'#7A7E82'},{term:'그레이',color:'#7A7E82'},
  {term:'검은색',color:'#202124'},{term:'검은',color:'#202124'},{term:'검정색',color:'#202124'},{term:'검정',color:'#202124'},{term:'흑색',color:'#202124'},{term:'블랙',color:'#202124'},
  {term:'벽안',color:'#4E75A4'},{term:'청안',color:'#4E75A4'},{term:'적안',color:'#B44743'},{term:'금안',color:'#C39D35'},{term:'녹안',color:'#5D805F'},{term:'자안',color:'#785E93'},{term:'흑안',color:'#252627'},{term:'회안',color:'#7A7E82'},
];

const HAIR_ROLES=['머리카락','머리 색','머리색','헤어 컬러','헤어컬러','헤어','모발','머리'];
const EYE_ROLES=['눈동자','눈 색','눈색','홍채','아이 컬러','아이컬러','벽안','청안','적안','금안','녹안','자안','흑안','회안','눈'];
const MAIN_ROLES=['대표색','대표 색','메인 컬러','메인컬러','주조색','주 색상','주색','의상','코트','옷'];
const POINT_ROLES=['포인트 컬러','포인트컬러','강조색','악세사리','액세서리','소품','장식'];
// 투톤·부분염색·오드아이 표현. 이런 수식이 붙은 색은 전체를 덮는 베이스가 아니라
// 부분색으로 보고, 대표색 후보에서 뒤로 미룬다.
const PARTIAL_MARKERS=['브릿지','브리지','인너','메시','투톤','그라데이션','그라데','끝부분','끝만','끝자락','부분적','부분','일부','군데','섞인','섞여','안쪽','속머리','오드아이','한쪽','왼쪽','오른쪽','좌안','우안'];
const PARTIAL_WINDOW=16;
// 역할과의 연결 강도가 이 정도 안이면 "비슷하게 유력한 후보"로 보고 대비로 고른다.
const TIE_MARGIN=12;

// 색 이름은 서로 부분문자열로 겹친다("붉은색"·"검은색" 안에 "은색"(은발)이 들어 있다).
// 긴 이름부터 자리를 선점하고 이미 쓰인 글자는 다시 쓰지 않아야, 붉은 눈이 은발로
// 둔갑하는 유령 색이 생기지 않는다.
function mentions(text:string):ColorMention[]{
  const out:ColorMention[]=[];
  const taken=new Array<boolean>(text.length).fill(false);
  const claim=(index:number,length:number)=>{
    for(let i=index;i<index+length;i+=1)if(taken[i])return false;
    for(let i=index;i<index+length;i+=1)taken[i]=true;
    return true;
  };
  const hex=/#[0-9a-f]{6}\b/ig;
  for(const match of text.matchAll(hex)){
    const index=match.index??0;
    if(claim(index,match[0].length))out.push({index,term:match[0],color:match[0].toUpperCase()});
  }
  for(const item of [...COLORS].sort((a,b)=>b.term.length-a.term.length)){
    let from=0;
    for(;;){
      const index=text.indexOf(item.term,from);
      if(index<0)break;
      if(claim(index,item.term.length))out.push({index,term:item.term,color:item.color});
      from=index+Math.max(1,item.term.length);
    }
  }
  return out.sort((a,b)=>a.index-b.index||b.term.length-a.term.length);
}

function rolePositions(text:string,roles:string[]){
  const out:{index:number;role:string}[]=[];
  for(const role of roles){
    let from=0;
    for(;;){
      const index=text.indexOf(role,from);
      if(index<0)break;
      out.push({index,role});
      from=index+Math.max(1,role.length);
    }
  }
  return out.sort((a,b)=>a.index-b.index||b.role.length-a.role.length);
}

function isPartialMention(text:string,color:ColorMention){
  const from=Math.max(0,color.index-PARTIAL_WINDOW);
  const to=Math.min(text.length,color.index+color.term.length+PARTIAL_WINDOW);
  const window=text.slice(from,to);
  return PARTIAL_MARKERS.some(marker=>window.includes(marker));
}

// 한 역할(머리/눈)에 대해 후보 색을 "전부" 모아 가까운 순으로 돌려준다.
// 예전에는 가장 가까운 색 하나만 남겨서, 투톤·오드아이의 두 번째 색이 조용히 버려졌다.
function nearestColors(text:string,roles:string[],maxDistance=48):RoleColor[]{
  const colors=mentions(text);
  if(!colors.length)return [];
  const positions=rolePositions(text,roles);
  const best=new Map<string,RoleColor>();
  for(const color of colors){
    let score:number|undefined;
    for(const role of positions){
      const roleCenter=role.index+role.role.length/2;
      const colorCenter=color.index+color.term.length/2;
      const distance=Math.abs(colorCenter-roleCenter);
      if(distance>maxDistance)continue;
      const sameClause=text.slice(Math.min(role.index,color.index),Math.max(role.index+role.role.length,color.index+color.term.length));
      const clausePenalty=/[\n.!?。！？;]/u.test(sameClause)?30:0;
      const afterBonus=color.index>=role.index?-3:0;
      const candidate=distance+clausePenalty+afterBonus;
      if(score===undefined||candidate<score)score=candidate;
    }
    if(score===undefined)continue;
    const partial=isPartialMention(text,color);
    const previous=best.get(color.color);
    // 같은 색이 여러 번 나오면 가장 가까운 등장을 쓰되, 한 번이라도 베이스로
    // 언급됐다면 베이스로 취급한다.
    if(!previous||score<previous.score)best.set(color.color,{color:color.color,score,partial:previous?previous.partial&&partial:partial});
    else if(!partial&&previous.partial)best.set(color.color,{...previous,partial:false});
  }
  return [...best.values()].sort((a,b)=>a.score-b.score);
}

function roleColors(text:string,primaryRoles:string[],fallbackRoles:string[],primaryDistance:number,fallbackDistance=64){
  const primary=nearestColors(text,primaryRoles,primaryDistance);
  return primary.length?primary:nearestColors(text,fallbackRoles,fallbackDistance);
}

// 여러 후보 중 대표색을 고른다: 부분염색 수식이 붙지 않은 "베이스" 색이 먼저다.
function pickBase(candidates:RoleColor[]){
  return candidates.find(item=>!item.partial)||candidates[0];
}

function seedFromText(text:string):Seed|undefined{
  const normalized=text.replace(/\r\n?/g,'\n');
  if(!normalized.trim())return undefined;
  const hair=roleColors(normalized,HAIR_ROLES,MAIN_ROLES,56);
  const eye=roleColors(normalized,EYE_ROLES,POINT_ROLES,42);

  const mainColor=pickBase(hair)?.color;
  // 오드아이처럼 눈 색이 여럿이면 어느 쪽도 틀린 답이 아니므로, 화면에서 배경(main)과
  // 가장 잘 구분되는 쪽을 포인트로 삼는다. 단 이 비교는 "역할과의 연결이 비슷하게 강한"
  // 후보끼리만 한다. 그러지 않으면 다른 절에 있던 먼 색이 대비가 크다는 이유로
  // 정작 눈동자 옆에 붙어 있는 색을 밀어내 버린다.
  const eyeBest=eye[0];
  const eyeTies=eyeBest?eye.filter(item=>item.score<=eyeBest.score+TIE_MARGIN):[];
  const eyePick=mainColor&&eyeTies.length>1
    ? eyeTies.slice().sort((a,b)=>colorSeparationScore(mainColor,b.color)-colorSeparationScore(mainColor,a.color))[0]
    : eyeBest;
  const pointColor=eyePick?.color;

  // 남는 색(투톤의 두 번째 머리색, 오드아이의 반대쪽 눈)은 버리지 않고 보조색으로 넘긴다.
  const leftovers=[
    ...hair.filter(item=>item.color!==mainColor),
    ...eye.filter(item=>item.color!==pointColor),
  ];
  const altColor=leftovers.find(item=>item.color!==mainColor&&item.color!==pointColor)?.color;

  return mainColor||pointColor?{mainColor,pointColor,altColor}:undefined;
}

export function deriveCharacterThemeFromSources(input:{profileText?:string;secretProfileText?:string;appearanceNotes?:string}):CharacterThemePalette|undefined{
  // Profile text is the owner's official setting. Image analysis is observational and
  // only fills a role that the text did not specify; it must never overwrite text.
  const textSeed=seedFromText([input.profileText||'',input.secretProfileText||''].filter(Boolean).join('\n'));
  const imageSeed=seedFromText(input.appearanceNotes||'');
  const main=textSeed?.mainColor||imageSeed?.mainColor;
  const point=textSeed?.pointColor||imageSeed?.pointColor;
  const alt=textSeed?.altColor||imageSeed?.altColor;
  if(!main&&!point)return undefined;

  const usedText=Boolean(textSeed?.mainColor||textSeed?.pointColor);
  const usedImage=Boolean(
    (!textSeed?.mainColor&&imageSeed?.mainColor)||
    (!textSeed?.pointColor&&imageSeed?.pointColor),
  );
  const source:ThemeSource=usedText&&usedImage?'mixed':usedText?'text':'image';
  const confidence=source==='text'?90:source==='mixed'?86:80;
  return deriveThemePalette(main,point,source,confidence,alt);
}
