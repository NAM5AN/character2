import { z } from 'zod';

const HEX_RE=/^#[0-9a-f]{6}$/i;
export const themeSourceSchema=z.enum(['image','text','mixed']);
export const themePaletteSchema=z.object({
  main:z.string().regex(HEX_RE),
  mainSub:z.string().regex(HEX_RE),
  point:z.string().regex(HEX_RE),
  pointSub:z.string().regex(HEX_RE),
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

export function deriveThemePalette(
  mainCandidate:unknown,
  pointCandidate:unknown,
  source:ThemeSource,
  confidence=65,
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
  return themePaletteSchema.parse({
    main:surfaceColor(mainBase,surface.main),
    mainSub:surfaceColor(mainBase,surface.mainSub),
    point:accentColor(pointBase,strongSeparation),
    pointSub:accentSoftColor(pointBase,strongSeparation),
    source,
    confidence:clamp(Math.round(Number.isFinite(confidence)?confidence:65),0,100),
  });
}
