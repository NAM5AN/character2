export type ReportHighlightSegment={text:string;highlighted:boolean};

type Range={start:number;end:number};

const CORE_TERMS=[
  '실제로','결국','핵심','오히려','아니라','욕구','두려움','결핍','방어','기준','모순',
  '작동','인정','필요','원하','거리','통제','자기','상대','관계','감정','바라','지키',
] as const;

function interpretationScore(text:string,index=0){
  const value=text.trim();
  let score=Math.min(index,2);
  for(const term of CORE_TERMS)if(value.includes(term))score+=2;
  if(/실제로|결국|핵심|오히려|아니라|그래서|때문/u.test(value))score+=4;
  if(/[가-힣](?:해요|예요|이에요|보여요|가까워요|작동해요|거예요|셈이에요|쪽이에요)$/u.test(value.replace(/[.!?]$/u,'')))score+=3;
  if(value.length>=18&&value.length<=72)score+=3;
  if(value.length<10)score-=5;
  return score;
}

function parseMarkedText(input:string){
  const ranges:Range[]=[];
  let text='';
  let cursor=0;
  for(const match of input.matchAll(/\*\*(.+?)\*\*/gsu)){
    const at=match.index??0;
    text+=input.slice(cursor,at).replace(/\*\*/g,'');
    const start=text.length;
    text+=match[1].replace(/\*\*/g,'');
    const end=text.length;
    if(text.slice(start,end).trim())ranges.push({start,end});
    cursor=at+match[0].length;
  }
  text+=input.slice(cursor).replace(/\*\*/g,'');
  return {text,ranges};
}

function trimRange(text:string,range:Range):Range{
  let {start,end}=range;
  while(start<end&&/\s/u.test(text[start]))start++;
  while(end>start&&/[\s,.!?]/u.test(text[end-1]))end--;
  return {start,end};
}

// AI가 명사구까지만 감싼 경우 바로 뒤 조사·서술어까지 붙여 완결된 주장으로 보이게 한다.
function expandMarkedRange(text:string,range:Range):Range{
  const clean=trimRange(text,range);
  const tail=text.slice(clean.end);
  if(!tail||/^[,.!?]/u.test(tail))return clean;
  const boundary=tail.search(/[,.;?!]/u);
  if(boundary<=0||boundary>24)return clean;
  const extension=tail.slice(0,boundary);
  if(!extension.trim()||clean.end-clean.start+extension.length>72)return clean;
  return trimRange(text,{start:clean.start,end:clean.end+extension.length});
}

function sentenceRanges(text:string):Range[]{
  const ranges:Range[]=[];
  let start=0;
  for(const match of text.matchAll(/[.!?](?=\s|$)/gu)){
    const end=(match.index??0)+1;
    const range=trimRange(text,{start,end});
    if(range.end>range.start)ranges.push(range);
    start=end;
  }
  const last=trimRange(text,{start,end:text.length});
  if(last.end>last.start)ranges.push(last);
  return ranges;
}

function clauseRanges(text:string,sentence:Range):Range[]{
  const ranges:Range[]=[];
  let start=sentence.start;
  for(let i=sentence.start;i<sentence.end;i++){
    if(text[i]!==','&&text[i]!==';')continue;
    const range=trimRange(text,{start,end:i});
    if(range.end-range.start>=12)ranges.push(range);
    start=i+1;
  }
  const last=trimRange(text,{start,end:sentence.end});
  if(last.end-last.start>=12)ranges.push(last);
  return ranges;
}

function bestRange(text:string,ranges:Range[]):Range{
  let best=ranges[0];
  let bestScore=interpretationScore(text.slice(best.start,best.end));
  for(let index=1;index<ranges.length;index++){
    const current=ranges[index];
    const score=interpretationScore(text.slice(current.start,current.end),index);
    if(score<=bestScore)continue;
    best=current;
    bestScore=score;
  }
  return best;
}

function fallbackRange(text:string):Range|null{
  const sentences=sentenceRanges(text);
  if(!sentences.length)return null;
  const sentence=bestRange(text,sentences);
  if(sentence.end-sentence.start<=72)return sentence;
  const clauses=clauseRanges(text,sentence);
  if(!clauses.length)return sentence;
  return bestRange(text,clauses);
}

export function reportHighlightSegments(input:string,{ensure=true}:{ensure?:boolean}={}):ReportHighlightSegment[]{
  const parsed=parseMarkedText(input);
  const marked=parsed.ranges.map(range=>expandMarkedRange(parsed.text,range));
  const chosen=marked.length?bestRange(parsed.text,marked):ensure?fallbackRange(parsed.text):null;
  if(!chosen)return [{text:parsed.text,highlighted:false}];
  return [
    {text:parsed.text.slice(0,chosen.start),highlighted:false},
    {text:parsed.text.slice(chosen.start,chosen.end),highlighted:true},
    {text:parsed.text.slice(chosen.end),highlighted:false},
  ].filter(segment=>segment.text.length>0);
}
