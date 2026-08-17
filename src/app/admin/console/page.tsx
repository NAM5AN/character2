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

function Prose({ text }: { text: string }) {
  const clean = (text || '').trim();
  if (!clean) return <p className="muted" style={{ margin: 0 }}>—</p>;
  return <p style={{ margin: 0, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{clean}</p>;
}

type SectionDef = { key: string; label: string; count?: number; empty: boolean; render: () => React.ReactNode };

function buildSections(c: AdminCharacter): SectionDef[] {
  const detailKeys = c.detailReport
    ? DETAIL_LABELS.filter(([k]) => typeof c.detailReport?.[k] === 'string' && (c.detailReport?.[k] as string).trim())
    : [];
  return [
    {
      key: 'public', label: '공개 프로필', empty: !c.publicProfile?.trim(),
      render: () => <Prose text={c.publicProfile} />,
    },
    {
      key: 'secret', label: '비밀 프로필', empty: !c.secretProfile?.trim(),
      render: () => <Prose text={c.secretProfile} />,
    },
    {
      key: 'summary', label: '요약 리포트', empty: !c.oneLineSummary?.trim() && !c.summary,
      render: () => (
        <>
          <p style={{ margin: '0 0 14px', fontWeight: 800, lineHeight: 1.6 }}>{c.oneLineSummary || '—'}</p>
          <div className="stack" style={{ gap: 12 }}>
            {SUMMARY_LABELS.map(([key, label]) => (
              <div className="result-block" key={key} style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{label}</h3>
                <Prose text={(c.summary?.[key] as string) || ''} />
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      key: 'inferences', label: '추론', count: c.inferences?.length || 0, empty: (c.inferences?.length || 0) === 0,
      render: () => (
        <>
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
        </>
      ),
    },
    {
      key: 'answers', label: '질문 응답', count: c.answers?.length || 0, empty: (c.answers?.length || 0) === 0,
      render: () => (
        <>
          {(c.answers || []).length === 0 && <p className="muted" style={{ margin: 0 }}>—</p>}
          {(c.answers || []).map((a, i) => (
            <div className="inference" key={a.order ?? i}>
              <p style={{ fontWeight: 700, margin: 0 }}>{a.order ? `${a.order}. ` : ''}{a.question || '—'}</p>
              <p style={{ margin: '6px 0 0', lineHeight: 1.6 }}>{a.answer || '—'}</p>
              {a.reason && <p className="muted" style={{ margin: '4px 0 0' }}>이유: {a.reason}</p>}
            </div>
          ))}
        </>
      ),
    },
    {
      key: 'detail', label: '상세 리포트', empty: !c.detailReport,
      render: () => (
        <>
          {!c.detailReport && <p className="muted" style={{ margin: 0 }}>아직 생성되지 않았어요.</p>}
          {c.detailReport && (
            <>
              <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>생성 {fmtDate(c.detailGeneratedAt)}</p>
              <div className="stack" style={{ gap: 12 }}>
                {detailKeys.map(([key, label]) => (
                  <div className="result-block" key={key} style={{ padding: 16 }}>
                    <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{label}</h3>
                    <Prose text={c.detailReport?.[key] as string} />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ),
    },
  ];
}

export default function AdminConsolePage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<AdminCharacter[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');
  const [query, setQuery] = useState('');
  const [detailChar, setDetailChar] = useState<AdminCharacter | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
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

  // Keep the open modal in sync with refreshed data; drop it if the character is gone.
  useEffect(() => {
    if (!detailChar || !characters) return;
    const fresh = characters.find(c => c.shareCode === detailChar.shareCode);
    if (!fresh) setDetailChar(null);
    else if (fresh !== detailChar) setDetailChar(fresh);
  }, [characters, detailChar]);

  // Close modals with Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingDelete) setPendingDelete(null);
      else if (detailChar) setDetailChar(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailChar, pendingDelete]);

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

  function openDetail(c: AdminCharacter) {
    setDetailChar(c);
    setOpenSection(null);
  }

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
      if (detailChar?.shareCode === pendingDelete.shareCode) setDetailChar(null);
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

  const sections = detailChar ? buildSections(detailChar) : [];

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
        {filtered.map(c => (
          <div className="card" key={c.shareCode} style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <button
                onClick={() => openDetail(c)}
                style={{ textAlign: 'left', background: 'transparent', border: 0, padding: 0, minWidth: 0, flex: 1, cursor: 'pointer' }}
                aria-label={`${c.name} 상세 열기`}
              >
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
              </button>
              <div className="actions" style={{ marginTop: 0 }}>
                <button className="btn" onClick={() => openDetail(c)}>자세히</button>
                <button className="btn danger" onClick={() => setPendingDelete(c)}>삭제</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {detailChar && (
        <div className="modal-backdrop" onClick={() => setDetailChar(null)}>
          <div
            className="modal"
            style={{ width: 'min(760px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 24, letterSpacing: '-.02em' }}>{detailChar.name || '(이름 없음)'}</strong>
                    <span className="muted">오너 · {detailChar.ownerName || '—'}</span>
                    <span className="tag" style={{ fontFamily: 'monospace', letterSpacing: '.08em' }}>{detailChar.shareCode}</span>
                  </div>
                  <p className="muted" style={{ margin: '8px 0 0', lineHeight: 1.6 }}>{detailChar.oneLineSummary || '한 줄 요약 없음'}</p>
                </div>
                <button className="btn" style={{ padding: '8px 12px' }} onClick={() => setDetailChar(null)} aria-label="닫기">✕</button>
              </div>
              <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>항목을 눌러 내용을 펼쳐보세요.</p>
            </div>

            <div style={{ overflow: 'auto', padding: '12px 16px 20px' }}>
              <div className="stack" style={{ gap: 8 }}>
                {sections.map(s => {
                  const open = openSection === s.key;
                  return (
                    <div key={s.key} style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--paper)' }}>
                      <button
                        onClick={() => setOpenSection(open ? null : s.key)}
                        style={{
                          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                          padding: '15px 18px', background: open ? 'var(--accent-soft)' : 'transparent', border: 0,
                          fontWeight: 800, fontSize: 15, textAlign: 'left', cursor: 'pointer',
                        }}
                        aria-expanded={open}
                      >
                        <span>
                          {s.label}
                          {s.count != null && <span className="muted" style={{ fontWeight: 700 }}> · {s.count}개</span>}
                          {s.empty && <span className="muted" style={{ fontWeight: 700 }}> · 없음</span>}
                        </span>
                        <span aria-hidden style={{ fontSize: 18, color: 'var(--muted)' }}>{open ? '−' : '+'}</span>
                      </button>
                      {open && (
                        <div style={{ padding: '4px 18px 20px', borderTop: '1px solid var(--line)' }}>
                          {s.render()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="actions" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
                <button className="btn danger" onClick={() => setPendingDelete(detailChar)}>이 캐릭터 삭제</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
