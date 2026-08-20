'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Attachment={path:string;name:string;type:string;size:number;url:string};
type Feedback={id:string;createdAt:string;category:'bug'|'error'|'improvement';content:string;environment:Record<string,unknown>;attachments:Attachment[];status:'new'|'read'|'resolved';updatedAt:string};
const CATEGORY={bug:'버그',error:'오류',improvement:'개선안'} as const;
const STATUS={new:'새 제보',read:'확인함',resolved:'처리 완료'} as const;

function date(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('ko-KR',{dateStyle:'medium',timeStyle:'short'})}
function envText(value:unknown){if(value==null||value==='')return '—';return String(value)}

export default function AdminFeedbackPage(){
  const [reports,setReports]=useState<Feedback[]|null>(null);
  const [error,setError]=useState('');
  const [status,setStatus]=useState<'loading'|'ready'|'denied'>('loading');
  const [filter,setFilter]=useState<'all'|'new'|'read'|'resolved'>('all');
  const [busy,setBusy]=useState('');

  const load=useCallback(async()=>{try{const r=await fetch('/api/admin/feedback',{cache:'no-store'});const body=await r.json().catch(()=>({}));if(r.status===401){setStatus('denied');return}if(!r.ok)throw new Error(body?.error||'LOAD_FAILED');setReports(Array.isArray(body.reports)?body.reports:[]);setStatus('ready');setError('')}catch(e){setError(e instanceof Error?e.message:'LOAD_FAILED');setStatus('ready')}},[]);
  useEffect(()=>{void load()},[load]);

  async function changeStatus(item:Feedback,next:Feedback['status']){setBusy(item.id);try{const r=await fetch('/api/admin/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:item.id,status:next})});if(r.status===401){setStatus('denied');return}if(!r.ok)throw new Error('UPDATE_FAILED');setReports(current=>(current||[]).map(x=>x.id===item.id?{...x,status:next}:x))}catch{setError('상태를 변경하지 못했어요.')}finally{setBusy('')}}

  const shown=useMemo(()=>filter==='all'?(reports||[]):(reports||[]).filter(x=>x.status===filter),[reports,filter]);
  const newCount=(reports||[]).filter(x=>x.status==='new').length;

  if(status==='loading')return <main className="container page"><p className="muted">제보함을 불러오는 중…</p></main>;
  if(status==='denied')return <main className="container page"><div className="page-head"><div className="eyebrow">Admin</div><h1 style={{fontSize:'clamp(38px,5vw,60px)'}}>관리자 로그인이 필요해요</h1></div><Link className="btn primary" href="/admin">관리자 로그인</Link></main>;

  return <main className="container page">
    <div className="page-head" style={{display:'flex',justifyContent:'space-between',gap:18,alignItems:'flex-start',flexWrap:'wrap'}}><div><div className="eyebrow">Admin feedback</div><h1 style={{fontSize:'clamp(38px,5vw,60px)',margin:'10px 0 12px'}}>사용자 제보함</h1><p style={{margin:0}}>전체 {reports?.length||0}건 · 새 제보 {newCount}건</p></div><div className="actions" style={{marginTop:4}}><Link className="btn" href="/admin/console">캐릭터 관리</Link><button className="btn soft" onClick={()=>void load()}>새로고침</button></div></div>
    {error&&<p className="error">{error}</p>}
    <div className="pills" style={{margin:'0 0 18px'}}>{([['all','전체'],['new','새 제보'],['read','확인함'],['resolved','처리 완료']] as const).map(([key,label])=><button key={key} className={`pill ${filter===key?'active':''}`} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    {shown.length===0?<div className="card"><p className="muted" style={{margin:0}}>해당 제보가 없어요.</p></div>:<div className="feedback-admin-grid">{shown.map(item=>{
      const env=item.environment||{};
      return <article className="feedback-admin-card" key={item.id}>
        <div className="feedback-admin-top"><div className="feedback-admin-meta"><span className="tag">{CATEGORY[item.category]}</span><span className="tag">{STATUS[item.status]}</span><span className="muted" style={{fontSize:12}}>{date(item.createdAt)}</span></div></div>
        <p className="feedback-admin-content">{item.content}</p>
        <div className="feedback-env-grid"><span><b>기기</b>{envText(env.deviceType)}</span><span><b>OS</b>{envText(env.os)}</span><span><b>브라우저</b>{envText(env.browser)}</span><span><b>화면</b>{envText(env.viewport)}</span><span><b>배포</b>{envText(env.deploymentVersion)}</span><span><b>시간대</b>{envText(env.timezone)}</span><span style={{gridColumn:'1 / -1'}}><b>페이지</b>{envText(env.url)}</span><span style={{gridColumn:'1 / -1'}}><b>User Agent</b>{envText(env.userAgent)}</span></div>
        {item.attachments?.length>0&&<div className="feedback-attachments">{item.attachments.map((file,index)=><div className="feedback-attachment" key={`${file.path}-${index}`}>{file.type.startsWith('image/')?<img src={file.url} alt={file.name}/>:<video src={file.url} controls preload="metadata"/>}<a href={file.url} target="_blank" rel="noopener noreferrer">{file.name} · {(Number(file.size||0)/1024/1024).toFixed(1)}MB</a></div>)}</div>}
        <div className="actions" style={{marginTop:16}}><button className="btn" disabled={busy===item.id||item.status==='read'} onClick={()=>void changeStatus(item,'read')}>확인함</button><button className="btn primary" disabled={busy===item.id||item.status==='resolved'} onClick={()=>void changeStatus(item,'resolved')}>처리 완료</button>{item.status!=='new'&&<button className="btn soft" disabled={busy===item.id} onClick={()=>void changeStatus(item,'new')}>새 제보로 되돌리기</button>}</div>
      </article>})}</div>}
  </main>;
}
