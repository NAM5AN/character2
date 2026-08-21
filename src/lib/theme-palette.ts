import { z } from 'zod';

const HEX_RE=/^#[0-9a-f]{6}$/i;
export const themeSourceSchema=z.enum(['image','text','mixed']);
export const themePaletteSchema=z.object({
  main:z.string().regex(HEX_RE),
  mainSub:z.string().regex(HEX_RE),
  point:z.string().regex(HEX_RE),
  pointSub:z.string().regex(HEX_RE),
  // 투톤 머리·오드아이처럼 캐릭터가 색을 더 가진 경우의 두 번째 포인트색.
  // 예전에 저장된 팔레트에는 없으므로 optional.
  // accent 배경 위에 올릴 전경색. 색조는 accent 와 같고 명도만 낮춘 값이라
  // 흰 글씨로 대체하지 않고도 대비를 확보한다. 예전 팔레트에는 없으므로 optional.
  pointInk:z.string().regex(HEX_RE).optional(),
  alt:z.string().regex(HEX_RE).optional(),
  altSub:z.string().regex(HEX_RE).optional(),
  source:themeSourceSchema,
  confidence:z.number().min(0).max(100),
});

export type CharacterThemePalette=z.infer<typeof themePaletteSchema>;
export type ThemeSource=z.infer<typeof themeSourceSchema>;

type Hsl={h:number;s:number;l:number};

function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value))}

export function normalizeHexColor(value:unknown){
  if(typeof value!=='string')return undefined;
  let text=value.trim();
  if(/^[0-9a-f]{6}$/i.test(text))text=`#${text}`;
  if(!HEX_RE.test(text))return undefined;
  return text.toUpperCase();
}

function hexToHsl(hex:string):Hsl{
  const n=parseInt(hex.slice(1),16);
  const r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d){
    if(max===r)h=((g-b)/d)%6;
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;if(h<0)h+=360;
  }
  const l=(max+min)/2;
  const s=d===0?0:d/(1-Math.abs(2*l-1));
  return {h,s:s*100,l:l*100};
}

