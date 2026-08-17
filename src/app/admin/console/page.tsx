'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Summary = {
  outerSelf?: string; innerSelf?: string; conflictStyle?: string;
  affectionStyle?: string; misunderstoodPoint?: string; hiddenPattern?: string;
} | null;

type Inference = {
  id?: string; text?: string; confidence?: number;
  evidence?: string[]; evidenceIds?: string[];
  ownerVerdict?: string; ownerFeedback?: string;
};

type Answer = { order?: number; question?: string; answer?: string; reason?: string };

type AdminCharacter = {
  shareCode: string;
  name: string;
  ownerName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  analysisConfidence: number | null;
  publicProfile: string;
  secretProfile: string;
  oneLineSummary: string;
  summary: Summary;
  inferences: Inference[];
  answers: Answer[];
  detailReport: Record<string, unknown> | null;
  detailGeneratedAt: string | null;
};

const SUMMARY_LABELS: [keyof NonNullable<Summary>, string][] = [
  ['outerSelf', '겉모습 · 타인이 보는 인상'],
  ['innerSelf', '속마음 · 실제 동기'],
  ['conflictStyle', '갈등 · 감정 반응'],
  ['affectionStyle', '애정 · 관계 방식'],
  ['misunderstoodPoint', '오해받는 지점'],
  ['hiddenPattern', '숨은 패턴'],
];

const DETAIL_LABELS: [string, string][] = [
  ['characterOverview', '캐릭터 개요'],
  ['innerMechanics', '내면 메커니즘'],
  ['relationshipStyle', '관계 스타일'],
  ['attachmentStyle', '애착 스타일'],
  ['conflictStyleDetailed', '갈등 상세'],
  ['charmAndContradictions', '매력과 모순'],
  ['integratedReport', '통합 리포트'],
  ['detailedReport', '상세 리포트(구버전)'],
];

