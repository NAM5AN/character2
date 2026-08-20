'use client';
import { Fragment, useState, type ReactNode } from 'react';
import type { FinalAnalysis } from '@/lib/schemas/character';
import type { CharacterReportPreview } from '@/lib/character-report';
import { applyName } from '@/lib/josa';

type UnknownRecord = Record<string, unknown>;
type SpectrumItem = { left: string; right: string; value: number };
type SummaryKey = keyof CharacterReportPreview['summary'];

function asRecord(v: unknown): UnknownRecord { return v && typeof v === 'object' ? v as UnknownRecord : {}; }
function strList(v: unknown): string[] { return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []; }

const MINI: Record<'close' | 'avoid' | 'signal', ReactNode> = {
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>,
  avoid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></svg>,
  signal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20s-6.5-4.35-8.5-8.2C2 8.5 3.6 5.5 6.6 5.5c1.9 0 3 1.1 3.6 2.2h1.6c.6-1.1 1.7-2.2 3.6-2.2 3 0 4.6 3 3.1 6.3C18.5 15.65 12 20 12 20z" /></svg>,
};

function splitTopics(text: string) {
  return text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)
    .map(block => block.replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim())
    .filter(Boolean)
    .map(chunk => {
      const m = chunk.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
      return m ? { lead: m[1].trim(), body: m[2].trim() } : { lead: chunk, body: '' };
    });
}

// 본문 안의 **강조** 표기를 포인트컬러 하이라이트(mark)로 렌더한다.
// 문단 첫 안내문은 splitTopics 가 이미 떼어내므로, 여기 들어오는 건 본문 강조뿐이다.
// 짝이 맞지 않는 별표는 화면에 그대로 새지 않도록 지운다.
function renderInline(text: string): ReactNode {
  if (!text.includes('**')) return text;
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => (
    index % 2 === 1 ? <mark key={index}>{part}</mark> : part.replace(/\*\*/g, '')
  ));
}

function topicClass(index: number, total: number, key: string) {
  if (index === 0) return 'topic topic--hero';
  if (key === 'integratedReport') return 'topic topic--timeline';
  if (index === 3) return 'topic topic--feature';
  if (index === total - 1 && total >= 7) return 'topic topic--wide';
  return 'topic';
}

