'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

type AppearanceImagePayload = {
  name: string;
  dataUrl: string;
  origin?: 'manual' | 'document';
  sourceUrl?: string;
  sourceIndex?: number;
  sourceKey?: string;
};

type DiscoveredSource={
  url:string;
  kind:'google_docs'|'postype'|'notion';
  images:{index:number;name:string;key?:string}[];
};

type DiscoveryFailure={url:string;code:string};

const MAX_IMAGES = 4;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 700_000;
const MANUAL_TYPES = new Set(['image/jpeg','image/png','image/webp']);
const REMOTE_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif']);
const CLEAR_EVENT = 'chara-appearance-clear';
const STORAGE_KEY = 'chara_appearance_images_v1';
const DOCUMENT_RETRY_BASE_MS = 4_000;
const MAX_DOCUMENT_RETRIES = 2;

let currentImages: AppearanceImagePayload[] = [];

function normalizeStoredImage(item:unknown):AppearanceImagePayload|null{
  if(!item||typeof item!=='object')return null;
  const raw=item as AppearanceImagePayload;
  if(typeof raw.name!=='string'||typeof raw.dataUrl!=='string'||!raw.dataUrl.startsWith('data:image/'))return null;
  const origin=raw.origin==='document'?'document':'manual';
  return {
    name:raw.name,
    dataUrl:raw.dataUrl,
    origin,
    ...(origin==='document'&&typeof raw.sourceUrl==='string'?{sourceUrl:raw.sourceUrl}:{}),
    ...(origin==='document'&&Number.isInteger(raw.sourceIndex)?{sourceIndex:raw.sourceIndex}:{}),
    ...(origin==='document'&&typeof raw.sourceKey==='string'?{sourceKey:raw.sourceKey}:{}),
  };
}

function readStoredImages() {
  if (currentImages.length) return currentImages.map(image=>({...image}));
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const restored = parsed.map(normalizeStoredImage).filter((item):item is AppearanceImagePayload=>!!item).slice(0,MAX_IMAGES);
    currentImages = restored;
    return restored.map(image=>({...image}));
  } catch {
    return [];
  }
}

function storeImages(images: AppearanceImagePayload[]) {
  currentImages = images.map(image=>({...image}));
  if (typeof window === 'undefined') return;
  try {
    if (images.length) sessionStorage.setItem(STORAGE_KEY,JSON.stringify(images));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage is best-effort. The in-memory copy still preserves images
    // while moving between the profile, inference review and interview screens.
  }
}

export function getAppearanceImagesForRequest() {
  if (!currentImages.length) readStoredImages();
  // origin/source metadata is UI-only; the appearance analysis API receives the
  // same compact payload it has always accepted.
  return currentImages.map(image=>({name:image.name,dataUrl:image.dataUrl}));
}

export function clearAppearanceImages() {
  storeImages([]);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLEAR_EVENT));
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(String(reader.result||''));
    reader.onerror = ()=>reject(new Error('이미지를 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
}

function imageFromDataUrl(dataUrl:string) {
  return new Promise<HTMLImageElement>((resolve,reject)=>{
    const image = new Image();
    image.onload = ()=>resolve(image);
    image.onerror = ()=>reject(new Error('이미지 형식을 읽지 못했어요.'));
    image.src = dataUrl;
  });
}

async function compressImage(file:File,allowRemoteTypes=false):Promise<AppearanceImagePayload>{
  const allowed=allowRemoteTypes?REMOTE_TYPES:MANUAL_TYPES;
  if(!allowed.has(file.type))throw new Error('JPG, PNG, WEBP 이미지만 첨부할 수 있어요.');
  if(file.size>MAX_SOURCE_BYTES)throw new Error('이미지 한 장은 10MB 이하로 올려주세요.');

  const source=await fileAsDataUrl(file);
  const image=await imageFromDataUrl(source);
  const maxSide=1200;
  const ratio=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight));
  const width=Math.max(1,Math.round(image.naturalWidth*ratio));
  const height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('이미지를 처리하지 못했어요.');
  context.fillStyle='#fffdf8';
  context.fillRect(0,0,width,height);
  context.drawImage(image,0,0,width,height);

  let quality=.82;
  let dataUrl=canvas.toDataURL('image/jpeg',quality);
  while(dataUrl.length>MAX_DATA_URL_CHARS&&quality>.5){
    quality-=.08;
    dataUrl=canvas.toDataURL('image/jpeg',quality);
  }
  if(dataUrl.length>MAX_DATA_URL_CHARS)throw new Error('이미지 용량을 줄인 뒤 다시 첨부해주세요.');
  return {name:file.name||'appearance.jpg',dataUrl,origin:'manual'};
}

