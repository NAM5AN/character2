import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeConfirmedFactValue } from '../src/lib/confirmed-fact-value.ts';

test('confirmed fact object values become bounded strings',()=>{
  assert.equal(
    normalizeConfirmedFactValue({label:'신분',detail:'감시 기관 소속'}),
    '{"label":"신분","detail":"감시 기관 소속"}',
  );
});

test('confirmed fact arrays become schema-safe string arrays',()=>{
  assert.deepEqual(
    normalizeConfirmedFactValue(['첫 번째',{name:'두 번째'},true,3]),
    ['첫 번째','{"name":"두 번째"}','true','3'],
  );
});

test('confirmed fact strings and nested values stay within schema limits',()=>{
  assert.equal(normalizeConfirmedFactValue(' x '.repeat(3_000))?.length,2_000);
  const nested=normalizeConfirmedFactValue([{text:' y '.repeat(1_000)}]);
  assert.ok(Array.isArray(nested));
  assert.equal(nested[0].length,600);
});
