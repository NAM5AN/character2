'use client';

import { useEffect, useId, useState } from 'react';

type AppearanceImagePayload = {
  name: string;
  dataUrl: string;
};

const MAX_IMAGES = 4;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 700_000;
const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp']);
const CLEAR_EVENT = 'chara-appearance-clear';

let currentImages: AppearanceImagePayload[] = [];

export function getAppearanceImagesForRequest() {
  return currentImages.map(image=>({...image}));
}

export function clearAppearanceImages() {
  currentImages = [];
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
  const [images,setImages]=useState<AppearanceImagePayload[]>(()=>currentImages);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    const clear=()=>{setImages([]);setError('')};
    window.addEventListener(CLEAR_EVENT,clear);
    return()=>window.removeEventListener(CLEAR_EVENT,clear);
  },[]);

  function commit(next:AppearanceImagePayload[]){currentImages=next;setImages(next)}

  async function addFiles(files:FileList|null){
    if(!files?.length||disabled||busy)return;
    setError('');
    const available=MAX_IMAGES-images.length;
    if(available<=0){setError(`외관 자료는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);return}
    const selected=[...files].slice(0,available);
    if(files.length>available)setError(`외관 자료는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);
    setBusy(true);
    try{
      const converted:AppearanceImagePayload[]=[];
      for(const file of selected)converted.push(await compressImage(file));
      commit([...images,...converted].slice(0,MAX_IMAGES));
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
    finally{setBusy(false)}
  }

  function removeAt(index:number){commit(images.filter((_,i)=>i!==index))}

  return <div className="field appearance-field">
    <label className="label" htmlFor={inputId}>외관 자료 <span className="muted">(선택)</span></label>
    <div>
      <label className={`btn soft ${disabled||busy||images.length>=MAX_IMAGES?'disabled':''}`} htmlFor={inputId} style={{display:'inline-flex',alignItems:'center',gap:8}}>
        {busy?'이미지 준비 중…':`이미지 첨부 ${images.length}/${MAX_IMAGES}`}
      </label>
      <input id={inputId} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" disabled={disabled||busy||images.length>=MAX_IMAGES} onChange={e=>{void addFiles(e.target.files);e.currentTarget.value=''}}/>
    </div>
    {images.length>0&&<div className="appearance-grid">{images.map((image,index)=><div className="appearance-thumb" key={`${image.name}-${index}`}>
      <img src={image.dataUrl} alt={`외관 자료 ${index+1}`}/>
      <button type="button" className="appearance-remove" aria-label={`${index+1}번째 이미지 삭제`} disabled={disabled||busy} onClick={()=>removeAt(index)}>×</button>
    </div>)}</div>}
    {error&&<p className="error" style={{margin:0}}>{error}</p>}
  </div>;
}
