import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NotionAPI } from 'notion-client';
import { parsePageId } from 'notion-utils';
import {
  extractZipEntry,
  htmlImages,
  MAX_DISCOVERED_PROFILE_IMAGES,
  MAX_PROFILE_IMAGE_BYTES,
  notionImages,
  zipMediaEntries,
} from './profile-image-parsers';

export type ProfileImageLinkKind='google_docs'|'postype'|'notion';
export type ProfileImageItem={index:number;name:string;key?:string};
export type ProfileImageDiscovery={url:string;kind:ProfileImageLinkKind;images:ProfileImageItem[]};
export type LoadedProfileImage={name:string;contentType:string;bytes:Uint8Array};

const FETCH_TIMEOUT_MS=12_000;
const MAX_PAGE_BYTES=3*1024*1024;
const MAX_DOCX_BYTES=16*1024*1024;
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif']);

function hostMatches(hostname:string,domain:string){return hostname===domain||hostname.endsWith(`.${domain}`)}
function isNotionHost(hostname:string){
  const host=hostname.toLowerCase();
  return hostMatches(host,'notion.so')||hostMatches(host,'notion.site')||host==='app.notion.com';
}

export function parseSupportedProfileImageUrl(value:string){
  const trimmed=value.trim();
  if(!/^https?:\/\/\S+$/iu.test(trimmed))return null;
  let url:URL;
  try{url=new URL(trimmed)}catch{return null}
  const host=url.hostname.toLowerCase();
  if(host==='docs.google.com'&&/^\/document\/d\/[a-zA-Z0-9_-]+/u.test(url.pathname))return{url,kind:'google_docs' as const};
  if(hostMatches(host,'postype.com'))return{url,kind:'postype' as const};
  if(isNotionHost(host))return{url,kind:'notion' as const};
  return null;
}

function redirectAllowed(kind:ProfileImageLinkKind,url:URL){
  const host=url.hostname.toLowerCase();
  if(kind==='google_docs')return host==='docs.google.com'||hostMatches(host,'googleusercontent.com');
  if(kind==='postype')return hostMatches(host,'postype.com');
  return isNotionHost(host);
}

function isPrivateIpv4(address:string){
  const p=address.split('.').map(Number);
  if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
  const[a,b]=p;
  return a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||
    (a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||
    (a===192&&b===168)||
    (a===198&&(b===18||b===19));
}

function isPrivateIpv6(address:string){
  const a=address.toLowerCase();
  if(a==='::'||a==='::1')return true;
  if(a.startsWith('fc')||a.startsWith('fd'))return true;
  if(/^fe[89ab]/u.test(a))return true;
  if(a.startsWith('::ffff:')){
    const mapped=a.slice('::ffff:'.length);
    return isIP(mapped)===4?isPrivateIpv4(mapped):true;
  }
  return false;
}

async function assertPublicRemoteUrl(url:URL){
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('PROFILE_IMAGE_URL_INVALID');
  const host=url.hostname.replace(/^\[|\]$/gu,'').toLowerCase();
  if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw new Error('PROFILE_IMAGE_URL_INVALID');
  const literal=isIP(host);
  if(literal===4&&isPrivateIpv4(host))throw new Error('PROFILE_IMAGE_URL_INVALID');
  if(literal===6&&isPrivateIpv6(host))throw new Error('PROFILE_IMAGE_URL_INVALID');
  if(literal)return;
  const records=await lookup(host,{all:true,verbatim:true});
  if(!records.length)throw new Error('PROFILE_IMAGE_URL_INVALID');
  for(const record of records){
    if(record.family===4&&isPrivateIpv4(record.address))throw new Error('PROFILE_IMAGE_URL_INVALID');
    if(record.family===6&&isPrivateIpv6(record.address))throw new Error('PROFILE_IMAGE_URL_INVALID');
  }
}

async function readBufferCapped(response:Response,maxBytes:number){
  const declared=Number(response.headers.get('content-length')||0);
  if(Number.isFinite(declared)&&declared>maxBytes)throw new Error('PROFILE_IMAGE_TOO_LARGE');
  const body=response.body;
  if(!body){
    const raw=new Uint8Array(await response.arrayBuffer());
    if(raw.byteLength>maxBytes)throw new Error('PROFILE_IMAGE_TOO_LARGE');
    return Buffer.from(raw);
  }
  const reader=body.getReader();
  const chunks:Buffer[]=[];
  let total=0;
  try{
    for(;;){
      const{done,value}=await reader.read();
      if(done)break;
      if(!value)continue;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel();throw new Error('PROFILE_IMAGE_TOO_LARGE')}
      chunks.push(Buffer.from(value));
    }
  }finally{reader.releaseLock?.()}
  return Buffer.concat(chunks,total);
}

async function fetchSource(initialUrl:URL,kind:ProfileImageLinkKind,accept:string){
  let current=initialUrl;
  for(let i=0;i<=4;i+=1){
    if(!redirectAllowed(kind,current))throw new Error('PROFILE_IMAGE_SOURCE_REDIRECT_BLOCKED');
    await assertPublicRemoteUrl(current);
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(FETCH_TIMEOUT_MS),headers:{'user-agent':'Mozilla/5.0 (compatible; CHARA-LAB/1.0; +https://character2-eight.vercel.app)',accept},cache:'no-store'});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location)throw new Error('PROFILE_IMAGE_SOURCE_UNREADABLE');
      current=new URL(location,current);
      continue;
    }
    return response;
  }
  throw new Error('PROFILE_IMAGE_SOURCE_UNREADABLE');
}

