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

function surfaceColor(raw:string,lightness:number){
  const hsl=hexToHsl(raw);
  const saturation=hsl.s<6?0:clamp(hsl.s*.34,8,28);
  return hslToHex({h:hsl.h,s:saturation,l:lightness});
}

function accentColor(raw:string){
  const hsl=hexToHsl(raw);
  const saturation=hsl.s<6?0:clamp(hsl.s,28,66);
  // Very bright/yellow accents are toned down so SVGs and small UI marks stay visible.
  const lightness=hsl.s<6?36:clamp(hsl.l,34,52);
  return hslToHex({h:hsl.h,s:saturation,l:lightness});
}

function accentSoftColor(raw:string){
  const hsl=hexToHsl(raw);
  const saturation=hsl.s<6?0:clamp(hsl.s*.56,12,42);
  return hslToHex({h:hsl.h,s:saturation,l:91});
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
  return themePaletteSchema.parse({
    main:surfaceColor(mainBase,92),
    mainSub:surfaceColor(mainBase,97),
    point:accentColor(pointBase),
    pointSub:accentSoftColor(pointBase),
    source,
    confidence:clamp(Math.round(Number.isFinite(confidence)?confidence:65),0,100),
  });
}