function hslToHex({h,s,l}:Hsl){
  s/=100;l/=100;
  const c=(1-Math.abs(2*l-1))*s;
  const x=c*(1-Math.abs((h/60)%2-1));
  const m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
  const part=(v:number)=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function hueDistance(a:number,b:number){
  const diff=Math.abs(a-b)%360;
  return Math.min(diff,360-diff);
}

function isNeutral(hsl:Hsl){return hsl.s<12}
function isVeryLight(hsl:Hsl){return hsl.l>=82}
function isVeryDark(hsl:Hsl){return hsl.l<=22}
function isYellow(hsl:Hsl){return hsl.h>=42&&hsl.h<=76&&hsl.s>=36}
function isNeon(hsl:Hsl){return hsl.s>=82&&hsl.l>=46}
function isExtreme(hsl:Hsl){return isNeutral(hsl)||isYellow(hsl)||isNeon(hsl)||isVeryLight(hsl)||isVeryDark(hsl)}

function colorsAreSimilar(a:Hsl,b:Hsl){
  if(isNeutral(a)&&isNeutral(b))return Math.abs(a.l-b.l)<=28;
  if(isVeryLight(a)&&isVeryLight(b)&&a.s<=18&&b.s<=18)return true;
  if(isNeutral(a)!==isNeutral(b))return false;
  return hueDistance(a.h,b.h)<=18&&Math.abs(a.s-b.s)<=52;
}

// 두 색이 화면에서 얼마나 잘 구분되는지의 대략적 점수(클수록 잘 구분됨).
// 오드아이처럼 후보가 여럿일 때 "배경과 가장 잘 구분되는 색"을 고르는 데 쓴다.
export function colorSeparationScore(a:string,b:string){
  const first=normalizeHexColor(a),second=normalizeHexColor(b);
  if(!first||!second)return 0;
  const x=hexToHsl(first),y=hexToHsl(second);
  // 무채색이 끼면 색상환 거리는 의미가 없으므로 명도·채도 차이로만 판단한다.
  const hue=isNeutral(x)||isNeutral(y)?0:hueDistance(x.h,y.h)/180*100;
  return Math.abs(x.l-y.l)+hue*.8+Math.abs(x.s-y.s)*.2;
}

function surfaceSaturation(hsl:Hsl){
  if(isNeutral(hsl))return 0;
  if(isNeon(hsl))return clamp(hsl.s*.22,10,20);
  if(isYellow(hsl))return clamp(hsl.s*.28,10,24);
  return clamp(hsl.s*.34,8,28);
}

function surfaceColor(raw:string,lightness:number){
  const hsl=hexToHsl(raw);
  return hslToHex({h:hsl.h,s:surfaceSaturation(hsl),l:lightness});
}

function accentColor(raw:string,strongSeparation=false){
  const hsl=hexToHsl(raw);
  if(isNeutral(hsl)){
    const lightness=isVeryLight(hsl)?44:isVeryDark(hsl)?30:38;
    return hslToHex({h:hsl.h,s:0,l:strongSeparation?Math.min(lightness,36):lightness});
  }
  const saturation=isNeon(hsl)
    ? clamp(hsl.s*.62,36,58)
    : isYellow(hsl)
      ? clamp(hsl.s*.72,32,58)
      : clamp(hsl.s,28,66);
  let lightness=isYellow(hsl)?40:isNeon(hsl)?42:clamp(hsl.l,34,52);
  if(strongSeparation)lightness=clamp(lightness,32,40);
  return hslToHex({h:hsl.h,s:saturation,l:lightness});
}

function accentSoftColor(raw:string,strongSeparation=false){
  const hsl=hexToHsl(raw);
  if(isNeutral(hsl)){
    return hslToHex({h:hsl.h,s:0,l:strongSeparation?82:isExtreme(hsl)?86:91});
  }
  const saturation=isNeon(hsl)
    ? clamp(hsl.s*.34,18,32)
    : isYellow(hsl)
      ? clamp(hsl.s*.4,18,36)
      : clamp(hsl.s*.56,12,42);
  const lightness=strongSeparation?82:isExtreme(hsl)?87:91;
  return hslToHex({h:hsl.h,s:saturation,l:lightness});
}

function surfaceLightness(raw:Hsl,strongSeparation:boolean){
  if(strongSeparation)return {main:89,mainSub:98};
  if(isNeutral(raw)||isVeryLight(raw)||isVeryDark(raw))return {main:isVeryLight(raw)?90:89,mainSub:98};
  if(isYellow(raw)||isNeon(raw))return {main:90,mainSub:97};
  return {main:92,mainSub:97};
}

// --- 대비 보정 -------------------------------------------------------------
// 캐릭터 색을 쓰되 읽을 수 있어야 한다. 색조(hue)는 절대 바꾸지 않고 명도만 조정해
// "배경 + 같은 색조의 어두운 글자" 조합이 WCAG AA(4.5:1)를 넘도록 만든다.

function relativeLuminance(hsl:Hsl){
  const hex=hslToHex(hsl);const n=parseInt(hex.slice(1),16);
  const parts=[(n>>16)&255,(n>>8)&255,n&255].map(v=>{
    const x=v/255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);
  });
  return 0.2126*parts[0]+0.7152*parts[1]+0.0722*parts[2];
}

export function contrastRatio(a:Hsl,b:Hsl){
  const first=relativeLuminance(a),second=relativeLuminance(b);
  const hi=Math.max(first,second),lo=Math.min(first,second);
  return (hi+0.05)/(lo+0.05);
}

const CONTRAST_TARGET=4.5;

