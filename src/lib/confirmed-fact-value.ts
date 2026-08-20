export type ConfirmedFactValue=string|number|boolean|null|string[];

function compactString(value:string,max:number){
  const normalized=value.replace(/\s+/gu,' ').trim();
  return normalized?normalized.slice(0,max):'';
}

function stringifyObject(value:object,max:number){
  try{
    const json=JSON.stringify(value);
    if(typeof json==='string')return compactString(json,max);
  }catch{}
  return compactString(String(value),max);
}

// Model outputs occasionally use a small object for a fact value
// (for example {label, detail}) even though stored character facts deliberately
// allow only bounded scalar values or string arrays. Preserve that information as
// compact text instead of letting the final draft validation reject the request.
export function normalizeConfirmedFactValue(value:unknown):ConfirmedFactValue|undefined{
  if(value===null)return null;
  if(typeof value==='string')return compactString(value,2_000)||undefined;
  if(typeof value==='number')return Number.isFinite(value)?value:undefined;
  if(typeof value==='boolean')return value;
  if(Array.isArray(value)){
    const items=value.slice(0,30).map(item=>{
      if(typeof item==='string')return compactString(item,600);
      if(item===null)return'null';
      if(typeof item==='number')return Number.isFinite(item)?String(item):'';
      if(typeof item==='boolean')return String(item);
      if(typeof item==='object')return stringifyObject(item,600);
      return compactString(String(item),600);
    }).filter(Boolean);
    return items.length?items:undefined;
  }
  if(typeof value==='object')return stringifyObject(value,2_000)||undefined;
  return undefined;
}
