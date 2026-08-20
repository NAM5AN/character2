import { deriveThemePalette, type CharacterThemePalette, type ThemeSource } from '@/lib/theme-palette';

type ColorMention={index:number;term:string;color:string};
type Seed={mainColor?:string;pointColor?:string};

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

function mentions(text:string):ColorMention[]{
  const out:ColorMention[]=[];
  const hex=/#[0-9a-f]{6}\b/ig;
  for(const match of text.matchAll(hex))out.push({index:match.index??0,term:match[0],color:match[0].toUpperCase()});
  for(const item of COLORS){
    let from=0;
    for(;;){
      const index=text.indexOf(item.term,from);
      if(index<0)break;
      out.push({index,term:item.term,color:item.color});
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

function nearestColor(text:string,roles:string[],maxDistance=48){
  const colors=mentions(text);
  if(!colors.length)return undefined;
  const positions=rolePositions(text,roles);
  let best:{score:number;color:string}|undefined;
  for(const role of positions){
    for(const color of colors){
      const roleCenter=role.index+role.role.length/2;
      const colorCenter=color.index+color.term.length/2;
      const distance=Math.abs(colorCenter-roleCenter);
      if(distance>maxDistance)continue;
      const sameClause=text.slice(Math.min(role.index,color.index),Math.max(role.index+role.role.length,color.index+color.term.length));
      const clausePenalty=/[\n.!?。！？;]/u.test(sameClause)?30:0;
      const afterBonus=color.index>=role.index?-3:0;
      const score=distance+clausePenalty+afterBonus;
      if(!best||score<best.score)best={score,color:color.color};
    }
  }
  return best?.color;
}

function seedFromText(text:string):Seed|undefined{
  const normalized=text.replace(/\r\n?/g,'\n');
  if(!normalized.trim())return undefined;
  const mainColor=nearestColor(normalized,HAIR_ROLES,56)||nearestColor(normalized,MAIN_ROLES,64);
  const pointColor=nearestColor(normalized,EYE_ROLES,42)||nearestColor(normalized,POINT_ROLES,64);
  return mainColor||pointColor?{mainColor,pointColor}:undefined;
}

export function deriveCharacterThemeFromSources(input:{profileText?:string;secretProfileText?:string;appearanceNotes?:string}):CharacterThemePalette|undefined{
  const textSeed=seedFromText([input.profileText||'',input.secretProfileText||''].filter(Boolean).join('\n'));
  const imageSeed=seedFromText(input.appearanceNotes||'');
  const main=imageSeed?.mainColor||textSeed?.mainColor;
  const point=imageSeed?.pointColor||textSeed?.pointColor;
  if(!main&&!point)return undefined;
  const hasImage=Boolean(imageSeed?.mainColor||imageSeed?.pointColor);
  const hasText=Boolean(textSeed?.mainColor||textSeed?.pointColor);
  const source:ThemeSource=hasImage&&hasText?'mixed':hasImage?'image':'text';
  return deriveThemePalette(main,point,source,hasImage&&hasText?84:hasImage?80:72);
}
