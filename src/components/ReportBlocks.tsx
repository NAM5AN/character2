import type { ReactNode } from 'react';

// 혼합 레이아웃용 구조화 블록. 상세 리포트 산문 섹션 사이에 끼워 나열·비교·단계를 시각화한다.
// 데이터(생성 optional)가 없으면 아무것도 렌더하지 않아 산문만 남는다.

type Compare = { wants: string[]; needs: string[] };
type MatchProfile = { best: string[]; worst: string[] };
type Manual = { gettingClose: string[]; avoid: string[]; affectionSignals: string[] };
type PressureStages = { normal: string; pressured: string; limit: string };

function nonEmpty(list?: string[]) {
  return Array.isArray(list) ? list.filter(item => typeof item === 'string' && item.trim()) : [];
}

function BlockLabel({ children }: { children: ReactNode }) {
  return <div className="block-label">{children}</div>;
}

function Bullets({ items }: { items: string[] }) {
  return <ul>{items.map((item, index) => <li key={`${index}-${item.slice(0, 12)}`}>{item}</li>)}</ul>;
}

// 사용설명서 아이콘 — 포인트컬러 단색 인라인 SVG(currentColor로 --report-point를 따라감).
// 직접 만든 SVG로 교체하려면 각 값의 <path>/도형만 바꾸면 된다(색은 currentColor 유지).
const MANUAL_ICONS: Record<'close' | 'avoid' | 'signal', ReactNode> = {
  // 친해지는 법 — 웃는 얼굴(다가감·호의)
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>,
  // 하면 안 되는 것 — 금지 표시
  avoid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></svg>,
  // 좋아·신뢰 신호 — 하트
  signal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20s-6.5-4.35-8.5-8.2C2 8.5 3.6 5.5 6.6 5.5c1.9 0 3 1.1 3.6 2.2h1.6c.6-1.1 1.7-2.2 3.6-2.2 3 0 4.6 3 3.1 6.3C18.5 15.65 12 20 12 20z" /></svg>,
};

// 원하는 것 vs 정말 필요한 것 (2단 비교) — innerMechanics 섹션에 배치
export function DesireGapBlock({ data }: { data?: Compare }) {
  const wants = nonEmpty(data?.wants);
  const needs = nonEmpty(data?.needs);
  if (!wants.length || !needs.length) return null;
  return <div className="report-block">
    <BlockLabel>원하는 것 vs 정말 필요한 것</BlockLabel>
    <div className="compare-2">
      <div className="col"><h4>본인이 원한다고 느끼는 것</h4><Bullets items={wants} /></div>
      <div className="col pos"><h4>실제로 필요한 것</h4><Bullets items={needs} /></div>
    </div>
  </div>;
}

// 잘 맞는 상대 / 최악의 상대 (2단 비교) — attachmentStyle 섹션에 배치
export function MatchProfileBlock({ data }: { data?: MatchProfile }) {
  const best = nonEmpty(data?.best);
  const worst = nonEmpty(data?.worst);
  if (!best.length || !worst.length) return null;
  return <div className="report-block">
    <BlockLabel>잘 맞는 상대 vs 최악의 상대</BlockLabel>
    <div className="compare-2">
      <div className="col pos"><h4>잘 맞는 상대</h4><Bullets items={best} /></div>
      <div className="col"><h4>최악의 상대</h4><Bullets items={worst} /></div>
    </div>
  </div>;
}

// 캐릭터 사용설명서 (3칸 불렛) — relationshipStyle 섹션에 배치
export function RelationshipManualBlock({ data }: { data?: Manual }) {
  const gettingClose = nonEmpty(data?.gettingClose);
  const avoid = nonEmpty(data?.avoid);
  const affectionSignals = nonEmpty(data?.affectionSignals);
  if (!gettingClose.length && !avoid.length && !affectionSignals.length) return null;
  return <div className="report-block">
    <BlockLabel>캐릭터 사용설명서</BlockLabel>
    <div className="manual-3">
      <div className="bucket"><h4><span className="ic">{MANUAL_ICONS.close}</span>친해지는 법</h4><Bullets items={gettingClose} /></div>
      <div className="bucket warn"><h4><span className="ic">{MANUAL_ICONS.avoid}</span>하면 안 되는 것</h4><Bullets items={avoid} /></div>
      <div className="bucket"><h4><span className="ic">{MANUAL_ICONS.signal}</span>좋아·신뢰 신호</h4><Bullets items={affectionSignals} /></div>
    </div>
  </div>;
}

// 평상시 → 압박 → 한계 (3단계 진행) — conflictStyleDetailed 섹션에 배치
export function PressureStagesBlock({ data }: { data?: PressureStages }) {
  if (!data?.normal?.trim() || !data?.pressured?.trim() || !data?.limit?.trim()) return null;
  return <div className="report-block">
    <BlockLabel>압박이 커질수록</BlockLabel>
    <div className="progression">
      <div className="step"><div className="stage"><span className="n">1</span>평상시</div><p>{data.normal}</p></div>
      <div className="step"><div className="stage"><span className="n">2</span>압박</div><p>{data.pressured}</p></div>
      <div className="step"><div className="stage"><span className="n">3</span>한계</div><p>{data.limit}</p></div>
    </div>
  </div>;
}
