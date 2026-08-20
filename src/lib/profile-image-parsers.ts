import { inflateRawSync } from 'node:zlib';
import type { Block, ExtendedRecordMap } from 'notion-types';
import { getBlockValue, getPageContentBlockIds, getTextContent } from 'notion-utils';

export type RemoteProfileImage={url:string;name:string;key?:string};
export type ProfileZipMediaEntry={
  name:string;
  method:number;
  compressedSize:number;
  uncompressedSize:number;
  localOffset:number;
  contentType:string;
};

export const MAX_PROFILE_IMAGE_BYTES=10*1024*1024;
export const MAX_DISCOVERED_PROFILE_IMAGES=12;

function imageTypeForName(name:string){
  const ext=name.toLowerCase().split('.').pop()||'';
  if(ext==='jpg'||ext==='jpeg')return'image/jpeg';
  if(ext==='png')return'image/png';
  if(ext==='webp')return'image/webp';
  if(ext==='gif')return'image/gif';
  return'';
}

export function zipMediaEntries(buffer:Buffer):ProfileZipMediaEntry[]{
  let eocd=-1;
  const floor=Math.max(0,buffer.length-65_557);
  for(let i=buffer.length-22;i>=floor;i-=1){
    if(i+4<=buffer.length&&buffer.readUInt32LE(i)===0x06054b50){eocd=i;break}
  }
  if(eocd<0)throw new Error('PROFILE_IMAGE_DOCX_INVALID');
  const count=buffer.readUInt16LE(eocd+10);
  let offset=buffer.readUInt32LE(eocd+16);
  const out:ProfileZipMediaEntry[]=[];
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
    if(name.startsWith('word/media/')&&contentType&&uncompressedSize>=1024&&uncompressedSize<=MAX_PROFILE_IMAGE_BYTES&&(method===0||method===8)){
      out.push({name:name.split('/').pop()||`image-${out.length+1}`,method,compressedSize,uncompressedSize,localOffset,contentType});
      if(out.length>=MAX_DISCOVERED_PROFILE_IMAGES)break;
    }
    offset=nameEnd+extraLen+commentLen;
  }
  return out;
}

export function extractZipEntry(buffer:Buffer,entry:ProfileZipMediaEntry){
  const offset=entry.localOffset;
  if(offset+30>buffer.length||buffer.readUInt32LE(offset)!==0x04034b50)throw new Error('PROFILE_IMAGE_DOCX_INVALID');
  const nameLen=buffer.readUInt16LE(offset+26);
  const extraLen=buffer.readUInt16LE(offset+28);
  const start=offset+30+nameLen+extraLen;
  const end=start+entry.compressedSize;
  if(start<0||end>buffer.length)throw new Error('PROFILE_IMAGE_DOCX_INVALID');
  const compressed=buffer.subarray(start,end);
  const raw=entry.method===0?Buffer.from(compressed):inflateRawSync(compressed,{maxOutputLength:MAX_PROFILE_IMAGE_BYTES});
  if(raw.byteLength>MAX_PROFILE_IMAGE_BYTES)throw new Error('PROFILE_IMAGE_TOO_LARGE');
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

export function htmlImages(html:string,base:URL):RemoteProfileImage[]{
  const region=preferredHtmlRegion(html);
  const output:RemoteProfileImage[]=[];
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
    if(output.length>=MAX_DISCOVERED_PROFILE_IMAGES)break;
  }
  return output;
}

function notionImageSource(recordMap:ExtendedRecordMap,blockId:string,block:Block){
  const properties=block.properties||{};
  const format=block.format||{};
  const signedUrls=recordMap.signed_urls||{};
  const signedBlockId=block.id||blockId;
  const candidates=[
    typeof signedUrls[signedBlockId]==='string'?signedUrls[signedBlockId]:'',
    typeof signedUrls[blockId]==='string'?signedUrls[blockId]:'',
    getTextContent(properties.source),
    getTextContent(properties.display_source),
    typeof format.display_source==='string'?format.display_source:'',
    typeof format.source==='string'?format.source:'',
  ].map(value=>String(value||'').trim()).filter(Boolean);
  return candidates.find(value=>/^https?:\/\//iu.test(value))||'';
}

export function notionImages(recordMap:ExtendedRecordMap,pageId:string):RemoteProfileImage[]{
  const blockMap=recordMap.block||{};
  const preferred=getPageContentBlockIds(recordMap,pageId);
  const preferredSet=new Set(preferred);
  const allBlockIds=Object.keys(blockMap);
  const ordered=[...preferred,...allBlockIds.filter(id=>!preferredSet.has(id))];
  const output:RemoteProfileImage[]=[];
  const seen=new Set<string>();
  for(const blockId of ordered){
    const block=getBlockValue(blockMap[blockId]);
    if(!block||block.type!=='image')continue;
    const source=notionImageSource(recordMap,blockId,block);
    if(!source||seen.has(source))continue;
    let parsed:URL;try{parsed=new URL(source)}catch{continue}
    if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')continue;
    seen.add(source);
    const file=parsed.pathname.split('/').pop()||`notion-image-${output.length+1}`;
    output.push({url:source,name:decodeURIComponent(file).slice(0,120)||`notion-image-${output.length+1}`,key:block.id||blockId});
    if(output.length>=MAX_DISCOVERED_PROFILE_IMAGES)break;
  }
  return output;
}
