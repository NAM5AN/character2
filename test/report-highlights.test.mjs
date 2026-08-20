import assert from 'node:assert/strict';
import test from 'node:test';

import { reportHighlightSegments } from '../src/lib/report-highlights.ts';

function highlighted(input,options){
  return reportHighlightSegments(input,options).filter(segment=>segment.highlighted).map(segment=>segment.text);
}

test('a marked noun phrase expands through its Korean predicate ending',()=>{
  const result=highlighted('채원은 **침착함이 결핍을 가리는 기술**이라서, 가까이서 볼수록 다른 집중력이 드러나요.');
  assert.deepEqual(result,['침착함이 결핍을 가리는 기술이라서']);
});

test('a paragraph without markdown receives one complete core highlight',()=>{
  const result=highlighted('표면적으로는 무심하게 선을 그어요. 하지만 실제로는 상대가 원하는 상태를 깨지 않게 관리하는 정교한 개입에 가까워요. 이 차이가 관계를 어렵게 해요.');
  assert.equal(result.length,1);
  assert.match(result[0],/실제로|상대가 원하는 상태|정교한 개입/u);
});

test('multiple model highlights are normalized to one body highlight',()=>{
  const result=highlighted('이건 **욕망을 부정하는 절차**가 작동해요. 동시에 **필요한 사람으로 남고 싶은 욕구**도 보여요.');
  assert.equal(result.length,1);
});

test('fallback highlighting can be disabled for compact summary cards',()=>{
  const result=highlighted('한눈에 보는 카드 문장입니다.',{ensure:false});
  assert.deepEqual(result,[]);
});
