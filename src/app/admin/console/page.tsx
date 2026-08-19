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
  summaryCostUsd: number | string | null;
  detailCostUsd: number | string | null;
  summaryGptInTok: number | string | null;
  summaryGptOutTok: number | string | null;
  detailGptInTok: number | string | null;
  detailGptOutTok: number | string | null;
  summaryGenMs: number | string | null;
  detailGenMs: number | string | null;
};

// 생성 소요시간(ms) → 사람이 읽는 문자열. 없으면 '—'.
function fmtDuration(ms: number | string | null): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s}초`;
}

type AdminSettings = {
  postypeUrl: string;
  accessCode: string;
  codeVersion: number;
  hasHash: boolean;
};

// Vercel AI Gateway 잔액 상태.
type GatewayBalance =
  | { state: 'loading' }
  | { state: 'ready'; balance: number | null; totalUsed: number | null; fetchedAt: string; refreshing?: boolean }
  | { state: 'error'; detail: string };

// 달러 금액 표시($1,234.56). 잔액은 게이트웨이가 달러로 집계한다.
function fmtUsd(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// AI 생성 실패 로그.
type FailureGroup = { stage: string; errorCode: string; count: number; lastSeen: string };
type FailureRow = {
  id: number; createdAt: string; stage: string; shareCode: string | null;
  errorCode: string; errorDetail: string | null; characterName: string | null; ownerName: string | null;
};
type StuckRow = {
  id: string; startedAt: string; stage: string; shareCode: string | null;
  minutesStuck: number; characterName: string | null; ownerName: string | null;
};
type RetryGroup = { stage: string; errorCode: string; count: number; lastSeen: string; sampleDetail: string | null };
type FailuresData = {
  total24h: number; total7d: number; rollup: FailureGroup[]; recent: FailureRow[]; stuck: StuckRow[];
  retry24h?: number; retries?: RetryGroup[];
};
type FailuresState =
  | { state: 'loading' }
  | { state: 'ready'; data: FailuresData }
  | { state: 'error'; detail: string };

// 재시도 사유 코드 → 읽을 수 있는 설명. 재시도는 프롬프트를 통째로 다시 보내므로 비용이 두 배가 된다.
function retryLabel(code: string) {
  if (code === 'RETRY_TRUNCATED') return '출력이 상한에 잘림';
  if (code === 'RETRY_SCHEMA') return 'JSON 구조 검증 실패';
  if (code === 'RETRY_SUMMARY_TOO_SHORT') return '요약 필드가 너무 짧음';
  if (code === 'RETRY_SUMMARY_FORMAT') return '요약 문단 형식 오류';
  if (code === 'RETRY_INSIGHT_QUALITY') return 'insight 품질 기준 미달';
  return code;
}

// 일별 비용 추이.
type DayCost = {
  date: string; claudeCostUsd: number | string;
  gptInTok: number | string; gptOutTok: number | string; sessions: number;
};
type CostState =
  | { state: 'loading' }
  | { state: 'ready'; days: DayCost[] }
  | { state: 'error'; detail: string };

// 하루 총비용(USD) = Claude 실측 + gpt 추정. 캐릭터별 카드와 동일한 gptCost/GPT_RATE 사용.
function dayCostUsd(d: DayCost): number {
  return Number(d.claudeCostUsd || 0) + gptCost(d.gptInTok, d.gptOutTok);
}

// 내부 stage 코드 → 사람이 읽는 단계 이름. 동적 코드(questions_3_6, detail_stage_2)도 처리.
function stageLabel(stage: string): string {
  if (stage === 'profile_image') return '프로필 이미지 분석';
  if (stage === 'profile_parse') return '프로필 해석';
  if (stage === 'summary_psychology') return '요약 · 심리분석';
  if (stage === 'summary_teaser') return '요약 · 작성';
  if (stage.startsWith('questions')) return '질문 생성';
  if (stage === 'detail_stage_1') return '상세 · 1단계';
  if (stage === 'detail_stage_rest') return '상세 · 나머지';
  const m = stage.match(/^detail_stage_(\d+)$/);
  if (m) return `상세 · ${m[1]}단계`;
  if (stage.startsWith('detail')) return '상세 리포트';
  return stage;
}

// 짧은 상대 시간(방금 / N분 전 / N시간 전 / 날짜).
function fmtAgo(value: string): string {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

// gpt-5.6-luna 단가 (Vercel 게이트웨이 = OpenAI, 마크업 없음). 단가 바뀌면 여기만 고치면 됨.
const GPT_RATE = { input: 0.20, output: 1.20 }; // $/1M tokens
function gptCost(inTok: number | string | null, outTok: number | string | null): number {
  return (Number(inTok || 0) * GPT_RATE.input + Number(outTok || 0) * GPT_RATE.output) / 1_000_000;
}
// 요약/상세 총 비용 = Claude(실측) + gpt(추정).
function summaryTotalCost(c: AdminCharacter): number {
  return Number(c.summaryCostUsd || 0) + gptCost(c.summaryGptInTok, c.summaryGptOutTok);
}
function detailTotalCost(c: AdminCharacter): number {
  return Number(c.detailCostUsd || 0) + gptCost(c.detailGptInTok, c.detailGptOutTok);
}

// 생성된 리포트(요약 + 상세)의 총 글자수.
function reportChars(c: AdminCharacter): number {
  let n = (c.oneLineSummary || '').length;
  if (c.summary) {
    for (const k of ['outerSelf', 'innerSelf', 'conflictStyle', 'affectionStyle', 'misunderstoodPoint', 'hiddenPattern'] as const) {
      n += (c.summary[k] || '').length;
    }
  }
  if (c.detailReport) {
    for (const v of Object.values(c.detailReport)) {
      if (typeof v === 'string') n += v.length;
    }
  }
  return n;
}

// 환율(원/달러). 원가는 달러로 집계·저장되고, 표시만 원화로 환산한다. 환율은 여기 한 곳만 바꾸면 됨.
const USD_TO_KRW = 1400;
function fmtCost(usd: number | string | null): string {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return '0원';
  return `${Math.round(n * USD_TO_KRW).toLocaleString('ko-KR')}원`;
}

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
  const [resetting, setResetting] = useState('');
  const [regenBusy, setRegenBusy] = useState('');
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  // Owner settings: current 결제코드(이용코드) + Postype URL.
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [postypeInput, setPostypeInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // Vercel AI Gateway 크레딧 잔액(달러). 0이면 AI 호출이 전부 402로 실패한다.
  const [balance, setBalance] = useState<GatewayBalance>({ state: 'loading' });

  const loadBalance = useCallback(async () => {
    setBalance(prev => (prev.state === 'ready' ? { ...prev, refreshing: true } : { state: 'loading' }));
    try {
      const res = await fetch('/api/admin/gateway-balance', { cache: 'no-store' });
      if (res.status === 401) { setStatus('denied'); return; }
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        setBalance({ state: 'ready', balance: body.balance, totalUsed: body.totalUsed, fetchedAt: body.fetchedAt });
      } else {
        setBalance({ state: 'error', detail: body?.detail || body?.error || 'UNKNOWN' });
      }
    } catch {
      setBalance({ state: 'error', detail: 'NETWORK' });
    }
  }, []);

  useEffect(() => { void loadBalance(); }, [loadBalance]);

  // AI 생성 실패 로그(사용자 이탈과 직결되는 지점).
  const [failures, setFailures] = useState<FailuresState>({ state: 'loading' });
  const [showRecentFailures, setShowRecentFailures] = useState(false);

  const loadFailures = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/gen-failures', { cache: 'no-store' });
      if (res.status === 401) { setStatus('denied'); return; }
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.failures) setFailures({ state: 'ready', data: body.failures });
      else setFailures({ state: 'error', detail: body?.error || 'LOAD_FAILED' });
    } catch {
      setFailures({ state: 'error', detail: 'NETWORK' });
    }
  }, []);

  useEffect(() => { void loadFailures(); }, [loadFailures]);

  // 일별 비용 추이(최근 30일).
  const [costs, setCosts] = useState<CostState>({ state: 'loading' });

  const loadCosts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/daily-costs', { cache: 'no-store' });
      if (res.status === 401) { setStatus('denied'); return; }
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.costs?.days)) setCosts({ state: 'ready', days: body.costs.days });
      else setCosts({ state: 'error', detail: body?.error || 'LOAD_FAILED' });
    } catch {
      setCosts({ state: 'error', detail: 'NETWORK' });
    }
  }, []);

  useEffect(() => { void loadCosts(); }, [loadCosts]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/config', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      if (body?.settings) {
        setSettings(body.settings);
        setPostypeInput(body.settings.postypeUrl || '');
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  async function saveSettings(openPostype: boolean) {
    setSavingSettings(true);
    setSettingsMsg('');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode: codeInput.trim(), postypeUrl: postypeInput.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) { setStatus('denied'); return; }
      if (!res.ok) {
        setSettingsMsg(body?.error === 'ACCESS_CODE_TOO_SHORT' ? '코드는 4자 이상이어야 해요.' : `저장 실패: ${body?.error || 'UNKNOWN'}`);
        return;
      }
      const next: AdminSettings = body.settings;
      const changed = !!codeInput.trim() && next.accessCode !== settings?.accessCode;
      setSettings(next);
      setPostypeInput(next.postypeUrl || '');
      setCodeInput('');
      setSettingsMsg(changed ? `저장됨 · 코드 버전 ${next.codeVersion} · 포스타입 글도 새 코드로 바꿔주세요` : '저장됨');
      // 확인 시 포스타입 링크를 새 탭으로 띄워 글 수정을 잊지 않게 한다.
      if (openPostype && next.postypeUrl) window.open(next.postypeUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setSettingsMsg('네트워크 오류');
    } finally {
      setSavingSettings(false);
    }
  }

  async function copyCode() {
    const code = settings?.accessCode || '';
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

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

  async function resetReport(c: AdminCharacter, target: 'summary' | 'answers') {
    const label = target === 'summary' ? '상세 리포트를 삭제하고 요약까지 되돌릴까요?' : '요약·상세 리포트를 모두 삭제하고 질문응답 상태로 되돌릴까요?';
    if (!window.confirm(`${c.name}\n\n${label}\n(되돌릴 수 없어요)`)) return;
    setResetting(c.shareCode + ':' + target);
    setErrorText('');
    try {
      const res = await fetch(`/api/admin/data/${c.shareCode}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      if (res.status === 401) { setStatus('denied'); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorText(body?.error || 'RESET_FAILED');
        return;
      }
      await load();
    } finally {
      setResetting('');
    }
  }

  async function regenerateSummary(c: AdminCharacter) {
    if (!window.confirm(`${c.name}\n\n저장된 데이터로 요약 리포트를 현재 프롬프트로 다시 생성할까요?\n(상세 리포트는 함께 초기화됩니다. 30초~1분 소요)`)) return;
    setRegenBusy(c.shareCode);
    setErrorText('');
    try {
      const res = await fetch(`/api/admin/data/${c.shareCode}/regenerate-summary`, { method: 'POST' });
      if (res.status === 401) { setStatus('denied'); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorText(body?.error || 'REGEN_FAILED');
        return;
      }
      await load();
    } catch {
      setErrorText('NETWORK');
    } finally {
      setRegenBusy('');
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

  const balanceLow = balance.state === 'ready' && balance.balance != null && balance.balance <= 0;
  const balanceWarn = balance.state === 'ready' && balance.balance != null && balance.balance > 0 && balance.balance < 5;
  const balanceColor = balanceLow ? '#c0392b' : balanceWarn ? '#b8860b' : 'var(--fg, #111)';

  const stuckCount = failures.state === 'ready' ? (failures.data.stuck?.length ?? 0) : 0;
  const failuresActive = failures.state === 'ready' && (failures.data.total24h > 0 || stuckCount > 0);

  const costDays = costs.state === 'ready' ? costs.days : [];
  const costTotals = costDays.map(dayCostUsd);
  const costMax = costTotals.reduce((m, v) => Math.max(m, v), 0);
  const costSum = costTotals.reduce((s, v) => s + v, 0);
  const costToday = costTotals.length ? costTotals[costTotals.length - 1] : 0;
  const costAvg = costTotals.length ? costSum / costTotals.length : 0;

  return (
    <main className="container page">
      <div
        className="card"
        style={{
          padding: '14px 18px', marginBottom: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          background: balanceLow ? 'rgba(192,57,43,.08)' : balanceWarn ? 'rgba(184,134,11,.08)' : 'var(--paper)',
          border: `1px solid ${balanceLow ? 'rgba(192,57,43,.4)' : balanceWarn ? 'rgba(184,134,11,.4)' : 'var(--line)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>AI Gateway 잔액</span>
          {balance.state === 'loading' && <span className="muted" style={{ fontSize: 15 }}>조회 중…</span>}
          {balance.state === 'error' && (
            <span style={{ fontSize: 14, color: '#c0392b' }}>조회 실패 · {balance.detail}</span>
          )}
          {balance.state === 'ready' && (
            <>
              <a
                href="https://vercel.com/nam-s-projects4/~/ai-gateway"
                target="_blank"
                rel="noopener noreferrer"
                title="Vercel AI Gateway 대시보드 열기"
                style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: balanceColor, textDecoration: 'none' }}
              >
                {fmtUsd(balance.balance)}
              </a>
              {balance.balance != null && (
                <span className="muted" style={{ fontSize: 13 }}>
                  ≈ {Math.round(balance.balance * USD_TO_KRW).toLocaleString('ko-KR')}원
                </span>
              )}
              {balance.totalUsed != null && (
                <span className="muted" style={{ fontSize: 12 }}>누적 사용 {fmtUsd(balance.totalUsed)}</span>
              )}
              {balance.refreshing && <span className="muted" style={{ fontSize: 12 }}>갱신 중…</span>}
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {balanceLow && <span style={{ fontSize: 12, fontWeight: 800, color: '#c0392b' }}>⚠ 잔액 부족 — AI 호출이 실패합니다</span>}
          {balanceWarn && <span style={{ fontSize: 12, fontWeight: 800, color: '#b8860b' }}>⚠ 잔액이 적어요</span>}
          <button className="btn soft" style={{ padding: '6px 12px' }} onClick={() => void loadBalance()} disabled={balance.state === 'loading'}>
            새로고침
          </button>
          <a
            className="btn"
            style={{ padding: '6px 12px' }}
            href="https://vercel.com/nam-s-projects4/~/ai-gateway"
            target="_blank"
            rel="noopener noreferrer"
          >
            대시보드 · 충전
          </a>
        </div>
      </div>

      <div
        className="card"
        style={{
          padding: '16px 18px', marginBottom: 14,
          background: failuresActive ? 'rgba(192,57,43,.06)' : 'var(--paper)',
          border: `1px solid ${failuresActive ? 'rgba(192,57,43,.35)' : 'var(--line)'}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 16 }}>AI 생성 실패</strong>
            {failures.state === 'ready' && (
              <span className="muted" style={{ fontSize: 13 }}>
                최근 24시간 <b style={{ color: failuresActive ? '#c0392b' : 'inherit' }}>{failures.data.total24h}</b>건 · 7일 {failures.data.total7d}건
              </span>
            )}
            {failures.state === 'loading' && <span className="muted" style={{ fontSize: 13 }}>조회 중…</span>}
            {failures.state === 'error' && <span style={{ fontSize: 13, color: '#c0392b' }}>조회 실패 · {failures.detail}</span>}
          </div>
          <button className="btn soft" style={{ padding: '6px 12px' }} onClick={() => void loadFailures()} disabled={failures.state === 'loading'}>
            새로고침
          </button>
        </div>

        {failures.state === 'ready' && stuckCount > 0 && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(184,134,11,.45)', background: 'rgba(184,134,11,.10)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13, color: '#8a6400' }}>⏱ 멈춤 · 타임아웃 추정 {stuckCount}건</strong>
              <span className="muted" style={{ fontSize: 12 }}>6분 넘게 안 끝난 생성 (300초 제한 초과 = 강제 종료)</span>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {failures.data.stuck.map(k => (
                <div key={k.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                  <span className="tag" style={{ fontSize: 11, fontWeight: 800 }}>{stageLabel(k.stage)}</span>
                  {k.characterName && <span className="muted">· {k.characterName}{k.ownerName ? ` (${k.ownerName})` : ''}</span>}
                  {k.shareCode && <span className="tag" style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '.06em' }}>{k.shareCode}</span>}
                  <span className="muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{k.minutesStuck}분째 · {fmtAgo(k.startedAt)} 시작</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {failures.state === 'ready' && (failures.data.retries?.length ?? 0) > 0 && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>🔁 재시도 사유 · 7일</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                재시도는 프롬프트를 통째로 다시 보내 비용이 두 배가 돼요{typeof failures.data.retry24h === 'number' ? ` · 24시간 ${failures.data.retry24h}건` : ''}
              </span>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {failures.data.retries!.map(r => (
                <div key={`${r.stage}:${r.errorCode}`} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg,#fff)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                    <span className="tag" style={{ fontSize: 11, fontWeight: 800 }}>{stageLabel(r.stage)}</span>
                    <strong style={{ fontSize: 12 }}>{retryLabel(r.errorCode)}</strong>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{r.count}회</span>
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtAgo(r.lastSeen)}</span>
                  </div>
                  {r.sampleDetail && <p className="muted" style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word' }}>{r.sampleDetail}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {failures.state === 'ready' && failures.data.total7d === 0 && stuckCount === 0 && (failures.data.retries?.length ?? 0) === 0 && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>최근 7일간 생성 실패가 없어요. 👍</p>
        )}

        {failures.state === 'ready' && failures.data.total7d > 0 && (
          <>
            <p className="muted" style={{ margin: '10px 0 8px', fontSize: 12 }}>최근 7일 · 단계 × 오류별 (많은 순)</p>
            <div className="stack" style={{ gap: 6 }}>
              {failures.data.rollup.map((g, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                    <span className="tag" style={{ fontSize: 12, fontWeight: 800 }}>{stageLabel(g.stage)}</span>
                    <code style={{ fontSize: 12, color: '#c0392b', wordBreak: 'break-all' }}>{g.errorCode}</code>
                  </div>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    <b style={{ color: 'var(--fg,#111)' }}>{g.count}</b>건 · {fmtAgo(g.lastSeen)}
                  </span>
                </div>
              ))}
            </div>

            <button
              className="btn soft"
              style={{ padding: '6px 12px', marginTop: 12 }}
              onClick={() => setShowRecentFailures(v => !v)}
            >
              {showRecentFailures ? '개별 기록 접기' : `개별 기록 보기 (${failures.data.recent.length})`}
            </button>

            {showRecentFailures && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                {failures.data.recent.map(r => (
                  <div key={r.id} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="tag" style={{ fontSize: 11, fontWeight: 800 }}>{stageLabel(r.stage)}</span>
                      <code style={{ fontSize: 11, color: '#c0392b' }}>{r.errorCode}</code>
                      {r.characterName && <span className="muted" style={{ fontSize: 12 }}>· {r.characterName}{r.ownerName ? ` (${r.ownerName})` : ''}</span>}
                      {r.shareCode && <span className="tag" style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '.06em' }}>{r.shareCode}</span>}
                      <span className="muted" style={{ fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtAgo(r.createdAt)}</span>
                    </div>
                    {r.errorDetail && <p className="muted" style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word' }}>{r.errorDetail}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 16 }}>일별 비용 추이 <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>· 최근 30일 (KST)</span></strong>
          {costs.state === 'ready' && (
            <span className="muted" style={{ fontSize: 13 }}>
              합계 <b style={{ color: 'var(--fg,#111)' }}>{fmtCost(costSum)}</b> · 일평균 {fmtCost(costAvg)} · 오늘 {fmtCost(costToday)}
            </span>
          )}
          {costs.state === 'loading' && <span className="muted" style={{ fontSize: 13 }}>조회 중…</span>}
          {costs.state === 'error' && <span style={{ fontSize: 13, color: '#c0392b' }}>조회 실패 · {costs.detail}</span>}
        </div>

        {costs.state === 'ready' && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, marginTop: 16, overflowX: 'auto', paddingBottom: 2 }}>
              {costDays.map((d, i) => {
                const usd = costTotals[i];
                const h = costMax > 0 ? Math.max(usd > 0 ? 3 : 0, Math.round((usd / costMax) * 116)) : 0;
                const isToday = i === costDays.length - 1;
                return (
                  <div
                    key={d.date}
                    title={`${d.date} · ${fmtCost(usd)} · ${d.sessions}세션`}
                    style={{ flex: '1 0 8px', minWidth: 8, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }}
                  >
                    <div
                      style={{
                        width: '100%', height: h, borderRadius: '3px 3px 0 0',
                        background: isToday ? 'var(--accent, #6b4bff)' : usd > 0 ? 'rgba(107,75,255,.45)' : 'transparent',
                        border: usd > 0 ? '1px solid rgba(107,75,255,.55)' : '1px dashed var(--line)',
                        borderBottom: 'none',
                        transition: 'height .2s',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 11 }}>{costDays[0]?.date?.slice(5)}</span>
              <span className="muted" style={{ fontSize: 11 }}>{costDays[costDays.length - 1]?.date?.slice(5)} (오늘)</span>
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 11, lineHeight: 1.6 }}>
              막대에 마우스를 올리면 날짜·금액·세션 수가 보여요. Claude는 실측, GPT는 토큰 기준 추정이라 게이트웨이 청구액과 소폭 차이날 수 있어요.
            </p>
          </>
        )}
      </div>

      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Admin console · owner only</div>
          <h1 style={{ fontSize: 'clamp(38px,5vw,60px)', margin: '10px 0 12px' }}>저장된 캐릭터 관리</h1>
          <p style={{ margin: 0 }}>
            저장된 캐릭터 {characters?.length ?? 0}개 · 마지막 새로고침 {lastLoaded ? lastLoaded.toLocaleTimeString('ko-KR') : '—'}
          </p>
        </div>
        <div className="actions" style={{ marginTop: 4 }}>
          <button className="btn" onClick={() => { void load(); void loadBalance(); void loadFailures(); void loadCosts(); }}>새로고침</button>
          <button className="btn soft" onClick={() => void logout()}>로그아웃</button>
        </div>
      </div>

      <div className="card" style={{ padding: 22, marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 18 }}>결제코드 (이용코드)</strong>
          <span className="muted" style={{ fontSize: 12 }}>코드 버전 {settings?.codeVersion ?? '—'}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>현재 코드</span>
          {settings?.accessCode ? (
            <>
              <code style={{ fontSize: 20, fontWeight: 800, letterSpacing: '.06em', padding: '4px 12px', borderRadius: 10, background: 'var(--accent-soft)' }}>
                {settings.accessCode}
              </code>
              <button className="btn soft" style={{ padding: '6px 12px' }} onClick={() => void copyCode()}>{copied ? '복사됨' : '복사'}</button>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>
              {settings ? '이전에 설정된 코드라 평문 기록이 없어요. 아래에서 새 코드를 지정하면 이후로는 여기에 표시됩니다.' : '불러오는 중…'}
            </span>
          )}
        </div>

        <div className="stack" style={{ gap: 12, marginTop: 16 }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">새 코드로 변경 (비우면 코드 유지, 4자 이상)</label>
            <input
              className="input"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              placeholder="새 결제코드 입력"
              style={{ maxWidth: 320 }}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">포스타입 유료글 주소</label>
            <input
              className="input"
              value={postypeInput}
              onChange={e => setPostypeInput(e.target.value)}
              placeholder="https://posty.pe/..."
              style={{ maxWidth: 460 }}
            />
          </div>
        </div>

        <div className="actions" style={{ marginTop: 16, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void saveSettings(true)} disabled={savingSettings}>
            {savingSettings ? '저장 중…' : '확인 · 저장 후 포스타입 열기'}
          </button>
          <button className="btn soft" onClick={() => void saveSettings(false)} disabled={savingSettings}>
            저장만
          </button>
          {settings?.postypeUrl && (
            <a className="btn" href={settings.postypeUrl} target="_blank" rel="noopener noreferrer">포스타입 글 열기</a>
          )}
          {settingsMsg && <span className="muted" style={{ fontSize: 13 }}>{settingsMsg}</span>}
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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <span className="tag" style={{ fontSize: 12 }}>리포트 {reportChars(c).toLocaleString()}자</span>
                  <span className="tag" style={{ fontSize: 12 }}>요약 {fmtCost(summaryTotalCost(c))}</span>
                  <span className="tag" style={{ fontSize: 12 }}>상세 {fmtCost(detailTotalCost(c))}</span>
                  <span className="tag" style={{ fontSize: 12, fontWeight: 800 }}>합계 {fmtCost(summaryTotalCost(c) + detailTotalCost(c))}</span>
                  <span className="tag" style={{ fontSize: 12 }}>요약 생성 {fmtDuration(c.summaryGenMs)}</span>
                  <span className="tag" style={{ fontSize: 12 }}>상세 생성 {fmtDuration(c.detailGenMs)}</span>
                </div>
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

              <div style={{ marginTop: 20, padding: '14px 16px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper)' }}>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>테스트용 재생성</div>
                <p className="muted" style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.6 }}>
                  저장된 20개 답변으로 리포트를 현재 프롬프트로 다시 만듭니다. 답변을 다시 입력할 필요 없이 생성 과정을 빠르게 테스트할 수 있어요.
                </p>
                <div className="actions" style={{ marginTop: 0, flexWrap: 'wrap' }}>
                  <button className="btn primary" disabled={!!resetting || !!regenBusy} onClick={() => window.open(`/analyze?replay=${detailChar.shareCode}`, '_blank', 'noopener')}>
                    사용자 시점 요약 테스트 (제출부터)
                  </button>
                  <button className="btn" disabled={!!resetting || !!regenBusy} onClick={() => void regenerateSummary(detailChar)}>
                    {regenBusy === detailChar.shareCode ? '요약 생성 중…' : '요약 재생성 (관리자, 즉시)'}
                  </button>
                  <button className="btn" disabled={!!resetting || !!regenBusy} onClick={() => void resetReport(detailChar, 'summary')}>
                    {resetting === detailChar.shareCode + ':summary' ? '지우는 중…' : '상세만 삭제 (상세 재생성용)'}
                  </button>
                </div>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.6 }}>
                  · 사용자 시점: 새 탭에서 저장된 20답변으로 제출→요약 생성을 실제 유저처럼 테스트(테스트용 새 캐릭터가 생기니 확인 후 삭제). · 요약 재생성: 이 캐릭터의 요약을 즉시 다시 만듦(상세도 초기화). · 상세만 삭제 후 오너 브라우저에서 다시 열면 상세가 새로 생성돼요.
                </p>
              </div>

              <div className="actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
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
