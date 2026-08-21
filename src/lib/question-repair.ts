import { questionEvidenceIssues, quotedPhrases, sourceExcerptForPhrase } from '@/lib/question-evidence';

// 질문 생성 결과가 검증에 걸리면 다른 모델로 문항 전체를 다시 만든다(시간·비용 2배).
// 그런데 실패 사유 중에는 질문·선택지 자체는 멀쩡하고 곁다리만 어긋난 경우가 많다.
// 그런 위반은 여기서 고쳐서 통과시키고, 내용이 부실한 위반(선택지 부족·중복 등)은
// 손대지 않고 그대로 재생성 경로로 보낸다.
//
// 원칙: 질문 문장과 선택지 내용은 창작하거나 바꾸지 않는다.

type UnknownRecord = Record<string, unknown>;

// UI가 모든 문항에 "직접 입력" 칸을 따로 그려준다. AI가 만든 "기타/직접 입력" 보기는
// 눌러도 입력이 안 되는 죽은 보기이고, 실제 선택지 수만 줄인다. 그래서 이것만 걷어낸다.
const UI_PROVIDED_OPTION = /^\s*(?:직접\s*입력|기타)\s*$/u;

function isUiProvidedOption(value: unknown) {
  return typeof value === 'string' && UI_PROVIDED_OPTION.test(value);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

// 척도형의 양끝 라벨이 비어서 실패하는 경우가 잦다. 라벨은 질문 내용이 아니라
// 화면 표시용 문구이므로, 비었을 때만 형식에 맞는 기본값을 채운다.
const SCALE_LABEL_DEFAULTS: Record<string, [string, string]> = {
  bipolar_scale: ['그렇지 않다', '그렇다'],
  slider: ['낮음', '높음'],
};

function repairScaleLabels(question: UnknownRecord, responseType: string) {
  const config = asRecord(question.responseConfig);
  if (!config) return false;
  const defaults = SCALE_LABEL_DEFAULTS[responseType];
  if (!defaults) return false;

  const keys = responseType === 'slider' ? ['minLabel', 'maxLabel'] as const : ['leftLabel', 'rightLabel'] as const;
  let changed = false;
  keys.forEach((key, index) => {
    const current = config[key];
    if (typeof current === 'string' && current.trim()) return;
    config[key] = defaults[index];
    changed = true;
  });
  return changed;
}

// UI가 제공하는 보기가 섞여 있으면 걷어낸다. 남은 선택지가 형식 요건을 못 채우면
// 되돌린다 — 억지로 통과시키지 않고 정상 재생성 경로로 보낸다.
function stripUiProvidedOptions(question: UnknownRecord, responseType: string) {
  let changed = false;
  const minimum = responseType === 'forced_choice' ? 2 : responseType === 'multi_select' ? 4 : 3;

  const options = stringList(question.options);
  if (options.some(isUiProvidedOption)) {
    const kept = options.filter(option => !isUiProvidedOption(option));
    if (kept.length >= minimum) { question.options = kept; changed = true; }
  }

  const config = asRecord(question.responseConfig);
  if (config) {
    const options2 = stringList(config.options2);
    if (options2.some(isUiProvidedOption)) {
      const kept = options2.filter(option => !isUiProvidedOption(option));
      // temporal_compare는 두 번째 시점도 4개를 요구한다.
      if (kept.length >= (responseType === 'temporal_compare' ? 4 : 3)) { config.options2 = kept; changed = true; }
    }
    const rowOptions = asRecord(config.rowOptions);
    if (rowOptions) {
      for (const [row, value] of Object.entries(rowOptions)) {
        const choices = stringList(value);
        if (!choices.some(isUiProvidedOption)) continue;
        const kept = choices.filter(option => !isUiProvidedOption(option));
        if (kept.length === 4) { rowOptions[row] = kept; changed = true; }
      }
    }
  }
  return changed;
}

// evidence 는 서버 검증용 내부 근거이고 사용자 화면에는 안 보인다. 프로덕션에서 관측된
// 실패는 세 가지였다: 검증 못 하는 항목이 섞임, 상한(2개)을 넘김, 질문이 인용한 대사가
// evidence 에 없음. 셋 다 질문 문장 자체는 멀쩡하므로 배치를 다시 만들 이유가 없다.
// 근거를 지어내지는 않는다 — 원문에서 찾지 못하면 손대지 않고 재생성 경로로 보낸다.
const EVIDENCE_MAX = 2;

function verifies(question: UnknownRecord, quote: string, sources: string[]) {
  const probe = { ...question, evidence: [quote] } as unknown as Parameters<typeof questionEvidenceIssues>[0];
  return questionEvidenceIssues(probe, sources).length === 0;
}

function repairEvidence(question: UnknownRecord, sources: string[]) {
  const original = stringList(question.evidence);
  let evidence = original.slice();

  // 1) 원문과 대조되지 않는 항목은 버린다(전부 버려질 때는 그대로 둔다).
  const verified = evidence.filter(quote => verifies(question, quote, sources));
  if (verified.length) evidence = verified;

  // 2) 질문이 따옴표로 인용한 대사가 evidence 에 없으면, 그 대사를 담은 원문 구절을 찾아 채운다.
  const questionText = typeof question.question === 'string' ? question.question : '';
  for (const phrase of quotedPhrases(questionText)) {
    if (evidence.some(quote => verifies(question, quote, sources) && quote.includes(phrase))) continue;
    const covered = questionEvidenceIssues(
      { ...question, evidence } as unknown as Parameters<typeof questionEvidenceIssues>[0], sources,
    ).every(issue => !issue.message.includes(phrase.slice(0, 30)));
    if (covered) continue;
    const excerpt = sourceExcerptForPhrase(phrase, sources);
    if (!excerpt) continue;
    evidence = [excerpt, ...evidence.filter(quote => quote !== excerpt)];
  }

  // 3) 상한을 넘기면 앞쪽(검증 통과·인용 포함) 우선으로 잘라낸다.
  if (evidence.length > EVIDENCE_MAX) evidence = evidence.slice(0, EVIDENCE_MAX);

  if (!evidence.length) return false;
  if (evidence.length === original.length && evidence.every((q, i) => q === original[i])) return false;
  question.evidence = evidence;
  return true;
}

// rationale 은 프롬프트가 요구하지만 코드 어디에서도 읽지 않는 내부 메모다.
// 이것 하나가 비었다고 배치 전체를 다시 만드는 것은 순전한 낭비이므로 채워서 통과시킨다.
function fillMissingRationale(question: UnknownRecord) {
  const current = question.rationale;
  if (typeof current === 'string' && current.trim()) return false;
  const hook = typeof question.targetHook === 'string' ? question.targetHook.trim() : '';
  const hypothesis = typeof question.hypothesis === 'string' ? question.hypothesis.trim() : '';
  question.rationale = (hypothesis || hook || '생성 근거 미기재').slice(0, 260);
  return true;
}
// 생성 결과 전체를 훑어 고칠 수 있는 위반만 고친다. 반환값은 보정한 문항 수.
export function repairGeneratedQuestions(
  value: unknown,
  specs: Array<{ order: number; responseType: string }>,
  evidenceSources: string[],
) {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.questions)) return 0;
  const typeByOrder = new Map(specs.map(spec => [spec.order, spec.responseType]));

  let repaired = 0;
  for (const item of root.questions) {
    const question = asRecord(item);
    if (!question) continue;
    const order = typeof question.order === 'number' ? question.order : undefined;
    const responseType = (order !== undefined && typeByOrder.get(order))
      || (typeof question.responseType === 'string' ? question.responseType : '');
    if (!responseType) continue;

    let changed = false;
    if (repairScaleLabels(question, responseType)) changed = true;
    if (stripUiProvidedOptions(question, responseType)) changed = true;
    if (repairEvidence(question, evidenceSources)) changed = true;
    if (fillMissingRationale(question)) changed = true;
    if (changed) repaired += 1;
  }
  return repaired;
}