function supportedDocumentLink(value:string){
  const trimmed=value.trim();
  if(!/^https?:\/\/\S+$/iu.test(trimmed))return'';
  try{
    const url=new URL(trimmed);
    const host=url.hostname.toLowerCase();
    const sub=(domain:string)=>host===domain||host.endsWith(`.${domain}`);
    if(host==='docs.google.com'&&/^\/document\/d\/[a-zA-Z0-9_-]+/u.test(url.pathname))return url.toString();
    if(sub('postype.com'))return url.toString();
    if(sub('notion.so')||sub('notion.site')||host==='app.notion.com')return url.toString();
  }catch{}
  return'';
}

function documentLinksOnPage(){
  if(typeof document==='undefined')return[];
  const values=[...document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('textarea,input[type="text"],input[type="url"]')]
    .map(field=>supportedDocumentLink(field.value))
    .filter(Boolean);
  return [...new Set(values)].slice(0,2);
}

function remoteImageUrl(sourceUrl:string,index:number,key?:string){
  const params=new URLSearchParams({url:sourceUrl,index:String(index)});
  if(key)params.set('key',key);
  return `/api/characters/profile-images?${params.toString()}`;
}

function sameDocumentImage(image:AppearanceImagePayload,sourceUrl:string,item:{index:number;key?:string}){
  if(image.origin!=='document'||image.sourceUrl!==sourceUrl)return false;
  if(item.key)return image.sourceKey===item.key||(!image.sourceKey&&image.sourceIndex===item.index);
  return image.sourceIndex===item.index;
}

