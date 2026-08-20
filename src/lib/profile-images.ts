import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { inflateRawSync } from 'node:zlib';
import { NotionAPI } from 'notion-client';
import { getBlockValue, getPageContentBlockIds, getTextContent, parsePageId } from 'notion-utils';

export type ProfileImageLinkKind='google_docs'|'postype'|'notion';
export type ProfileImageItem={index:number;name:string};
export type ProfileImageDiscovery={url:string;kind:ProfileImageLinkKind;images:ProfileImageItem[]};
export type LoadedProfileImage={name:string;contentType:string;bytes:Uint8Array};

type RemoteImage={url:string;name:string};
type ZipMediaEntry={name:string;method:number;compressedSize:number;uncompressedSize:number;localOffset:number;contentType:string};

const FETCH_TIMEOUT_MS=12_000;
const MAX_PAGE_BYTES=3*1024*1024;
const MAX_DOCX_BYTES=16*1024*1024;
const MAX_IMAGE_BYTES=3*1024*1024;
const MAX_DISCOVERED=12;
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
    const buffer=await readBufferCapped(response,MAX_IMAGE_BYTES);
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

function imageTypeForName(name:string){
  const ext=name.toLowerCase().split('.').pop()||'';
  if(ext==='jpg'||ext==='jpeg')return'image/jpeg';
  if(ext==='png')return'image/png';
  if(ext==='webp')return'image/webp';
  if(ext==='gif')return'image/gif';
  return'';
}

function zipMediaEntries(buffer:Buffer):ZipMediaEntry[]{
  let eocd=-1;
  const floor=Math.max(0,buffer.length-65_557);
  for(let i=buffer.length-22;i>=floor;i-=1){
    if(i+4<=buffer.length&&buffer.readUInt32LE(i)===0x06054b50){eocd=i;break}
  }
  if(eocd<0)throw new Error('PROFILE_IMAGE_DOCX_INVALID');
  const count=buffer.readUInt16LE(eocd+10);
  let offset=buffer.readUInt32LE(eocd+16);
  const out:ZipMediaEntry[]=[];
  for(let i=0;i<count&&offset+46<=buffer.length;i+=1){
    if(buffer.readUInt32LE(offset)!==0x02014b50)break;
    const method=buffer.readUInt16LE(offset+10);
    const compressedSize=buffer.readUInt32LE(offset+20);
    const uncompressedSize=buffer.readUInt32LE(offset+24);
    const nameLen=buffer.readUInt16LE(offset+28);
    const extraLen=buffer.readUInt16LE(offset+30);
    const commentLen=buffer.readUInt16LE(offset+32);
    const localOffset=buffer.readUInt32LE(offset+42);
    const nameStart=offset+46;
    const nameEnd=nameStart+nameLen;
    if(nameEnd>buffer.length)break;
    const name=buffer.subarray(nameStart,nameEnd).toString('utf8');
    const contentType=imageTypeForName(name);
    if(name.startsWith('word/media/')&&contentType&&uncompressedSize>=1024&&uncompressedSize<=MAX_IMAGE_BYTES&&(method===0||method===8)){
      out.push({name:name.split('/').pop()||`image-${out.length+1}`,method,compressedSize,uncompressedSize,localOffset,contentType});
      if(out.length>=MAX_DISCOVERED)break;
    }
    offset=nameEnd+extraLen+commentLen;
  }
  return out;
}

function extractZipEntry(buffer:Buffer,entry:ZipMediaEntry){
  const offset=entry.localOffset;
  if(offset+30>buffer.length||buffer.readUInt32LE(offset)!==0x04034b50)throw new Error('PROFILE_IMAGE_DOCX_INVALID');
  const nameLen=buffer.readUInt16LE(offset+26);
  const extraLen=buffer.readUInt16LE(offset+28);
  const start=offset+30+nameLen+extraLen;
  const end=start+entry.compressedSize;
  if(start<0||end>buffer.length)throw new Error('PROFILE_IMAGE_DOCX_INVALID');
  const compressed=buffer.subarray(start,end);
  const raw=entry.method===0?Buffer.from(compressed):inflateRawSync(compressed);
  if(raw.byteLength>MAX_IMAGE_BYTES)throw new Error('PROFILE_IMAGE_TOO_LARGE');
  return raw;
}

function decodeHtmlEntities(value:string){
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/giu,(_,token:string)=>{
    const key=token.toLowerCase();
    if(key==='amp')return'&';if(key==='lt')return'<';if(key==='gt')return'>';if(key==='quot')return'"';if(key==='apos')return"'";if(key==='nbsp')return' ';
    if(key.startsWith('#x'))return String.fromCodePoint(Number.parseInt(key.slice(2),16));
    if(key.startsWith('#'))return String.fromCodePoint(Number.parseInt(key.slice(1),10));
    return _;
  });
}

function preferredHtmlRegion(html:string){
  const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1];
  if(article)return article;
  const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1];
  if(main)return main;
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1]||html;
}

function attr(tag:string,name:string){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const match=tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'iu'));
  return decodeHtmlEntities(match?.[1]??match?.[2]??match?.[3]??'').trim();
}

