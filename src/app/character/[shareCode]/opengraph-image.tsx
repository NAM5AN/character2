import { ImageResponse } from 'next/og';
import { getSupabaseServer } from '@/lib/supabase/server';
import { normalizeShareCode, isShareCode } from '@/lib/share-code';
import { characterReportPreviewSchema, type CharacterReportPreview } from '@/lib/character-report';

export const runtime='nodejs';
export const alt='CHA LAB 캐릭터 정밀 해석';
export const size={width:1200,height:630};
export const contentType='image/png';

async function loadPreview(rawCode:string):Promise<CharacterReportPreview|null>{
  const code=normalizeShareCode(rawCode);
  if(!isShareCode(code))return null;
  const supabase=getSupabaseServer();
  const {data,error}=await supabase.rpc('character2_get_public_preview',{p_share_code:code});
  if(error||!data)return null;
  const parsed=characterReportPreviewSchema.safeParse(data);
  return parsed.success?parsed.data:null;
}

function topicParticle(name:string){
  const clean=name.trim();
  if(!clean)return '는';
  const code=clean.charCodeAt(clean.length-1);
  if(code<0xAC00||code>0xD7A3)return '는';
  return (code-0xAC00)%28===0?'는':'은';
}

function compactSummary(value:string,max=180){
  const normalized=value.replace(/\s+/gu,' ').trim();
  if(normalized.length<=max)return normalized;
  return `${normalized.slice(0,max-1).trimEnd()}…`;
}

export default async function Image({params}:{params:Promise<{shareCode:string}>}){
  const {shareCode}=await params;
  const preview=await loadPreview(shareCode);

  const name=preview?.name?.trim()||'캐릭터';
  const particle=topicParticle(name);
  const summary=compactSummary(preview?.oneLineSummary||'나도 몰랐던 내 캐릭터의 심리');
  const main=preview?.themePalette?.main||'#F2F1EF';
  const point=preview?.themePalette?.point||'#5C82AD';
  const pointSub=preview?.themePalette?.pointSub||point;

  return new ImageResponse(
    <div
      style={{
        width:'100%',
        height:'100%',
        display:'flex',
        flexDirection:'column',
        justifyContent:'center',
        alignItems:'flex-start',
        padding:'72px 84px',
        background:main,
        color:'#171816',
        fontFamily:'sans-serif',
      }}
    >
      <div
        style={{
          display:'flex',
          color:point,
          fontSize:31,
          fontWeight:800,
          letterSpacing:'0.11em',
          lineHeight:1,
          marginBottom:36,
        }}
      >
        CHA LAB
      </div>

      <div
        style={{
          display:'flex',
          flexWrap:'wrap',
          alignItems:'baseline',
          maxWidth:1040,
          fontSize:78,
          fontWeight:900,
          lineHeight:1.08,
          letterSpacing:'-0.04em',
          marginBottom:38,
        }}
      >
        <span
          style={{
            display:'flex',
            lineHeight:1.08,
            borderBottom:`9px solid ${pointSub}`,
            paddingBottom:3,
            marginRight:0,
          }}
        >
          {name}
        </span>
        <span style={{display:'flex',lineHeight:1.08}}>{particle} 왜 이럴까요?</span>
      </div>

      <div
        style={{
          display:'flex',
          maxWidth:1030,
          fontSize:36,
          fontWeight:600,
          lineHeight:1.48,
          letterSpacing:'-0.022em',
          color:'#3B3C39',
        }}
      >
        {summary}
      </div>
    </div>,
    size,
  );
}