async function fetchPublicImage(initialUrl:URL){
  let current=initialUrl;
  for(let i=0;i<=4;i+=1){
    await assertPublicRemoteUrl(current);
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(FETCH_TIMEOUT_MS),headers:{'user-agent':'Mozilla/5.0 (compatible; CHARA-LAB/1.0; +https://character2-eight.vercel.app)',accept:'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.2'},cache:'no-store'});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location)throw new Error('PROFILE_IMAGE_UNREADABLE');
      current=new URL(location,current);
      continue;
    }
    if(!response.ok)throw new Error('PROFILE_IMAGE_UNREADABLE');
    const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!IMAGE_TYPES.has(type))throw new Error('PROFILE_IMAGE_TYPE_UNSUPPORTED');
    const buffer=await readBufferCapped(response,MAX_PROFILE_IMAGE_BYTES);
    return{buffer,type};
  }
  throw new Error('PROFILE_IMAGE_UNREADABLE');
}

function googleDocId(url:URL){
  const match=url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/u);
  if(!match)throw new Error('PROFILE_IMAGE_SOURCE_INVALID');
  return match[1];
}

async function fetchGoogleDocx(url:URL){
  const target=new URL(`https://docs.google.com/document/d/${googleDocId(url)}/export?format=docx`);
  const response=await fetchSource(target,'google_docs','application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.5');
  if(!response.ok)throw new Error('PROFILE_IMAGE_SOURCE_UNREADABLE');
  return readBufferCapped(response,MAX_DOCX_BYTES);
}

async function discoverPostype(url:URL){
  const response=await fetchSource(url,'postype','text/html,*/*;q=0.5');
  if(!response.ok)throw new Error('PROFILE_IMAGE_SOURCE_UNREADABLE');
  const raw=(await readBufferCapped(response,MAX_PAGE_BYTES)).toString('utf8');
  return htmlImages(raw,url);
}

async function discoverNotion(url:URL){
  const pageId=parsePageId(url.toString());
  if(!pageId)throw new Error('PROFILE_IMAGE_SOURCE_INVALID');
  const notion=new NotionAPI({userTimeZone:'Asia/Seoul',ofetchOptions:{timeout:FETCH_TIMEOUT_MS,retry:1}});
  const recordMap=await notion.getPage(pageId,{concurrency:2,fetchMissingBlocks:true,fetchCollections:false,fetchCustomEmojis:false,signFileUrls:true,fetchRelationPages:false,ofetchOptions:{timeout:FETCH_TIMEOUT_MS,retry:1}});
  return notionImages(recordMap,pageId);
}

async function remoteImagesFor(url:URL,kind:ProfileImageLinkKind){
  if(kind==='postype')return discoverPostype(url);
  if(kind==='notion')return discoverNotion(url);
  return[];
}

export async function discoverProfileImages(value:string):Promise<ProfileImageDiscovery>{
  const parsed=parseSupportedProfileImageUrl(value);
  if(!parsed)throw new Error('PROFILE_IMAGE_SOURCE_UNSUPPORTED');
  if(parsed.kind==='google_docs'){
    const docx=await fetchGoogleDocx(parsed.url);
    const images=zipMediaEntries(docx).map((entry,index)=>({index,name:entry.name}));
    return{url:parsed.url.toString(),kind:parsed.kind,images};
  }
  const remote=await remoteImagesFor(parsed.url,parsed.kind);
  return{url:parsed.url.toString(),kind:parsed.kind,images:remote.map((item,index)=>({index,name:item.name,...(item.key?{key:item.key}:{})}))};
}

export async function loadProfileImage(value:string,index:number,key?:string):Promise<LoadedProfileImage>{
  const parsed=parseSupportedProfileImageUrl(value);
  if(!parsed||!Number.isInteger(index)||index<0||index>=MAX_DISCOVERED_PROFILE_IMAGES)throw new Error('PROFILE_IMAGE_INVALID');
  if(parsed.kind==='google_docs'){
    const docx=await fetchGoogleDocx(parsed.url);
    const entries=zipMediaEntries(docx);
    const entry=entries[index];
    if(!entry)throw new Error('PROFILE_IMAGE_NOT_FOUND');
    const raw=extractZipEntry(docx,entry);
    return{name:entry.name,contentType:entry.contentType,bytes:new Uint8Array(raw)};
  }
  const remote=await remoteImagesFor(parsed.url,parsed.kind);
  const item=parsed.kind==='notion'&&key?remote.find(candidate=>candidate.key===key):remote[index];
  if(!item)throw new Error('PROFILE_IMAGE_NOT_FOUND');
  const loaded=await fetchPublicImage(new URL(item.url));
  return{name:item.name,contentType:loaded.type,bytes:new Uint8Array(loaded.buffer)};
}
