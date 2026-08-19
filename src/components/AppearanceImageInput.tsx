'use client';

import { useCallback, useEffect, useId, useState } from 'react';

type AppearanceImagePayload = {
  name: string;
  dataUrl: string;
};

const MAX_IMAGES = 4;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 700_000;
const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp']);
const CLEAR_EVENT = 'chara-appearance-clear';
const STORAGE_KEY = 'chara_appearance_images_v1';

let currentImages: AppearanceImagePayload[] = [];

function readStoredImages() {
  if (currentImages.length) return currentImages.map(image=>({...image}));
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const restored = parsed
      .filter((item): item is AppearanceImagePayload => !!item && typeof item === 'object' && typeof (item as AppearanceImagePayload).name === 'string' && typeof (item as AppearanceImagePayload).dataUrl === 'string' && (item as AppearanceImagePayload).dataUrl.startsWith('data:image/'))
      .slice(0,MAX_IMAGES)
      .map(image=>({...image}));
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
  return currentImages.map(image=>({...image}));
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

async function compressImage(file:File):Promise<AppearanceImagePayload>{
  if(!ALLOWED_TYPES.has(file.type))throw new Error('JPG, PNG, WEBP 이미지만 첨부할 수 있어요.');
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
  return {name:file.name||'appearance.jpg',dataUrl};
}

export function AppearanceImageInput({disabled=false}:{disabled?:boolean}){
  const inputId=useId();
  const [images,setImages]=useState<AppearanceImagePayload[]>(()=>readStoredImages());
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const blocked=disabled||busy||images.length>=MAX_IMAGES;

  useEffect(()=>{
    const clear=()=>{setImages([]);setError('')};
    window.addEventListener(CLEAR_EVENT,clear);
    return()=>window.removeEventListener(CLEAR_EVENT,clear);
  },[]);

  const commit=useCallback((next:AppearanceImagePayload[])=>{
    const normalized=next.slice(0,MAX_IMAGES).map(image=>({...image}));
    storeImages(normalized);
    setImages(normalized);
  },[]);

  const addFiles=useCallback(async(files:FileList|File[]|null)=>{
    const incoming=files?Array.from(files):[];
    if(!incoming.length||disabled||busy)return;
    setError('');
    const available=MAX_IMAGES-images.length;
    if(available<=0){setError(`외관 자료는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);return}
    const selected=incoming.slice(0,available);
    if(incoming.length>available)setError(`외관 자료는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);
    setBusy(true);
    try{
      const converted:AppearanceImagePayload[]=[];
      for(const file of selected)converted.push(await compressImage(file));
      commit([...images,...converted]);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
    finally{setBusy(false)}
  },[busy,commit,disabled,images]);

  useEffect(()=>{
    const paste=(event:ClipboardEvent)=>{
      if(disabled||busy||images.length>=MAX_IMAGES)return;
      const clipboard=event.clipboardData;
      if(!clipboard)return;
      const pastedFiles=Array.from(clipboard.items)
        .filter(item=>item.kind==='file'&&ALLOWED_TYPES.has(item.type))
        .map(item=>item.getAsFile())
        .filter((file):file is File=>!!file);
      if(!pastedFiles.length)return;
      event.preventDefault();
      void addFiles(pastedFiles);
    };
    window.addEventListener('paste',paste);
    return()=>window.removeEventListener('paste',paste);
  },[addFiles,busy,disabled,images.length]);

  function removeAt(index:number){commit(images.filter((_,i)=>i!==index))}

  return <div className="field">
    <label className="label" htmlFor={inputId}>외관 자료 <span className="muted">(선택)</span></label>
    <div>
      <label className="btn soft" htmlFor={inputId} aria-disabled={blocked} style={{display:'inline-flex',alignItems:'center',gap:8,opacity:blocked?.45:1,pointerEvents:blocked?'none':'auto'}}>
        {busy?'이미지 준비 중…':`이미지 첨부 ${images.length}/${MAX_IMAGES}`}
      </label>
      <input id={inputId} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" disabled={blocked} onChange={e=>{void addFiles(e.target.files);e.currentTarget.value=''}}/>
      <span className="muted" style={{display:'inline-block',marginLeft:12,fontSize:13}}>또는 이미지 복사 후 Ctrl+V</span>
    </div>
    {images.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(108px,1fr))',gap:10,maxWidth:520}}>{images.map((image,index)=><div key={`${image.name}-${index}`} style={{position:'relative',aspectRatio:'1 / 1',border:'1px solid var(--line)',borderRadius:14,overflow:'hidden',background:'white'}}>
      <img src={image.dataUrl} alt={`외관 자료 ${index+1}`} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
      <button type="button" aria-label={`${index+1}번째 이미지 삭제`} disabled={disabled||busy} onClick={()=>removeAt(index)} style={{position:'absolute',top:6,right:6,width:28,height:28,borderRadius:999,border:'1px solid rgba(0,0,0,.2)',background:'rgba(255,255,255,.92)',fontWeight:900,fontSize:18,lineHeight:1}}>×</button>
    </div>)}</div>}
    {error&&<p className="error" style={{margin:0}}>{error}</p>}
  </div>;
}
