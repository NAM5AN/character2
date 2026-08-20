'use client';

import { createClient } from '@supabase/supabase-js';
import { useMemo, useRef, useState } from 'react';

const SUPABASE_URL='https://kfgtvifupumjuewwxzmz.supabase.co';
const SUPABASE_KEY='sb_publishable_KROAv1c1eX3wlEt8Mog8OQ_jNTMJzoM';
const BUCKET='character2-feedback';
const MAX_FILES=4;
const MAX_FILE_SIZE=30*1024*1024;

type Category='bug'|'error'|'improvement';
type UploadedAttachment={path:string;name:string;type:string;size:number};

function detectEnvironment(deploymentVersion:string){
  const ua=navigator.userAgent||'';
  const lower=ua.toLowerCase();
  const os=/android/i.test(ua)?'Android':/iphone|ipad|ipod/i.test(ua)?'iOS':/windows/i.test(ua)?'Windows':/mac os x|macintosh/i.test(ua)?'macOS':/linux/i.test(ua)?'Linux':'기타';
  const browser=/edg\//i.test(ua)?'Edge':/samsungbrowser/i.test(ua)?'Samsung Internet':/firefox|fxios/i.test(ua)?'Firefox':/crios/i.test(ua)?'Chrome iOS':/chrome/i.test(ua)?'Chrome':/safari/i.test(ua)?'Safari':'기타';
  const deviceType=/ipad|tablet/i.test(ua)||(lower.includes('android')&&!lower.includes('mobile'))?'태블릿':/mobile|iphone|ipod|android/i.test(ua)?'모바일':'PC';
  return {
    deviceType,os,browser,userAgent:ua,platform:navigator.platform||'',
    viewport:`${window.innerWidth}×${window.innerHeight}`,
    screen:`${window.screen.width}×${window.screen.height}`,
    pixelRatio:window.devicePixelRatio||1,
    language:navigator.language||'',
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',
    url:window.location.href,
    deploymentVersion,
  };
}

function extensionFor(file:File){
  const byType:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
  if(byType[file.type])return byType[file.type];
  const ext=file.name.split('.').pop()?.replace(/[^a-z0-9]/gi,'').toLowerCase();
  return ext||'bin';
}

export function FeedbackReporter({deploymentVersion}:{deploymentVersion:string}){
  const [open,setOpen]=useState(false);
  const [category,setCategory]=useState<Category>('bug');
  const [content,setContent]=useState('');
  const [files,setFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const inputRef=useRef<HTMLInputElement|null>(null);
  const supabase=useMemo(()=>createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),[]);

  function addFiles(list:FileList|null){
    if(!list)return;
    setMessage('');
    const next=[...files];
    for(const file of Array.from(list)){
      if(next.length>=MAX_FILES)break;
      if(!/^(image|video)\//i.test(file.type)){setMessage('이미지 또는 영상 파일만 첨부할 수 있어요.');continue;}
      if(file.size>MAX_FILE_SIZE){setMessage('파일 한 개당 최대 30MB까지 첨부할 수 있어요.');continue;}
      next.push(file);
    }
    setFiles(next.slice(0,MAX_FILES));
    if(inputRef.current)inputRef.current.value='';
  }

  async function submit(){
    if(content.trim().length<5){setMessage('제보 내용을 조금 더 적어주세요.');return;}
    setBusy(true);setMessage('');
    try{
      const id=crypto.randomUUID();
      const attachments:UploadedAttachment[]=[];
      for(const file of files){
        const path=`${id}/${crypto.randomUUID()}.${extensionFor(file)}`;
        const {error}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
        if(error)throw new Error(`ATTACHMENT_UPLOAD_FAILED: ${error.message}`);
        attachments.push({path,name:file.name,type:file.type,size:file.size});
      }
      const res=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        id,category,content:content.trim(),environment:detectEnvironment(deploymentVersion),attachments,
      })});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body?.error||'FEEDBACK_SAVE_FAILED');
      setContent('');setFiles([]);setCategory('bug');setMessage('제보가 전달됐어요. 고마워요.');
    }catch(error){
      setMessage(error instanceof Error?`전송하지 못했어요. ${error.message}`:'전송하지 못했어요.');
    }finally{setBusy(false)}
  }

  return <>
    <button type="button" className="footer-feedback-btn" onClick={()=>{setOpen(true);setMessage('')}}>버그·오류·개선안 제보하기</button>
    {open&&<div className="modal-backdrop feedback-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false)}}>
      <div className="modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <div className="feedback-modal-head"><div><div className="eyebrow">Feedback</div><h3 id="feedback-title">버그·오류·개선안 제보</h3></div><button className="feedback-close" type="button" disabled={busy} onClick={()=>setOpen(false)} aria-label="닫기">×</button></div>
        <div className="feedback-categories">
          {([['bug','버그'],['error','오류'],['improvement','개선안']] as [Category,string][]).map(([key,label])=><button key={key} type="button" disabled={busy} className={`pill ${category===key?'active':''}`} onClick={()=>setCategory(key)}>{label}</button>)}
        </div>
        <div className="field"><label className="label">내용</label><textarea className="input feedback-textarea" disabled={busy} maxLength={5000} value={content} onChange={e=>setContent(e.target.value)} placeholder="어떤 문제가 있었는지, 또는 어떻게 바뀌면 좋을지 적어주세요." /></div>
        <div className="field"><label className="label">이미지·영상 첨부 <span className="muted">({files.length}/{MAX_FILES})</span></label><input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={e=>addFiles(e.target.files)} /><button type="button" className="btn" disabled={busy||files.length>=MAX_FILES} onClick={()=>inputRef.current?.click()}>파일 선택</button></div>
        {files.length>0&&<div className="feedback-files">{files.map((file,index)=><div className="feedback-file" key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><small>{(file.size/1024/1024).toFixed(1)}MB</small><button type="button" disabled={busy} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}>삭제</button></div>)}</div>}
        <p className="muted feedback-env-note">기기 종류, 운영체제, 브라우저, 화면 크기, 현재 페이지와 배포 버전이 자동으로 함께 전달돼요.</p>
        {message&&<p className={message.startsWith('제보가')?'feedback-success':'error'}>{message}</p>}
        <div className="actions feedback-actions"><button className="btn" type="button" disabled={busy} onClick={()=>setOpen(false)}>닫기</button><button className="btn primary" type="button" disabled={busy||content.trim().length<5} onClick={()=>void submit()}>{busy?'전송 중…':'관리자에게 전달'}</button></div>
      </div>
    </div>}
  </>;
}