export function AppearanceImageInput({disabled=false}:{disabled?:boolean}){
  const inputId=useId();
  const [images,setImages]=useState<AppearanceImagePayload[]>(()=>readStoredImages());
  const imagesRef=useRef<AppearanceImagePayload[]>(images);
  const loadedDocumentSources=useRef(new Set<string>());
  const lastDocumentSignature=useRef('');
  const documentGeneration=useRef(0);
  const documentRetryAt=useRef(0);
  const documentRetryCount=useRef(0);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [documentBusy,setDocumentBusy]=useState(false);
  const [documentStatus,setDocumentStatus]=useState('');
  const manualCount=images.filter(image=>image.origin!=='document').length;
  // A full set of auto images must not block a user from choosing their own image.
  // Manual images always win and push document images out of the last slots.
  const blocked=disabled||busy||manualCount>=MAX_IMAGES;

  useEffect(()=>{
    const clear=()=>{
      imagesRef.current=[];
      loadedDocumentSources.current.clear();
      lastDocumentSignature.current='';
      documentGeneration.current+=1;
      documentRetryAt.current=0;
      documentRetryCount.current=0;
      setImages([]);setError('');setDocumentStatus('');setDocumentBusy(false);
    };
    window.addEventListener(CLEAR_EVENT,clear);
    return()=>window.removeEventListener(CLEAR_EVENT,clear);
  },[]);

  const commit=useCallback((next:AppearanceImagePayload[])=>{
    const normalized=next.slice(0,MAX_IMAGES).map(image=>({...image}));
    imagesRef.current=normalized;
    storeImages(normalized);
    setImages(normalized);
  },[]);

  const addFiles=useCallback(async(files:FileList|File[]|null)=>{
    const incoming=files?Array.from(files):[];
    if(!incoming.length||disabled||busy)return;
    setError('');
    const current=imagesRef.current;
    const manuals=current.filter(image=>image.origin!=='document');
    const automatic=current.filter(image=>image.origin==='document');
    const available=MAX_IMAGES-manuals.length;
    if(available<=0){setError(`외관 자료는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);return}
    const selected=incoming.slice(0,available);
    if(incoming.length>available)setError(`외관 자료는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);
    setBusy(true);
    try{
      const converted:AppearanceImagePayload[]=[];
      for(const file of selected)converted.push(await compressImage(file));
      commit([...manuals,...converted,...automatic].slice(0,MAX_IMAGES));
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
    finally{setBusy(false)}
  },[busy,commit,disabled]);

  useEffect(()=>{
    const paste=(event:ClipboardEvent)=>{
      const current=imagesRef.current;
      const manuals=current.filter(image=>image.origin!=='document');
      if(disabled||busy||manuals.length>=MAX_IMAGES)return;
      const clipboard=event.clipboardData;
      if(!clipboard)return;
      const pastedFiles=Array.from(clipboard.items)
        .filter(item=>item.kind==='file'&&MANUAL_TYPES.has(item.type))
        .map(item=>item.getAsFile())
        .filter((file):file is File=>!!file);
      if(!pastedFiles.length)return;
      event.preventDefault();
      void addFiles(pastedFiles);
    };
    window.addEventListener('paste',paste);
    return()=>window.removeEventListener('paste',paste);
  },[addFiles,busy,disabled]);

  useEffect(()=>{
    let timer=0;
    let disposed=false;

    const sync=async()=>{
      if(disposed||disabled)return;
      const links=documentLinksOnPage();
      const signature=links.join('\n');
      const signatureChanged=signature!==lastDocumentSignature.current;
      if(!signatureChanged&&(!documentRetryAt.current||Date.now()<documentRetryAt.current))return;
      if(signatureChanged){
        lastDocumentSignature.current=signature;
        documentRetryAt.current=0;
        documentRetryCount.current=0;
      }else{
        documentRetryAt.current=0;
      }
      const generation=++documentGeneration.current;

      for(const source of [...loadedDocumentSources.current]){
        if(!links.includes(source))loadedDocumentSources.current.delete(source);
      }

      const retained=imagesRef.current.filter(image=>image.origin!=='document'||(image.sourceUrl&&links.includes(image.sourceUrl)));
      if(retained.length!==imagesRef.current.length)commit(retained);

      if(!links.length){setDocumentStatus('');setDocumentBusy(false);return}
      const pending=links.filter(link=>!loadedDocumentSources.current.has(link));
      if(!pending.length)return;

      setDocumentBusy(true);
      setDocumentStatus('문서 이미지 불러오는 중…');
      try{
        const response=await fetch('/api/characters/profile-images',{
          method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:pending}),
        });
        const body=await response.json().catch(()=>({}));
        if(disposed||generation!==documentGeneration.current)return;
        if(!response.ok)throw new Error(typeof body?.error==='string'?body.error:'PROFILE_IMAGE_DISCOVERY_FAILED');
        const sources=Array.isArray(body?.sources)?body.sources as DiscoveredSource[]:[];
        const failures=Array.isArray(body?.failures)?body.failures as DiscoveryFailure[]:[];
        const failedUrls=new Set(failures.map(failure=>failure.url));
        let retryNeeded=failedUrls.size>0;
        for(const source of sources){
          if(!links.includes(source.url))continue;
          let sourceFailed=false;
          for(const item of Array.isArray(source.images)?source.images:[]){
            if(disposed||generation!==documentGeneration.current)return;
            const current=imagesRef.current;
            if(current.length>=MAX_IMAGES)break;
            if(current.some(image=>sameDocumentImage(image,source.url,item)))continue;
            try{
              const imageResponse=await fetch(remoteImageUrl(source.url,item.index,item.key),{cache:'no-store'});
              if(!imageResponse.ok){sourceFailed=true;continue}
              const blob=await imageResponse.blob();
              if(!REMOTE_TYPES.has(blob.type)){sourceFailed=true;continue}
              const file=new File([blob],item.name||`document-image-${item.index+1}`,{type:blob.type});
              const converted=await compressImage(file,true);
              if(disposed||generation!==documentGeneration.current)return;
              const latest=imagesRef.current;
              if(latest.length>=MAX_IMAGES)break;
              if(latest.some(image=>sameDocumentImage(image,source.url,item)))continue;
              commit([...latest,{...converted,origin:'document',sourceUrl:source.url,sourceIndex:item.index,...(item.key?{sourceKey:item.key}:{})}]);
            }catch{sourceFailed=true}
          }
          if(sourceFailed)retryNeeded=true;
          else loadedDocumentSources.current.add(source.url);
          if(imagesRef.current.length>=MAX_IMAGES)break;
        }
        for(const link of pending){
          if(!sources.some(source=>source.url===link)&&!failedUrls.has(link))retryNeeded=true;
        }
        const documentImageCount=imagesRef.current.filter(image=>image.origin==='document').length;
        if(retryNeeded&&documentRetryCount.current<MAX_DOCUMENT_RETRIES){
          documentRetryCount.current+=1;
          documentRetryAt.current=Date.now()+DOCUMENT_RETRY_BASE_MS*2**(documentRetryCount.current-1);
          setDocumentStatus(documentImageCount?`문서 이미지 ${documentImageCount}장 추가됨 · 나머지 다시 시도 중…`:'문서 이미지 불러오기를 잠시 후 다시 시도해요.');
        }else{
          documentRetryAt.current=0;
          documentRetryCount.current=0;
          setDocumentStatus(documentImageCount?`문서 이미지 ${documentImageCount}장 자동 추가됨`:'문서에서 첨부할 이미지를 찾지 못했어요.');
        }
      }catch{
        if(!disposed&&generation===documentGeneration.current){
          if(documentRetryCount.current<MAX_DOCUMENT_RETRIES){
            documentRetryCount.current+=1;
            documentRetryAt.current=Date.now()+DOCUMENT_RETRY_BASE_MS*2**(documentRetryCount.current-1);
            setDocumentStatus('문서 이미지 불러오기를 잠시 후 다시 시도해요.');
          }else{
            documentRetryAt.current=0;
            documentRetryCount.current=0;
            setDocumentStatus('문서 이미지를 자동으로 불러오지 못했어요. 직접 첨부할 수 있어요.');
          }
        }
      }finally{
        if(!disposed&&generation===documentGeneration.current)setDocumentBusy(false);
      }
    };

    const schedule=()=>{
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>{void sync()},520);
    };
    schedule();
    document.addEventListener('input',schedule,true);
    document.addEventListener('change',schedule,true);
    const interval=window.setInterval(schedule,900);
    return()=>{
      disposed=true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('input',schedule,true);
      document.removeEventListener('change',schedule,true);
      documentGeneration.current+=1;
    };
  },[commit,disabled]);

  function removeAt(index:number){commit(imagesRef.current.filter((_,i)=>i!==index))}

  return <div className="field">
    <label className="label" htmlFor={inputId}>외관 자료 <span className="muted">(선택)</span></label>
    <div>
      <label className="btn soft" htmlFor={inputId} aria-disabled={blocked} style={{display:'inline-flex',alignItems:'center',gap:8,opacity:blocked?.45:1,pointerEvents:blocked?'none':'auto'}}>
        {busy?'이미지 준비 중…':`이미지 첨부 ${images.length}/${MAX_IMAGES}`}
      </label>
      <input id={inputId} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" disabled={blocked} onChange={e=>{void addFiles(e.target.files);e.currentTarget.value=''}}/>
      <span className="muted" style={{display:'inline-block',marginLeft:12,fontSize:13}}>또는 이미지 복사 후 Ctrl+V</span>
    </div>
    {(documentBusy||documentStatus)&&<div className="muted" style={{fontSize:12,lineHeight:1.5,marginTop:8}}>{documentBusy?'문서 이미지 불러오는 중…':documentStatus}</div>}
    {images.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(108px,1fr))',gap:10,maxWidth:520}}>{images.map((image,index)=><div key={`${image.name}-${image.sourceUrl||'manual'}-${image.sourceKey??image.sourceIndex??index}`} style={{position:'relative',aspectRatio:'1 / 1',border:'1px solid var(--line)',borderRadius:14,overflow:'hidden',background:'white'}}>
      <img src={image.dataUrl} alt={`외관 자료 ${index+1}`} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
      {image.origin==='document'&&<span style={{position:'absolute',left:6,bottom:6,padding:'3px 6px',borderRadius:999,background:'rgba(23,24,22,.72)',color:'#fff',fontSize:9,fontWeight:800,lineHeight:1}}>문서</span>}
      <button type="button" aria-label={`${index+1}번째 이미지 삭제`} disabled={disabled||busy} onClick={()=>removeAt(index)} style={{position:'absolute',top:6,right:6,width:28,height:28,borderRadius:999,border:'1px solid rgba(0,0,0,.2)',background:'rgba(255,255,255,.92)',fontWeight:900,fontSize:18,lineHeight:1}}>×</button>
    </div>)}</div>}
    {error&&<p className="error" style={{margin:0}}>{error}</p>}
  </div>;
}