const VERDICT_LABEL: Record<string, string> = {
  confirmed: '오너 확인', ambiguous: '애매', rejected: '반려', unreviewed: '미검토',
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  const clean = (text || '').trim();
  if (!clean) return <p className="muted" style={{ margin: 0 }}>—</p>;
  return <p style={{ margin: 0, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{clean}</p>;
}

export default function AdminConsolePage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<AdminCharacter[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminCharacter | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/data', { cache: 'no-store' });
      if (res.status === 401) { setStatus('denied'); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus('error'); setErrorText(body?.error || 'LOAD_FAILED'); return; }
      setCharacters(Array.isArray(body.characters) ? body.characters : []);
      setStatus('ready');
      setLastLoaded(new Date());
    } catch {
      setStatus('error'); setErrorText('NETWORK');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live-ish: refetch whenever the tab regains focus, so changes made elsewhere
  // (e.g. new characters added/removed via GPT) show up on return.
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const filtered = useMemo(() => {
    const list = characters || [];
    const q = query.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!q) return list;
    return list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.ownerName || '').toLowerCase().includes(q) ||
      (c.shareCode || '').toLowerCase().includes(q)
    );
  }, [characters, query]);

  async function logout() {
    await fetch('/api/admin/session', { method: 'DELETE' }).catch(() => {});
    router.push('/');
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/data/${pendingDelete.shareCode}`, { method: 'DELETE' });
      if (res.status === 401) { setStatus('denied'); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorText(body?.error || 'DELETE_FAILED');
        return;
      }
      setCharacters(prev => (prev || []).filter(c => c.shareCode !== pendingDelete.shareCode));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (status === 'loading') {
    return <main className="container page"><p className="loading"><span className="dot" /><span className="dot" /><span className="dot" /> 불러오는 중…</p></main>;
  }

  if (status === 'denied') {
    return (
      <main className="container page">
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h1 style={{ fontSize: 'clamp(38px,5vw,60px)' }}>세션이 없어요</h1>
          <p>관리자 세션이 만료되었거나 없습니다. 홈에서 다시 접근해주세요.</p>
        </div>
        <Link className="btn primary" href="/">홈으로</Link>
      </main>
    );
  }

  return (
    <main className="container page">
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Admin console · owner only</div>
          <h1 style={{ fontSize: 'clamp(38px,5vw,60px)', margin: '10px 0 12px' }}>저장된 캐릭터 관리</h1>
          <p style={{ margin: 0 }}>
            저장된 캐릭터 {characters?.length ?? 0}개 · 마지막 새로고침 {lastLoaded ? lastLoaded.toLocaleTimeString('ko-KR') : '—'}
          </p>
        </div>
        <div className="actions" style={{ marginTop: 4 }}>
          <button className="btn" onClick={() => void load()}>새로고침</button>
          <button className="btn soft" onClick={() => void logout()}>로그아웃</button>
        </div>
      </div>

      {status === 'error' && <p className="error">불러오기 실패: {errorText}</p>}

      <div className="field" style={{ maxWidth: 420, marginTop: 4 }}>
        <input
          className="input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="캐릭터명 · 오너명 · 공유코드로 검색"
        />
      </div>

      {filtered.length === 0 && <p className="muted">표시할 캐릭터가 없어요.</p>}

      <div className="stack" style={{ marginTop: 8 }}>
        {filtered.map(c => {
          const open = expanded === c.shareCode;
          return (
            <div className="card" key={c.shareCode} style={{ padding: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 22, letterSpacing: '-.02em' }}>{c.name || '(이름 없음)'}</strong>
                    <span className="muted">오너 · {c.ownerName || '—'}</span>
                    <span className="tag" style={{ fontFamily: 'monospace', letterSpacing: '.08em' }}>{c.shareCode}</span>
                  </div>
                  <p className="muted" style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
                    {c.oneLineSummary || '한 줄 요약 없음'}
                  </p>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    생성 {fmtDate(c.createdAt)} · 수정 {fmtDate(c.updatedAt)}
                    {c.analysisConfidence != null && ` · 신뢰도 ${c.analysisConfidence}`}
                    {c.detailReport ? ' · 상세리포트 있음' : ' · 상세리포트 없음'}
                  </p>
                </div>
                <div className="actions" style={{ marginTop: 0 }}>
                  <button className="btn" onClick={() => setExpanded(open ? null : c.shareCode)}>
                    {open ? '접기' : '자세히'}
                  </button>
                  <button className="btn danger" onClick={() => setPendingDelete(c)}>삭제</button>
                </div>
              </div>

              {open && (
                <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <Section title="공개 프로필"><Prose text={c.publicProfile} /></Section>
                  <Section title="비밀 프로필"><Prose text={c.secretProfile} /></Section>

                  <Section title="요약 리포트">
                    <p style={{ margin: '0 0 12px', fontWeight: 800 }}>{c.oneLineSummary || '—'}</p>
                    <div className="result-grid" style={{ marginTop: 0 }}>
                      {SUMMARY_LABELS.map(([key, label]) => (
                        <div className="result-block" key={key}>
                          <h3 style={{ fontSize: 15 }}>{label}</h3>
                          <Prose text={(c.summary?.[key] as string) || ''} />
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section title={`추론 (${c.inferences?.length || 0}개)`}>
                    {(c.inferences || []).length === 0 && <p className="muted" style={{ margin: 0 }}>—</p>}
                    {(c.inferences || []).map((inf, i) => (
                      <div className="inference" key={inf.id || i}>
                        <div className="inference-top">
                          <p style={{ fontWeight: 700 }}>{inf.text || '—'}</p>
                          <span className="tag" style={{ whiteSpace: 'nowrap' }}>
                            {VERDICT_LABEL[inf.ownerVerdict || 'unreviewed'] || inf.ownerVerdict}
                            {typeof inf.confidence === 'number' && ` · ${inf.confidence}`}
                          </span>
                        </div>
                        {inf.ownerFeedback && <p className="muted" style={{ margin: '6px 0 0' }}>오너 메모: {inf.ownerFeedback}</p>}
                        {Array.isArray(inf.evidence) && inf.evidence.length > 0 && (
                          <div className="pills">{inf.evidence.map((e, j) => <span className="pill" key={j}>{e}</span>)}</div>
                        )}
                      </div>
                    ))}
                  </Section>

                  <Section title={`질문 응답 (${c.answers?.length || 0}개)`}>
                    {(c.answers || []).length === 0 && <p className="muted" style={{ margin: 0 }}>—</p>}
                    {(c.answers || []).map((a, i) => (
                      <div className="inference" key={a.order ?? i}>
                        <p style={{ fontWeight: 700, margin: 0 }}>{a.order ? `${a.order}. ` : ''}{a.question || '—'}</p>
                        <p style={{ margin: '6px 0 0', lineHeight: 1.6 }}>{a.answer || '—'}</p>
                        {a.reason && <p className="muted" style={{ margin: '4px 0 0' }}>이유: {a.reason}</p>}
                      </div>
                    ))}
                  </Section>

                  <Section title="상세 리포트">
                    {!c.detailReport && <p className="muted" style={{ margin: 0 }}>아직 생성되지 않았어요.</p>}
                    {c.detailReport && (
                      <>
                        <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>생성 {fmtDate(c.detailGeneratedAt)}</p>
                        <div className="stack" style={{ gap: 14 }}>
                          {DETAIL_LABELS.map(([key, label]) => {
                            const value = c.detailReport?.[key];
                            if (typeof value !== 'string' || !value.trim()) return null;
                            return (
                              <div className="result-block" key={key}>
                                <h3 style={{ fontSize: 15 }}>{label}</h3>
                                <Prose text={value} />
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </Section>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>이 캐릭터를 삭제할까요?</h3>
            <p>
              <strong>{pendingDelete.name}</strong>{pendingDelete.ownerName ? ` · 오너 ${pendingDelete.ownerName}` : ''}
              {' '}({pendingDelete.shareCode})의 프로필·질문응답·리포트가 모두 영구 삭제됩니다. 되돌릴 수 없어요.
            </p>
            <div className="actions">
              <button className="btn danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? '삭제 중…' : '영구 삭제'}
              </button>
              <button className="btn" onClick={() => setPendingDelete(null)} disabled={deleting}>취소</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