function CompareStudy({ label, aTitle, a, bTitle, b, positive }: { label: string; aTitle: string; a: string[]; bTitle: string; b: string[]; positive: 'left' | 'right' }) {
  if (!a.length || !b.length) return null;
  const left = <div className={positive === 'left' ? 'compare-positive' : ''}><h4>{aTitle}</h4><ul>{a.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  const right = <div className={positive === 'right' ? 'compare-positive' : ''}><h4>{bTitle}</h4><ul>{b.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return <aside className="study-block"><div className="study-label">{label}</div><div className="compare-grid">{left}{right}</div></aside>;
}

function ManualStudy({ data }: { data?: { gettingClose: string[]; avoid: string[]; affectionSignals: string[] } }) {
  const g = strList(data?.gettingClose), av = strList(data?.avoid), si = strList(data?.affectionSignals);
  if (!g.length && !av.length && !si.length) return null;
  const bucket = (icon: ReactNode, title: string, items: string[]) => <div><h4><span className="mini-icon">{icon}</span>{title}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return <aside className="study-block"><div className="study-label">캐릭터 사용설명서</div><div className="manual-grid">{bucket(MINI.close, '친해지는 법', g)}{bucket(MINI.avoid, '하면 안 되는 것', av)}{bucket(MINI.signal, '좋아·신뢰 신호', si)}</div></aside>;
}

function PressureStudy({ data }: { data?: { normal: string; pressured: string; limit: string } }) {
  if (!data?.normal?.trim() || !data?.pressured?.trim() || !data?.limit?.trim()) return null;
  const step = (n: string, title: string, body: string) => <div><span>{n}</span><h4>{title}</h4><p>{body}</p></div>;
  return <aside className="study-block"><div className="study-label">압박이 커질수록</div><div className="pressure-grid">{step('1', '평상시', data.normal)}{step('2', '압박', data.pressured)}{step('3', '한계', data.limit)}</div></aside>;
}

function SpectrumStudy({ items, label }: { items: SpectrumItem[]; label: string }) {
  if (!items.length) return null;
  return <aside className="study-block"><div className="study-label">{label}</div><div className="spectrums">{items.map((s, i) => <div className="spectrum-item" key={i}>
    <span className={`lbl left${s.value < 45 ? ' on' : ''}`}>{s.left}</span>
    <div className="spectrum-track"><span className="spectrum-dot" style={{ left: `${Math.max(0, Math.min(100, s.value))}%` }} /></div>
    <span className={`lbl right${s.value > 55 ? ' on' : ''}`}>{s.right}</span>
  </div>)}</div></aside>;
}

function sectionStudyBlocks(key: string, analysis: FinalAnalysis): { after: number; node: ReactNode }[] {
  const a = analysis as unknown as UnknownRecord;
  const out: { after: number; node: ReactNode }[] = [];
  const spec = a[`${key}Spectrums`] as SpectrumItem[] | undefined;
  if (Array.isArray(spec) && spec.length) out.push({ after: 0, node: <SpectrumStudy items={spec} label="성향 한눈에" /> });
  if (key === 'innerMechanics' && analysis.desireGap) out.push({ after: 2, node: <CompareStudy label="원하는 것 vs 정말 필요한 것" aTitle="본인이 원한다고 느끼는 것" a={strList(analysis.desireGap.wants)} bTitle="실제로 필요한 것" b={strList(analysis.desireGap.needs)} positive="right" /> });
  if (key === 'relationshipStyle' && analysis.relationshipManual) out.push({ after: 2, node: <ManualStudy data={analysis.relationshipManual} /> });
  if (key === 'attachmentStyle' && analysis.matchProfile) out.push({ after: 3, node: <CompareStudy label="잘 맞는 상대 vs 최악의 상대" aTitle="잘 맞는 상대" a={strList(analysis.matchProfile.best)} bTitle="최악의 상대" b={strList(analysis.matchProfile.worst)} positive="left" /> });
  if (key === 'conflictStyleDetailed' && analysis.pressureStages) out.push({ after: 2, node: <PressureStudy data={analysis.pressureStages} /> });
  return out;
}

type SectionMeta = { key: keyof FinalAnalysis; no: string; kicker: string; title: string };
export const SECTION_META: SectionMeta[] = [
  { key: 'characterOverview', no: '01', kicker: 'OVERVIEW', title: '{name}는 이런 캐릭터예요' },
  { key: 'innerMechanics', no: '02', kicker: 'INNER MECHANICS', title: '{name}는 이렇게 작동해요' },
  { key: 'relationshipStyle', no: '03', kicker: 'RELATIONSHIP', title: '{name}는 이렇게 관계를 맺어요' },
  { key: 'attachmentStyle', no: '04', kicker: 'ATTACHMENT', title: '{name}는 이런 애착이 있어요' },
  { key: 'conflictStyleDetailed', no: '05', kicker: 'CONFLICT', title: '{name}는 이렇게 갈등해요' },
  { key: 'charmAndContradictions', no: '06', kicker: 'CHARM', title: '{name}에겐 이런 매력이 있어요' },
  { key: 'integratedReport', no: '07', kicker: 'INTEGRATED', title: '통합 리포트' },
];

function MagazineSection({ meta, name, analysis }: { meta: SectionMeta; name: string; analysis: FinalAnalysis }) {
  const [open, setOpen] = useState(true);
  const a = analysis as unknown as UnknownRecord;
  const text = a[meta.key] as string | undefined;
  if (!text?.trim()) return null;
  const topics = splitTopics(text);
  const total = topics.length;
  const tags = strList(a[`${meta.key}Tags`]).concat(strList(asRecord(a.sectionTags)[meta.key])).slice(0, 4);
  const uniqueTags = Array.from(new Set(tags));
  const tldr = a[`${meta.key}Tldr`] as string | undefined;
  const blocks = sectionStudyBlocks(String(meta.key), analysis);
  return <section className={`report-section${open ? ' is-open' : ''}`}>
    <header className="section-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
      <div className="section-number">{meta.no}</div>
      <div>
        <div className="section-kicker">{meta.kicker}</div>
        <h3>{applyName(meta.title, name)}</h3>
        {tldr?.trim() ? <p className="section-tldr">{tldr}</p> : null}
        {uniqueTags.length ? <div className="section-tags">{uniqueTags.map((t, i) => <span key={i}>#{t}</span>)}</div> : null}
      </div>
      <span className="section-chev" aria-hidden="true">▾</span>
    </header>
    {open && <div className="topic-grid">
      {topics.map((topic, index) => <Fragment key={`${index}-${topic.lead.slice(0, 10)}`}>
        <article className={topicClass(index, total, String(meta.key))}>
          <div className="topic-no">{String(index + 1).padStart(2, '0')}</div>
          <div className="topic-content"><h4>{topic.lead}</h4>{topic.body ? <p>{renderInline(topic.body)}</p> : null}</div>
        </article>
        {blocks.filter(b => b.after === index).map((b, bi) => <Fragment key={`blk-${index}-${bi}`}>{b.node}</Fragment>)}
      </Fragment>)}
    </div>}
  </section>;
}

const PAGES: { no: string; kicker: string; heading: string; secs: number[] }[] = [
  { no: '01', kicker: 'CORE / INNER MECHANICS', heading: '{name}는 어떤 사람인가요?', secs: [0, 1] },
  { no: '02', kicker: 'RELATIONSHIP / ATTACHMENT / CONFLICT', heading: '{name}는 관계에서 어떻게 움직이나요?', secs: [2, 3, 4] },
  { no: '03', kicker: 'CHARM / INTEGRATED', heading: '{name}의 모순과 방향을 함께 봅니다', secs: [5, 6] },
];

export function DetailMagazinePage({ page, name, analysis, endNote }: { page: number; name: string; analysis: FinalAnalysis; endNote?: string }) {
  const p = PAGES[page - 1];
  if (!p) return null;
  return <div className="report-mag"><article className="sheet">
    <header className="sheet-header">
      <div className="sheet-page-no">{p.no}</div>
      <div><div className="sheet-kicker">{p.kicker}</div><h2>{applyName(p.heading, name)}</h2></div>
    </header>
    {p.secs.map(si => <MagazineSection key={String(SECTION_META[si].key)} meta={SECTION_META[si]} name={name} analysis={analysis} />)}
    {page >= 3 && endNote?.trim() ? <section className="end-note"><small>FINAL SENTENCE</small><p>{endNote}</p></section> : null}
  </article></div>;
}

function summaryFirstSentence(field?: string) {
  if (!field) return '';
  const body = field.replace(/^\s*\*\*.+?\*\*\s*/su, '').replace(/\s+/g, ' ').trim();
  const cut = body.search(/[.?!]\s|[.?!]$/u);
  const one = cut >= 0 ? body.slice(0, cut + 1) : body;
  return one.length > 82 ? `${one.slice(0, 80).trimEnd()}…` : one;
}

const SUMMARY_CARDS: { key: SummaryKey; label: string }[] = [
  { key: 'outerSelf', label: '겉으로 보이는 모습' },
  { key: 'innerSelf', label: '실제 내면' },
  { key: 'conflictStyle', label: '감정이 흔들리는 순간' },
  { key: 'affectionStyle', label: '관계에서 반복되는 패턴' },
  { key: 'misunderstoodPoint', label: '쉽게 오해받는 부분' },
  { key: 'hiddenPattern', label: '의외로 눈에 띄는 지점' },
];

export function ReportCover({ preview }: { preview: CharacterReportPreview }) {
  return <div className="report-mag"><section className="cover cover--summary-only">
    <div>
      <div className="cover-eyebrow">CHARACTER DETAIL REPORT</div>
      <h1>{preview.name}<span>정밀 캐릭터 분석</span></h1>
      {preview.oneLineSummary ? <p className="cover-quote">{preview.oneLineSummary}</p> : null}
    </div>
  </section></div>;
}

function SummaryFullText({ index, label, text }: { index: number; label: string; text: string }) {
  const paras = splitTopics(text);
  return <div className="summary-expanded">
    <div className="summary-expanded-head"><span>{String(index + 1).padStart(2, '0')}</span><h3>{label}</h3></div>
    <div className="summary-expanded-body">
      {paras.map((p, i) => <div className="summary-paragraph" key={i}><h4>{p.lead}</h4>{p.body ? <p>{renderInline(p.body)}</p> : null}</div>)}
    </div>
  </div>;
}

export function SummaryNotes({ preview }: { preview: CharacterReportPreview }) {
  const [mode, setMode] = useState<'glance' | 'read'>('glance');
  const [activeKey, setActiveKey] = useState<SummaryKey | null>(null);
  const cards = SUMMARY_CARDS.filter(card => preview.summary[card.key]?.trim());
  const activeIndex = activeKey ? cards.findIndex(card => card.key === activeKey) : -1;
  const activeCard = activeIndex >= 0 ? cards[activeIndex] : null;
  const activeText = activeCard ? preview.summary[activeCard.key] : '';

  return <div className="report-mag"><section className="sheet">
    <header className="summary-explorer-head">
      <h2>먼저, {preview.name}의 핵심을 한눈에 정리해볼게요.</h2>
      <div className="summary-view-toggle" aria-label="요약 보기 방식">
        <button type="button" className={mode === 'glance' ? 'is-active' : ''} onClick={() => setMode('glance')}>한눈에 보기</button>
        <button type="button" className={mode === 'read' ? 'is-active' : ''} onClick={() => setMode('read')}>전체 읽기</button>
      </div>
    </header>

    {mode === 'glance' ? <>
      <div className="summary-card-grid">
        {cards.map((card, index) => {
          const text = preview.summary[card.key] || '';
          // 카드 전용 한 문장이 있으면 그것을, 없으면(구버전) 본문 첫 문장으로 폴백.
          const cardLine = preview.summaryCardLines?.[card.key]?.trim() || summaryFirstSentence(text);
          const selected = activeKey === card.key;
          return <button type="button" className={`summary-card${selected ? ' is-active' : ''}`} key={card.key} onClick={() => setActiveKey(selected ? null : card.key)} aria-expanded={selected}>
            <div className="summary-card-top"><span className="summary-card-no">{String(index + 1).padStart(2, '0')}</span><h3>{card.label}</h3></div>
            <p className="summary-card-preview">{renderInline(cardLine)}</p>
            <span className="summary-card-hint">{selected ? '접기 ↑' : '자세히 보기 ↓'}</span>
          </button>;
        })}
      </div>
      {activeCard && activeText ? <SummaryFullText index={activeIndex} label={activeCard.label} text={activeText} /> : null}
    </> : <div className="summary-read-list">
      {cards.map((card, index) => {
        const text = preview.summary[card.key] || '';
        return text ? <article className="summary-read-item" key={card.key}><SummaryFullText index={index} label={card.label} text={text} /></article> : null;
      })}
    </div>}
  </section></div>;
}
