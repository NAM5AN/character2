// 상세 리포트 소항목 제목 폴백 문구. 생성 측(report-paragraph-leads)과 렌더 측
// (stored-detail-paragraph-guides)이 같은 목록을 사용한다. 문장형 안내문이 아니라
// 짧은 명사형/단문형 제목만 둬서 소항목 위계가 일관되게 보이도록 한다.
export const REPORT_FIELDS = [
  'characterOverview',
  'innerMechanics',
  'relationshipStyle',
  'attachmentStyle',
  'conflictStyleDetailed',
  'charmAndContradictions',
  'integratedReport',
] as const;

export type ReportField = typeof REPORT_FIELDS[number];

export const FALLBACK_LEADS: Record<ReportField, string[]> = {
  characterOverview: [
    '전체적인 인상',
    '겉으로 보이는 모습과 실제 내면',
    '자기 인식과 타인의 시선 사이의 격차',
    '자기 자신을 바라보는 방식',
    '타인의 인상과 어긋나는 지점',
    '과거 경험이 남긴 흔적',
    '숨겨진 성격의 결',
    '자기서술과 실제 행동의 차이',
    '행동을 움직이는 기본 동기',
    '반복되는 행동 습관',
    '설정 밖에서 드러나는 특성',
    '현재 태도의 형성 배경',
  ],
  innerMechanics: [
    '가장 깊은 욕구',
    '가장 깊은 두려움',
    '원하는 것과 실제로 필요한 것',
    '감정이 흔들릴 때 지키는 기준',
    '불편한 감정을 처리하는 방식',
    '스스로 인정하기 어려운 부분',
    '자기 행동을 납득하는 논리',
    '감정을 눌러두는 방식',
    '자기합리화의 구조',
    '반응 뒤에 숨은 보호 대상',
    '인정하기 싫은 마음의 향방',
    '평소와 다른 얼굴이 나오는 조건',
  ],
  relationshipStyle: [
    '처음 만난 사람을 대하는 태도',
    '관계의 거리가 가까워지는 조건',
    '가까운 사람 앞에서 달라지는 점',
    '주도권을 주고받는 방식',
    '사람을 믿는 기준',
    '관계를 오래 유지하는 방식',
    '싫어하는 사람을 대하는 태도',
    '기대는 쪽과 기대게 하는 쪽',
    '관계를 정리하는 기준',
    '유독 약해지는 상대',
    '가까워진 뒤 생기는 습관',
    '호의를 표현하는 방식',
  ],
  attachmentStyle: [
    '호감이 시작되는 순간',
    '친밀감이 깊어질수록 생기는 변화',
    '사랑받는다는 확신의 기준',
    '가까운 관계에서 바라는 것',
    '질투와 충돌의 방식',
    '오래된 관계에서 달라지는 점',
    '이별 뒤 감정을 정리하는 방식',
    '잘 맞는 상대의 조건',
    '질투가 드러나는 방식',
    '다툰 뒤 관계를 되돌리는 방식',
    '헤어짐 앞에서 드러나는 모습',
    '잘 맞는 상대와 어긋나는 상대',
  ],
  conflictStyleDetailed: [
    '갈등을 알아차리는 순간',
    '불편함이 침범으로 바뀌는 지점',
    '압박이 커질수록 드러나는 면',
    '한계에 몰렸을 때의 반응',
    '절대 양보하지 않는 기준',
    '자신과 타인에게 적용하는 잣대',
    '극한 상황에서의 선택',
    '불편함이 선을 넘는 지점',
    '압박이 길어질 때 먼저 무너지는 것',
    '끝까지 물러서지 않는 것',
    '거짓말을 허용하는 범위',
    '끝까지 몰렸을 때의 선택',
  ],
  charmAndContradictions: [
    '첫눈에 들어오는 매력',
    '상반된 모습이 공존하는 이유',
    '쉽게 오해받는 지점',
    '강점과 약점이 갈리는 지점',
    '알고 지낼수록 발견되는 면',
    '위험하지만 끌리는 부분',
    '여러 단서를 잇고 보이는 새로운 면',
    '호불호가 갈리는 지점',
    '겉과 속의 의외성',
    '오해와 실제 의도의 차이',
    '매력으로 작동하는 모순',
    '가까워질수록 선명해지는 특성',
  ],
  integratedReport: [
    '캐릭터를 관통하는 핵심 축',
    '욕구와 두려움의 연결',
    '감정과 자기보호의 연결',
    '관계와 갈등에서 반복되는 원리',
    '겉보기 모순을 잇는 구조',
    '반복되는 선택의 뿌리',
    '겉과 속을 잇는 축',
    '스스로 보지 못하는 지점',
    '관계와 갈등이 만나는 자리',
    '자기보호가 관계에 미치는 영향',
    '가장 쉽게 무너지는 조건',
    '전체 흐름에서 남는 핵심',
  ],
};

// 이미 쓴 제목은 건너뛰고, 모두 소진되면 번호를 붙여 최소한 서로 구분되게 한다.
export function pickFallbackLead(field: ReportField, paragraphIndex: number, used: Set<string>) {
  const candidates = FALLBACK_LEADS[field];
  const fresh = candidates.find(candidate => !used.has(candidate));
  if (fresh) { used.add(fresh); return fresh; }
  const base = candidates[paragraphIndex % candidates.length];
  for (let n = 2; n < 50; n += 1) {
    const numbered = `${base} ${n}`;
    if (!used.has(numbered)) { used.add(numbered); return numbered; }
  }
  return base;
}