// accent 배경과 그 위 글자색을 함께 정한다. 배경은 필요한 만큼만 밝히고(어둡게는
// 하지 않는다), 글자는 같은 색조에서 충분히 어두운 명도를 찾는다.
function solveAccentPair(accent:string,surface?:string){
  const base=hexToHsl(accent);
  const inkSaturation=Math.min(base.s,62);   // 글자는 너무 쨍하면 읽기 어렵다
  const surfaceHsl=surface?hexToHsl(surface):undefined;
  // accent 는 글자를 받는 배경이자, 진행률 막대·선택 표시 같은 그래픽 자체이기도 하다.
  // 그래픽은 밝은 표면 위에서 3:1 이 필요하므로, 너무 밝아지면 오히려 안 보인다.
  // 그래서 밝히는 방향과 어둡게 하는 방향을 모두 시도하고 둘 다 만족하는 값을 고른다.
  const order:number[]=[];
  const start=Math.round(base.l);
  for(let d=0;d<=60;d+=1){ if(start-d>=12)order.push(start-d); if(d>0&&start+d<=92)order.push(start+d); }
  for(const backgroundL of order){
    const background={h:base.h,s:base.s,l:backgroundL};
    for(let inkL=40;inkL>=8;inkL-=2){
      const ink={h:base.h,s:inkSaturation,l:inkL};
      if(contrastRatio(ink,background)<CONTRAST_TARGET)continue;
      // 표면 대비 3:1 은 그래픽(막대·점·테두리)이 보이기 위한 최소치다.
      if(surfaceHsl&&contrastRatio(background,surfaceHsl)<3)continue;
      return {background:hslToHex(background),ink:hslToHex(ink)};
    }
  }
  // 무채색 등 색조로 해결이 안 되는 극단값은 명도만으로 안전한 짝을 만든다.
  return {background:hslToHex({h:base.h,s:base.s,l:82}),ink:hslToHex({h:base.h,s:inkSaturation,l:12})};
}

export function deriveThemePalette(
  mainCandidate:unknown,
  pointCandidate:unknown,
  source:ThemeSource,
  confidence=65,
  altCandidate?:unknown,
):CharacterThemePalette|undefined{
  const mainRaw=normalizeHexColor(mainCandidate);
  const pointRaw=normalizeHexColor(pointCandidate);
  if(!mainRaw&&!pointRaw)return undefined;
  const mainBase=mainRaw||pointRaw!;
  const pointBase=pointRaw||mainRaw!;
  const mainHsl=hexToHsl(mainBase);
  const pointHsl=hexToHsl(pointBase);
  // Hair/main and eye/point can legitimately share the same hue. Never invent a
  // different hue: separate their UI roles with a clearly visible lightness ladder.
  const strongSeparation=colorsAreSimilar(mainHsl,pointHsl);
  const surface=surfaceLightness(mainHsl,strongSeparation);
  // 세 번째 색은 main·point 어느 쪽과도 구분될 때만 남긴다. 거의 같은 색을 하나 더
  // 들고 있어봐야 화면에서 두 색으로 읽히지 않는다.
  const altRaw=normalizeHexColor(altCandidate);
  const altHsl=altRaw?hexToHsl(altRaw):undefined;
  const point=accentColor(pointBase,strongSeparation);
  const alt=altRaw?accentColor(altRaw,strongSeparation):undefined;
  // 원색이 서로 달라도 UI용으로 보정하면 한 색으로 뭉개질 수 있다(예: 검은색과 회색이
  // 둘 다 같은 명도의 무채색으로 수렴). 보정 후 색까지 비교해야 진짜 두 색이 된다.
  const altUsable=Boolean(
    altRaw&&altHsl&&alt&&alt!==point&&
    !colorsAreSimilar(altHsl,pointHsl)&&
    !colorsAreSimilar(altHsl,mainHsl)&&
    !colorsAreSimilar(hexToHsl(alt),hexToHsl(point)),
  );
  // accent 와 그 위 글자색을 대비가 보장되는 짝으로 확정한다(색조 유지).
  const surfaceForGraphics=surfaceColor(mainBase,surface.mainSub);
  const accentPair=solveAccentPair(point,surfaceForGraphics);
  return themePaletteSchema.parse({
    main:surfaceColor(mainBase,surface.main),
    mainSub:surfaceColor(mainBase,surface.mainSub),
    point:accentPair.background,
    pointInk:accentPair.ink,
    pointSub:accentSoftColor(pointBase,strongSeparation),
    ...(altUsable?{alt,altSub:accentSoftColor(altRaw!,strongSeparation)}:{}),
    source,
    confidence:clamp(Math.round(Number.isFinite(confidence)?confidence:65),0,100),
  });
}
