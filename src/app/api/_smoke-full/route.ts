import { NextResponse } from 'next/server';
import { POST as parsePost } from '@/app/api/characters/parse/route';
import { POST as questionPost } from '@/app/api/characters/questions/next/route';
import { POST as finalizePost } from '@/app/api/characters/finalize/route';
import { getSupabaseServer } from '@/lib/supabase/server';

const TOKEN = 'Jy42C78J45ebp0Wd9FU2jiblg60nW3_a';
const ACCESS_CODE = 'CHARA82';

async function jsonOf(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  }

  let shareCode: string | undefined;
  let editToken: string | undefined;
  try {
    const profileText = [
      '테스트 캐릭터 윤서. 24세.',
      '낯을 가리고 말수가 적지만 책임감이 강하다.',
      '친해진 사람은 행동으로 챙기며 부탁을 쉽게 거절하지 못한다.',
      '갈등이 생기면 바로 화를 내기보다 혼자 정리한 뒤 대화하려 한다.',
      '자율성을 중요하게 여기며 타인에게 약한 모습을 드러내는 것은 서툴다.',
    ].join(' ');

    const parsed = await jsonOf(await parsePost(new Request('http://smoke/api/characters/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '윤서', profileText, accessCode: ACCESS_CODE }),
    })));
    const draft = parsed.draft;

    const answers: Array<{ order: number; question: string; answer: string }> = [];
    const categories: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const qBody = await jsonOf(await questionPost(new Request('http://smoke/api/characters/questions/next', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft, answers, accessCode: ACCESS_CODE }),
      })));
      if (qBody.done || !qBody.question) throw new Error(`QUESTION_EARLY_DONE_${i + 1}`);
      const q = qBody.question;
      categories.push(q.category);
      answers.push({ order: q.order, question: q.question, answer: q.options?.[0] || '직접 답변' });
    }

    const finalized = await jsonOf(await finalizePost(new Request('http://smoke/api/characters/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft, answers, accessCode: ACCESS_CODE }),
    })));
    shareCode = finalized.shareCode;
    editToken = finalized.editToken;

    const supabase = getSupabaseServer();
    const { data: loaded, error: loadError } = await supabase.rpc('character2_get_character', { p_share_code: shareCode });
    if (loadError) throw loadError;
    const loadedPassport = Array.isArray(loaded) ? loaded[0]?.passport_json : loaded?.passport_json;
    if (!loadedPassport || loadedPassport.shareCode !== shareCode) throw new Error('LOAD_MISMATCH');

    const { data: deleted, error: deleteError } = await supabase.rpc('character2_delete_character', {
      p_share_code: shareCode,
      p_edit_token: editToken,
    });
    if (deleteError) throw deleteError;
    if (deleted !== true) throw new Error('DELETE_FAILED');

    return NextResponse.json({
      ok: true,
      parse: { name: draft.basicProfile.name, confidence: draft.analysisConfidence },
      questions: { count: answers.length, categories },
      claude: { summary: finalized.passport.analysis.oneLineSummary },
      supabase: { saved: true, shareCode, loaded: true, deleted: true },
    });
  } catch (error) {
    if (shareCode && editToken) {
      try {
        const supabase = getSupabaseServer();
        await supabase.rpc('character2_delete_character', { p_share_code: shareCode, p_edit_token: editToken });
      } catch {}
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
