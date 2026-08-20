import { z } from 'zod';

const HEX_RE=/^#[0-9a-f]{6}$/i;
export const hexColorSchema=z.string().regex(HEX_RE);

export const characterThemeSeedSchema=z.object({
  mainColor:hexColorSchema.nullable().optional(),
  pointColor:hexColorSchema.nullable().optional(),
  mainBasis:z.string().max(180).optional().default(''),
  pointBasis:z.string().max(180).optional().default(''),
  source:z.enum(['profile_text','appearance_image','mixed']).optional(),
});

export const characterThemeSchema=z.object({
  main:hexColorSchema,
  mainSub:hexColorSchema,
  point:hexColorSchema,
  pointSub:hexColorSchema,
  mainBasis:z.string().max(180).optional().default(''),
  pointBasis:z.string().max(180).optional().default(''),
  source:z.enum(['profile_text','appearance_image','mixed']).optional().default('profile_text'),
});

export type CharacterThemeSeed=z.infer<typeof characterThemeSeedSchema>;
export type CharacterTheme=z.infer<typeof characterThemeSchema>;

type RGB={r:number;g:number;b:number};
type HSL={h:number;s:number;l:number};

function clamp(n:number,min:number,max:number){return Math.min(max,Math.max(min,n))}
function toHexByte(n:number){return Math.round(clamp(n,0,255)).toString(16).padStart(2,'0').toUpperCase()}
function rgbToHex({r,g,b}:RGB){return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`}
function hexToRgb(hex:string):RGB|null{
  if(!HEX_RE.test(hex))return null;
  const n=parseInt(hex.slice(1),16);
  return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function rgbToHsl({r,g,b}:RGB):HSL{
  let rr=r/255,gg=g/255,bb=b/255;
  const max=Math.max(rr,gg,bb),min=Math.min(rr,gg,bb);
  let h=0,s=0;const l=(max+min)/2;
  if(max!==min){
    const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);
    switch(max){case rr:h=(gg-bb)/d+(gg<bb?6:0);break;case gg:h=(bb-rr)/d+2;break;default:h=(rr-gg)/d+4}
    h/=6;
  }
  return {h:h*360,s:s*100,l:l*100};
}
function hslToRgb({h,s,l}:HSL):RGB{
  const hh=((h%360)+360)%360/360,ss=clamp(s,0,100)/100,ll=clamp(l,0,100)/100;
  if(ss===0){const v=ll*255;return {r:v,g:v,b:v}}
  const hue=(p:number,q:number,t:number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};
  const q=ll<.5?ll*(1+ss):ll+ss-ll*ss,p=2*ll-q;
  return {r:hue(p,q,hh+1/3)*255,g:hue(p,q,hh)*255,b:hue(p,q,hh-1/3)*255};
}
function normalizeHex(value:unknown){return typeof value==='string'&&HEX_RE.test(value.trim())?value.trim().toUpperCase():null}
function adjusted(hex:string,mode:'main'|'point'|'mainSub'|'pointSub'){
  const rgb=hexToRgb(hex)!;const hsl=rgbToHsl(rgb);const neutral=hsl.s<8;
  if(mode==='main'){
    const s=neutral?clamp(hsl.s,0,10):clamp(hsl.s,14,62);
    const l=clamp(hsl.l,14,86);
    return rgbToHex(hslToRgb({h:hsl.h,s,l}));
  }
  if(mode==='point'){
    const s=neutral?clamp(hsl.s,0,12):clamp(hsl.s,28,78);
    const l=clamp(hsl.l,28,72);
    return rgbToHex(hslToRgb({h:hsl.h,s,l}));
  }
  if(mode==='mainSub'){
    const s=neutral?clamp(hsl.s,0,8):clamp(hsl.s*.42,8,32);
    return rgbToHex(hslToRgb({h:hsl.h,s,l:94}));
  }
  const s=neutral?clamp(hsl.s,0,10):clamp(hsl.s*.5,10,38);
  return rgbToHex(hslToRgb({h:hsl.h,s,l:92}));
}
function derivedPointFromMain(main:string){
  const hsl=rgbToHsl(hexToRgb(main)!);
  const neutral=hsl.s<8;
  return rgbToHex(hslToRgb({h:hsl.h,s:neutral?8:clamp(hsl.s+10,28,72),l:hsl.l>55?clamp(hsl.l-18,30,68):clamp(hsl.l+14,32,68)}));
}
function derivedMainFromPoint(point:string){
  const hsl=rgbToHsl(hexToRgb(point)!);
  return rgbToHex(hslToRgb({h:hsl.h,s:hsl.s<8?6:clamp(hsl.s*.66,12,48),l:clamp(hsl.l+10,26,78)}));
}

export function buildCharacterTheme(seed:unknown):CharacterTheme|undefined{
  const parsed=characterThemeSeedSchema.safeParse(seed);
  if(!parsed.success)return undefined;
  let mainRaw=normalizeHex(parsed.data.mainColor),pointRaw=normalizeHex(parsed.data.pointColor);
  if(!mainRaw&&!pointRaw)return undefined;
  if(!mainRaw&&pointRaw)mainRaw=derivedMainFromPoint(pointRaw);
  if(!pointRaw&&mainRaw)pointRaw=derivedPointFromMain(mainRaw);
  if(!mainRaw||!pointRaw)return undefined;
  const main=adjusted(mainRaw,'main');
  const point=adjusted(pointRaw,'point');
  return characterThemeSchema.parse({
    main,
    mainSub:adjusted(main,'mainSub'),
    point,
    pointSub:adjusted(point,'pointSub'),
    mainBasis:parsed.data.mainBasis||'',
    pointBasis:parsed.data.pointBasis||'',
    source:parsed.data.source||'profile_text',
  });
}

const COLOR_TERMS:[string,string][]=[
  ['백금발','#DDD6C7'],['플래티넘','#DDD6C7'],['은회색','#B8BBC1'],['은발','#C9CBD0'],['백발','#DDDCD5'],
  ['금발','#D4B258'],['샛노랑','#D7B93C'],['노란색','#D0B54F'],['노랑','#D0B54F'],
  ['적갈색','#8D4939'],['갈색','#75503A'],['갈발','#75503A'],['밤색','#654331'],['브라운','#75503A'],
  ['주황색','#C46C36'],['주황','#C46C36'],['오렌지','#C46C36'],['코랄','#C86F69'],
  ['분홍색','#D78DA8'],['분홍','#D78DA8'],['핑크','#D78DA8'],['자홍','#B64C79'],
  ['와인색','#713C4C'],['와인','#713C4C'],['버건디','#6F3646'],['적색','#B44743'],['빨간색','#B44743'],['빨강','#B44743'],
  ['남색','#394D72'],['네이비','#394D72'],['하늘색','#76A9CE'],['청색','#4E75A4'],['파란색','#4E75A4'],['파랑','#4E75A4'],['블루','#4E75A4'],
  ['청록색','#4C8986'],['청록','#4C8986'],['민트색','#79AF9F'],['민트','#79AF9F'],
  ['연두색','#8FAE70'],['연두','#8FAE70'],['녹색','#5D805F'],['초록색','#5D805F'],['초록','#5D805F'],['그린','#5D805F'],
  ['보라색','#785E93'],['보라','#785E93'],['퍼플','#785E93'],['라벤더','#9A88B2'],
  ['회색','#7A7E82'],['회색빛','#7A7E82'],['그레이','#7A7E82'],['검은색','#202124'],['검정','#202124'],['흑색','#202124'],['블랙','#202124'],['흰색','#D9D8D2'],['화이트','#D9D8D2'],
  ['벽안','#4E75A4'],['청안','#4E75A4'],['적안','#B44743'],['금안','#C39D35'],['녹안','#5D805F'],['자안','#785E93'],['흑안','#252627'],['회안','#7A7E82'],
];
const HAIR_WORDS=['머리카락','머리색','헤어 컬러','헤어컬러','헤어','머리','모발','발색'];
const EYE_WORDS=['눈동자','홍채','눈 색','눈색','눈','아이 컬러','아이컬러'];
const MAIN_WORDS=['대표색','메인 컬러','메인컬러','주조색','주 색상','주색','의상','코트','옷'];
const POINT_WORDS=['포인트 컬러','포인트컬러','강조색','소품','장식'];

function sentenceChunks(text:string){return text.replace(/\r\n?/g,'\n').split(/\n|(?<=[.!?。！？])\s+/u).map(v=>v.trim()).filter(Boolean)}
function colorFromChunk(chunk:string){
  const hex=chunk.match(/#[0-9a-f]{6}\b/i)?.[0];if(hex)return hex.toUpperCase();
  for(const [term,color] of COLOR_TERMS){if(chunk.includes(term))return color}
  return null;
}
function roleColor(text:string,roles:string[]){
  for(const chunk of sentenceChunks(text)){
    if(!roles.some(role=>chunk.includes(role)))continue;
    const color=colorFromChunk(chunk);if(color)return {color,basis:chunk.slice(0,180)};
  }
  return null;
}

export function extractThemeSeedFromText(publicText:string,secretText=''):CharacterThemeSeed|undefined{
  const text=[publicText,secretText].filter(Boolean).join('\n');
  if(!text.trim())return undefined;
  const hair=roleColor(text,HAIR_WORDS),eye=roleColor(text,EYE_WORDS);
  const main=hair||roleColor(text,MAIN_WORDS),point=eye||roleColor(text,POINT_WORDS);
  if(!main&&!point)return undefined;
  return {mainColor:main?.color||null,pointColor:point?.color||null,mainBasis:main?.basis||'',pointBasis:point?.basis||'',source:'profile_text'};
}

export function mergeThemeSeeds(preferred:CharacterThemeSeed|undefined,fallback:CharacterThemeSeed|undefined):CharacterThemeSeed|undefined{
  if(!preferred)return fallback;if(!fallback)return preferred;
  const mainColor=preferred.mainColor||fallback.mainColor||null;
  const pointColor=preferred.pointColor||fallback.pointColor||null;
  if(!mainColor&&!pointColor)return undefined;
  return {
    mainColor,pointColor,
    mainBasis:preferred.mainColor?preferred.mainBasis||'':fallback.mainBasis||'',
    pointBasis:preferred.pointColor?preferred.pointBasis||'':fallback.pointBasis||'',
    source:preferred.source===fallback.source?preferred.source:'mixed',
  };
}