function srcsetCandidate(value:string){
  const candidates=value.split(',').map(part=>part.trim().split(/\s+/u)[0]).filter(Boolean);
  return candidates.at(-1)||'';
}

function htmlImages(html:string,base:URL):RemoteImage[]{
  const region=preferredHtmlRegion(html);
  const output:RemoteImage[]=[];
  const seen=new Set<string>();
  for(const match of region.matchAll(/<img\b[^>]*>/giu)){
    const tag=match[0];
    const lower=tag.toLowerCase();
    if(/\b(logo|favicon|emoji|sprite|tracking|pixel|badge)\b/u.test(lower))continue;
    const width=Number(attr(tag,'width')||0),height=Number(attr(tag,'height')||0);
    if(width>0&&height>0&&width<=96&&height<=96)continue;
    let candidate=attr(tag,'data-src')||attr(tag,'data-original')||attr(tag,'data-lazy-src')||attr(tag,'src');
    if(!candidate)candidate=srcsetCandidate(attr(tag,'data-srcset')||attr(tag,'srcset'));
    if(!candidate||candidate.startsWith('data:')||candidate.startsWith('blob:'))continue;
    let resolved:URL;
    try{resolved=new URL(candidate,base)}catch{continue}
    if(resolved.protocol!=='https:'&&resolved.protocol!=='http:')continue;
    const key=resolved.toString();
    if(seen.has(key))continue;
    seen.add(key);
    const path=resolved.pathname.split('/').pop()||`image-${output.length+1}`;
    output.push({url:key,name:decodeURIComponent(path).slice(0,120)||`image-${output.length+1}`});
    if(output.length>=MAX_DISCOVERED)break;
  }
  return output;
}

async function discoverPostype(url:URL){
  const response=await fetchSource(url,'postype','text/html,*/*;q=0.5');
  if(!response.ok)throw new Error('PROFILE_IMAGE_SOURCE_UNREADABLE');
  const raw=(await readBufferCapped(response,MAX_PAGE_BYTES)).toString('utf8');
  return htmlImages(raw,url);
}

function notionImageSource(block:any){
  const properties=block?.properties||{};
  const format=block?.format||{};
  const candidates=[
    getTextContent(properties.source),
    getTextContent(properties.display_source),
    typeof format.display_source==='string'?format.display_source:'',
    typeof format.source==='string'?format.source:'',
  ].map(value=>String(value||'').trim()).filter(Boolean);
  return candidates.find(value=>/^https?:\/\//iu.test(value))||'';
}

async function discoverNotion(url:URL){
  const pageId=parsePageId(url.toString());
  if(!pageId)throw new Error('PROFILE_IMAGE_SOURCE_INVALID');
  const notion=new NotionAPI({userTimeZone:'Asia/Seoul',ofetchOptions:{timeout:FETCH_TIMEOUT_MS,retry:1}});
  const recordMap=await notion.getPage(pageId,{concurrency:2,fetchMissingBlocks:true,fetchCollections:false,fetchCustomEmojis:false,signFileUrls:true,fetchRelationPages:false,ofetchOptions:{timeout:FETCH_TIMEOUT_MS,retry:1}});
  const preferred=getPageContentBlockIds(recordMap,pageId);
  const allBlockIds=Object.keys((recordMap as any)?.block||{});
  const ordered=[...preferred,...allBlockIds.filter(id=>!preferred.includes(id))];
  const output:RemoteImage[]=[];
  const seen=new Set<string>();
  for(const blockId of ordered){
    const block=getBlockValue((recordMap as any).block?.[blockId]);
    if(!block||block.type!=='image')continue;
    const source=notionImageSource(block);
    if(!source||seen.has(source))continue;
    let parsed:URL;try{parsed=new URL(source)}catch{continue}
    if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')continue;
    seen.add(source);
    const file=parsed.pathname.split('/').pop()||`notion-image-${output.length+1}`;
    output.push({url:source,name:decodeURIComponent(file).slice(0,120)||`notion-image-${output.length+1}`});
    if(output.length>=MAX_DISCOVERED)break;
  }
  return output;
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
  return{url:parsed.url.toString(),kind:parsed.kind,images:remote.map((item,index)=>({index,name:item.name}))};
}

export async function loadProfileImage(value:string,index:number):Promise<LoadedProfileImage>{
  const parsed=parseSupportedProfileImageUrl(value);
  if(!parsed||!Number.isInteger(index)||index<0||index>=MAX_DISCOVERED)throw new Error('PROFILE_IMAGE_INVALID');
  if(parsed.kind==='google_docs'){
    const docx=await fetchGoogleDocx(parsed.url);
    const entries=zipMediaEntries(docx);
    const entry=entries[index];
    if(!entry)throw new Error('PROFILE_IMAGE_NOT_FOUND');
    const raw=extractZipEntry(docx,entry);
    return{name:entry.name,contentType:entry.contentType,bytes:new Uint8Array(raw)};
  }
  const remote=await remoteImagesFor(parsed.url,parsed.kind);
  const item=remote[index];
  if(!item)throw new Error('PROFILE_IMAGE_NOT_FOUND');
  const loaded=await fetchPublicImage(new URL(item.url));
  return{name:item.name,contentType:loaded.type,bytes:new Uint8Array(loaded.buffer)};
}
