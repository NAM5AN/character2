'use client';

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';

type JsonMap = Record<string, unknown>;
type AuthState = 'checking' | 'signed-out' | 'signed-in';
type MainView = 'data' | 'settings';
type DetailTab = 'overview' | 'profiles' | 'analysis' | 'summary' | 'detail' | 'answers' | 'raw';

type AdminSettings = {
  postypeUrl: string;
  codeVersion: number;
  updatedAt?: string | null;
};

type CharacterListItem = {
  shareCode: string;
  name: string;
  ownerName?: string | null;
  status: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  analysisConfidence: number;
  oneLineSummary: string;
  hasSummary: boolean;
  hasDetail: boolean;
  detailStage: number;
  detailGeneratedAt?: string | null;
  paidUnlockedAt?: string | null;
  answerCount: number;
  publicProfileLength: number;
  privateProfileLength: number;
};

type CharacterListResponse = {
  items: CharacterListItem[];
  filteredTotal: number;
  limit: number;
  offset: number;
  metrics: {
    characters: number;
    withOwner: number;
    withSummary: number;
    withDetail: number;
  };
};

type AdminCharacterDetail = {
  character: {
    id: string;
    shareCode: string;
    name: string;
    ownerName?: string | null;
    status: string;
    schemaVersion: string;
    createdAt: string;
    updatedAt: string;
    paidUnlockedAt?: string | null;
    detailGeneratedAt?: string | null;
    analysisConfidence: number;
    engineVersions?: JsonMap;
  };
  profiles: {
    age?: unknown;
    gender?: unknown;
    publicProfileText: string;
    secretProfileText: string;
  };
  analysis: {
    traits: JsonMap;
    relationshipTraits: JsonMap;
    confirmedFacts: unknown[];
    aiInferences: unknown[];
    ownerReview: unknown;
    detailSeed: unknown;
    detailDossier: unknown;
  };
  summaryReport: {
    oneLineSummary: string;
    summary: JsonMap;
  };
  detailReport: JsonMap | null;
  answers: Array<{
    order: number;
    question: string;
    answer?: string | null;
    reason?: string | null;
    branchContext?: JsonMap;
    engineVersion?: string;
    createdAt?: string;
  }>;
  raw: JsonMap;
};

const DETAIL_TABS: Array<[DetailTab, string]> = [
  ['overview', '개요'],
  ['profiles', '입력 프로필'],
  ['analysis', '분석 내용'],
  ['summary', '요약 리포트'],
  ['detail', '상세 리포트'],
  ['answers', '20문항'],
  ['raw', '원본 JSON'],
];

const SUMMARY_LABELS: Record<string, string> = {
  outerSelf: '겉으로 보이는 모습',
  innerSelf: '실제 내면',
  conflictStyle: '감정이 흔들리는 순간',
  affectionStyle: '관계에서 반복되는 패턴',
  misunderstoodPoint: '쉽게 오해받는 부분',
  hiddenPattern: '의외로 눈에 띄는 지점',
};

const DETAIL_LABELS: Array<[string, string]> = [
  ['characterOverview', '이런 캐릭터예요'],
  ['innerMechanics', '이렇게 작동해요'],
  ['relationshipStyle', '이렇게 관계를 맺어요'],
  ['attachmentStyle', '이런 애착이 있어요'],
  ['conflictStyleDetailed', '이렇게 갈등해요'],
  ['charmAndContradictions', '이런 매력이 있어요'],
  ['integratedReport', '통합 리포트'],
  ['outerSelf', '겉으로 보이는 모습'],
  ['innerSelf', '실제 내면'],
  ['detailedReport', '통합 상세 해석'],
];

function isRecord(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function reportParagraphs(text: string) {
  return text
    .replace(/\r\n?/gu, '\n')
    .trim()
    .split(/\n{2,}/u)
    .map(block => block.replace(/[ \t]+/gu, ' ').replace(/\n+/gu, ' ').trim())
    .filter(Boolean);
}

function ReportText({ text }: { text: string }) {
  if (!text.trim()) return <EmptyState>저장된 내용이 없습니다.</EmptyState>;
  return (
    <div className="admin-report-copy">
      {reportParagraphs(text).map((paragraph, index) => {
        const lead = paragraph.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
        return (
          <p key={`${index}-${paragraph.slice(0, 22)}`}>
            {lead ? (
              <>
                <strong>{lead[1]}</strong>
                {lead[2] ? <> {lead[2]}</> : null}
              </>
            ) : paragraph}
          </p>
        );
      })}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="admin-empty">{children}</div>;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="admin-json">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

function SectionCard({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="admin-section-card">
      <div className="admin-section-head">
        <h3>{title}</h3>
        {note ? <span>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function MetaGrid({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="admin-meta-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function splitPrivateProfile(text: string) {
  const marker = text.match(/(?:^|\n{2,})\[외관 자료 관찰 메모[^\]]*\]\n?/u);
  if (!marker || marker.index === undefined) {
    return { secretProfile: text.trim(), appearanceNotes: '' };
  }
  return {
    secretProfile: text.slice(0, marker.index).trim(),
    appearanceNotes: text.slice(marker.index + marker[0].length).trim(),
  };
}

function objectEntries(value: unknown) {
  return isRecord(value) ? Object.entries(value) : [];
}

function FactList({ value }: { value: unknown }) {
  const facts = Array.isArray(value) ? value : [];
  if (!facts.length) return <EmptyState>저장된 확정 사실이 없습니다.</EmptyState>;
  return (
    <div className="admin-record-list">
      {facts.map((fact, index) => {
        const record = isRecord(fact) ? fact : {};
        return (
          <article key={`${index}-${textValue(record.key)}`}>
            <strong>{textValue(record.key || `사실 ${index + 1}`)}</strong>
            <p>{textValue(record.value ?? fact)}</p>
            {record.source ? <span>{textValue(record.source)}</span> : null}
          </article>
        );
      })}
    </div>
  );
}

function InferenceList({ value }: { value: unknown }) {
  const items = Array.isArray(value) ? value : [];
  if (!items.length) return <EmptyState>저장된 해석 후보가 없습니다.</EmptyState>;
  return (
    <div className="admin-record-list">
      {items.map((item, index) => {
        const record = isRecord(item) ? item : {};
        return (
          <article key={`${index}-${textValue(record.id)}`}>
            <div className="admin-record-title">
              <strong>{textValue(record.text || `해석 ${index + 1}`)}</strong>
              <span>{textValue(record.ownerVerdict || 'unreviewed')}</span>
            </div>
            {record.confidence !== undefined ? (
              <p>신뢰도 {textValue(record.confidence)}</p>
            ) : null}
            {Array.isArray(record.evidence) && record.evidence.length ? (
              <ul>
                {record.evidence.map((evidence, evidenceIndex) => (
                  <li key={evidenceIndex}>{textValue(evidence)}</li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function AdminDashboard() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [adminSecret, setAdminSecret] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mainView, setMainView] = useState<MainView>('data');
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [postypeUrl, setPostypeUrl] = useState('');
  const [newAccessCode, setNewAccessCode] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [listData, setListData] = useState<CharacterListResponse | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedCode, setSelectedCode] = useState('');
  const [detail, setDetail] = useState<AdminCharacterDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');

  const pageSize = listData?.limit || 30;
  const privateProfile = useMemo(
    () => splitPrivateProfile(detail?.profiles.secretProfileText || ''),
    [detail?.profiles.secretProfileText],
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setMessage('');
    try {
      const response = await fetch('/api/admin/session', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.authenticated !== true) {
        setAuthState('signed-out');
        return;
      }
      const nextSettings = body.settings as AdminSettings;
      setSettings(nextSettings);
      setPostypeUrl(nextSettings?.postypeUrl || '');
      setAuthState('signed-in');
      await loadCharacters('', 0, true);
    } catch {
      setAuthState('signed-out');
      setMessage('관리자 세션을 확인하지 못했어요.');
    }
  }

  async function handleUnauthorized() {
    setAuthState('signed-out');
    setListData(null);
    setDetail(null);
    setSelectedCode('');
    setMessage('관리자 세션이 만료됐어요. 다시 로그인해주세요.');
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminSecret }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(
          body.error === 'ADMIN_SECRET_INVALID'
            ? '관리자 비밀키가 일치하지 않아요.'
            : '로그인하지 못했어요.',
        );
        return;
      }
      const nextSettings = body.settings as AdminSettings;
      setSettings(nextSettings);
      setPostypeUrl(nextSettings?.postypeUrl || '');
      setAdminSecret('');
      setAuthState('signed-in');
      await loadCharacters('', 0, true);
    } catch {
      setMessage('로그인 요청 중 오류가 발생했어요.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/admin/session', { method: 'DELETE' }).catch(() => undefined);
    setAuthState('signed-out');
    setListData(null);
    setDetail(null);
    setSelectedCode('');
    setMessage('');
  }

  async function loadCharacters(
    search = appliedQuery,
    nextOffset = offset,
    autoSelect = false,
  ) {
    setListBusy(true);
    setMessage('');
    try {
      const params = new URLSearchParams({
        q: search,
        limit: '30',
        offset: String(nextOffset),
      });
      const response = await fetch(`/api/admin/characters?${params}`, {
        cache: 'no-store',
      });
      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage('캐릭터 목록을 불러오지 못했어요.');
        return;
      }
      const data = body as CharacterListResponse;
      setListData(data);
      setAppliedQuery(search);
      setOffset(nextOffset);

      const stillVisible = data.items.some(item => item.shareCode === selectedCode);
      if ((autoSelect || !stillVisible) && data.items[0]) {
        await loadDetail(data.items[0].shareCode);
      } else if (!data.items.length) {
        setSelectedCode('');
        setDetail(null);
      }
    } catch {
      setMessage('캐릭터 목록을 불러오는 중 오류가 발생했어요.');
    } finally {
      setListBusy(false);
    }
  }

  async function loadDetail(shareCode: string) {
    setSelectedCode(shareCode);
    setDetailBusy(true);
    setDetailTab('overview');
    try {
      const response = await fetch(`/api/admin/characters/${shareCode}`, {
        cache: 'no-store',
      });
      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage('캐릭터 상세 데이터를 불러오지 못했어요.');
        return;
      }
      setDetail(body as AdminCharacterDetail);
    } catch {
      setMessage('캐릭터 상세 데이터를 불러오는 중 오류가 발생했어요.');
    } finally {
      setDetailBusy(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void loadCharacters(query.trim(), 0, true);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!newAccessCode.trim()) return;
    setSettingsBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postypeUrl: postypeUrl.trim(),
          accessCode: newAccessCode.trim(),
        }),
      });
      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage('운영 설정을 저장하지 못했어요.');
        return;
      }
      const nextSettings = {
        postypeUrl: postypeUrl.trim(),
        codeVersion: Number(body.codeVersion) || (settings?.codeVersion || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      setSettings(nextSettings);
      setNewAccessCode('');
      setMessage(`설정을 저장했어요. 코드 버전 ${nextSettings.codeVersion}`);
    } catch {
      setMessage('운영 설정 저장 중 오류가 발생했어요.');
    } finally {
      setSettingsBusy(false);
    }
  }

  if (authState === 'checking') {
    return (
      <div className="admin-login-shell">
        <div className="card admin-login-card">
          <div className="loading">관리자 세션 확인 중 <i className="dot" /><i className="dot" /><i className="dot" /></div>
        </div>
      </div>
    );
  }

  if (authState === 'signed-out') {
    return (
      <div className="admin-login-shell">
        <form className="card admin-login-card" onSubmit={login}>
          <div className="eyebrow">Private administrator</div>
          <h1>데이터 관리</h1>
          <p>캐릭터의 공개·비밀 프로필과 분석 결과를 확인하는 운영자 전용 화면입니다.</p>
          <div className="field">
            <label className="label">관리자 비밀키</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={adminSecret}
              onChange={event => setAdminSecret(event.target.value)}
            />
          </div>
          <button className="btn primary" disabled={loginBusy || !adminSecret.trim()}>
            {loginBusy ? '확인 중…' : '관리자 로그인'}
          </button>
          {message ? <p className="admin-message error">{message}</p> : null}
        </form>
      </div>
    );
  }

  return (
    <>
      <header className="admin-dashboard-head">
        <div>
          <div className="eyebrow">Character2 database</div>
          <h1>데이터 관리</h1>
          <p>프로필 원문부터 무료 요약과 유료 상세 리포트까지 한곳에서 확인합니다.</p>
        </div>
        <div className="admin-head-actions">
          <button
            className={`btn ${mainView === 'data' ? 'primary' : ''}`}
            onClick={() => setMainView('data')}
          >데이터 조회</button>
          <button
            className={`btn ${mainView === 'settings' ? 'primary' : ''}`}
            onClick={() => setMainView('settings')}
          >운영 설정</button>
          <button className="btn" onClick={() => void logout()}>로그아웃</button>
        </div>
      </header>

      {message ? <div className="admin-message notice">{message}</div> : null}

      {mainView === 'settings' ? (
        <form className="card admin-settings" onSubmit={saveSettings}>
          <div className="admin-section-head">
            <h2>운영 설정</h2>
            <span>현재 코드 버전 {settings?.codeVersion ?? '—'}</span>
          </div>
          <div className="field">
            <label className="label">포스타입 유료글 주소</label>
            <input
              className="input"
              type="url"
              value={postypeUrl}
              onChange={event => setPostypeUrl(event.target.value)}
              placeholder="https://www.postype.com/..."
            />
          </div>
          <div className="field">
            <label className="label">새 이용 코드</label>
            <input
              className="input"
              type="password"
              minLength={4}
              maxLength={32}
              value={newAccessCode}
              onChange={event => setNewAccessCode(event.target.value)}
            />
            <span className="muted">현재 코드는 해시로 저장되어 다시 표시할 수 없습니다. 새 코드를 입력할 때만 교체됩니다.</span>
          </div>
          <div className="actions">
            <button className="btn primary" disabled={settingsBusy || !newAccessCode.trim()}>
              {settingsBusy ? '저장 중…' : '설정 저장'}
            </button>
          </div>
          <p className="muted">마지막 변경: {formatDate(settings?.updatedAt)}</p>
        </form>
      ) : (
        <>
          <section className="admin-metrics">
            <div><span>전체 캐릭터</span><strong>{listData?.metrics.characters ?? '—'}</strong></div>
            <div><span>오너명 저장</span><strong>{listData?.metrics.withOwner ?? '—'}</strong></div>
            <div><span>요약 리포트</span><strong>{listData?.metrics.withSummary ?? '—'}</strong></div>
            <div><span>상세 리포트</span><strong>{listData?.metrics.withDetail ?? '—'}</strong></div>
          </section>

          <form className="admin-search" onSubmit={search}>
            <input
              className="input"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="캐릭터 이름 · 오너명 · 공유 코드 검색"
            />
            <button className="btn primary" disabled={listBusy}>검색</button>
            <button
              type="button"
              className="btn"
              disabled={listBusy}
              onClick={() => {
                setQuery('');
                void loadCharacters('', 0, true);
              }}
            >전체 보기</button>
            <button
              type="button"
              className="btn"
              disabled={listBusy}
              onClick={() => void loadCharacters(appliedQuery, offset, false)}
            >새로고침</button>
          </form>

          <div className="admin-browser">
            <aside className="card admin-list-pane" aria-busy={listBusy}>
              <div className="admin-list-head">
                <strong>{listData?.filteredTotal ?? 0}개</strong>
                {appliedQuery ? <span>“{appliedQuery}” 검색 결과</span> : <span>최신순</span>}
              </div>
              <div className="admin-character-list">
                {listData?.items.length ? listData.items.map(item => (
                  <button
                    type="button"
                    key={item.shareCode}
                    className={`admin-character-item ${selectedCode === item.shareCode ? 'active' : ''}`}
                    onClick={() => void loadDetail(item.shareCode)}
                  >
                    <div className="admin-character-title">
                      <strong>{item.name}</strong>
                      <code>{item.shareCode}</code>
                    </div>
                    <span className="admin-owner">오너 · {item.ownerName || '미입력'}</span>
                    <p>{item.oneLineSummary || '요약 문장 없음'}</p>
                    <div className="admin-badges">
                      <span>{item.answerCount}/20문항</span>
                      <span className={item.hasDetail ? 'ok' : ''}>
                        {item.hasDetail ? `상세 ${item.detailStage}/3` : '상세 없음'}
                      </span>
                    </div>
                  </button>
                )) : <EmptyState>검색 조건에 맞는 캐릭터가 없습니다.</EmptyState>}
              </div>
              <div className="admin-pagination">
                <button
                  className="btn"
                  disabled={listBusy || offset <= 0}
                  onClick={() => void loadCharacters(appliedQuery, Math.max(0, offset - pageSize), true)}
                >이전</button>
                <span>{offset + 1}–{Math.min(offset + pageSize, listData?.filteredTotal || 0)}</span>
                <button
                  className="btn"
                  disabled={listBusy || offset + pageSize >= (listData?.filteredTotal || 0)}
                  onClick={() => void loadCharacters(appliedQuery, offset + pageSize, true)}
                >다음</button>
              </div>
            </aside>

            <section className="card admin-detail-pane" aria-busy={detailBusy}>
              {detailBusy && !detail ? (
                <div className="admin-detail-loading">상세 데이터 불러오는 중…</div>
              ) : detail ? (
                <>
                  <header className="admin-detail-head">
                    <div>
                      <div className="eyebrow">{detail.character.shareCode}</div>
                      <h2>{detail.character.name}</h2>
                      <p>오너 · <strong>{detail.character.ownerName || '미입력'}</strong></p>
                    </div>
                    <a
                      className="btn"
                      href={`/character/${detail.character.shareCode}`}
                      target="_blank"
                      rel="noreferrer"
                    >사용자 화면 열기 ↗</a>
                  </header>

                  <nav className="admin-detail-tabs">
                    {DETAIL_TABS.map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={detailTab === value ? 'active' : ''}
                        onClick={() => setDetailTab(value)}
                      >{label}</button>
                    ))}
                  </nav>

                  <div className="admin-detail-content">
                    {detailTab === 'overview' ? (
                      <>
                        <MetaGrid items={[
                          ['캐릭터 이름', detail.character.name],
                          ['오너명', detail.character.ownerName || '미입력'],
                          ['공유 코드', <code key="share-code">{detail.character.shareCode}</code>],
                          ['생성일', formatDate(detail.character.createdAt)],
                          ['최근 수정', formatDate(detail.character.updatedAt)],
                          ['분석 신뢰도', `${detail.character.analysisConfidence ?? 0}`],
                          ['유료 해제', formatDate(detail.character.paidUnlockedAt)],
                          ['상세 생성', formatDate(detail.character.detailGeneratedAt)],
                        ]} />
                        <SectionCard title="한 줄 요약">
                          <p className="admin-lead-summary">{detail.summaryReport.oneLineSummary || '—'}</p>
                        </SectionCard>
                        <SectionCard title="저장 상태">
                          <div className="admin-status-grid">
                            <div><span>공개 프로필</span><strong>{detail.profiles.publicProfileText.length.toLocaleString()}자</strong></div>
                            <div><span>비밀 프로필·외관</span><strong>{detail.profiles.secretProfileText.length.toLocaleString()}자</strong></div>
                            <div><span>문답</span><strong>{detail.answers.length}/20</strong></div>
                            <div><span>상세 리포트</span><strong>{detail.detailReport ? '저장됨' : '없음'}</strong></div>
                          </div>
                        </SectionCard>
                        <SectionCard title="엔진 버전">
                          <JsonBlock value={detail.character.engineVersions || {}} />
                        </SectionCard>
                      </>
                    ) : null}

                    {detailTab === 'profiles' ? (
                      <>
                        <MetaGrid items={[
                          ['나이', textValue(detail.profiles.age)],
                          ['성별', textValue(detail.profiles.gender)],
                        ]} />
                        <SectionCard title="공개 프로필" note={`${detail.profiles.publicProfileText.length.toLocaleString()}자`}>
                          <div className="admin-plain-text">{detail.profiles.publicProfileText || '저장된 공개 프로필이 없습니다.'}</div>
                        </SectionCard>
                        <SectionCard title="비밀 프로필" note={`${privateProfile.secretProfile.length.toLocaleString()}자`}>
                          <div className="admin-plain-text">{privateProfile.secretProfile || '입력된 비밀 프로필이 없습니다.'}</div>
                        </SectionCard>
                        <SectionCard title="외관 자료 분석 메모" note={`${privateProfile.appearanceNotes.length.toLocaleString()}자`}>
                          <div className="admin-plain-text">{privateProfile.appearanceNotes || '외관 이미지 분석 메모가 없습니다.'}</div>
                        </SectionCard>
                      </>
                    ) : null}

                    {detailTab === 'analysis' ? (
                      <>
                        <SectionCard title="성격 수치·특성">
                          {objectEntries(detail.analysis.traits).length ? (
                            <div className="admin-value-grid">
                              {objectEntries(detail.analysis.traits).map(([key, value]) => (
                                <div key={key}><span>{key}</span><strong>{textValue(value)}</strong></div>
                              ))}
                            </div>
                          ) : <EmptyState>저장된 성격 특성이 없습니다.</EmptyState>}
                        </SectionCard>
                        <SectionCard title="관계 특성">
                          {objectEntries(detail.analysis.relationshipTraits).length ? (
                            <div className="admin-value-grid">
                              {objectEntries(detail.analysis.relationshipTraits).map(([key, value]) => (
                                <div key={key}><span>{key}</span><strong>{textValue(value)}</strong></div>
                              ))}
                            </div>
                          ) : <EmptyState>저장된 관계 특성이 없습니다.</EmptyState>}
                        </SectionCard>
                        <SectionCard title="확정 사실">
                          <FactList value={detail.analysis.confirmedFacts} />
                        </SectionCard>
                        <SectionCard title="1차 해석과 오너 판정">
                          <InferenceList value={detail.analysis.aiInferences} />
                        </SectionCard>
                        <SectionCard title="오너 검수 원본">
                          <JsonBlock value={detail.analysis.ownerReview} />
                        </SectionCard>
                        <SectionCard title="상세 분석용 Evidence Pack">
                          <JsonBlock value={detail.analysis.detailSeed} />
                        </SectionCard>
                        <SectionCard title="상세 리포트 내부 분석 묶음">
                          {detail.analysis.detailDossier ? <JsonBlock value={detail.analysis.detailDossier} /> : <EmptyState>상세 리포트 내부 분석 묶음이 없습니다.</EmptyState>}
                        </SectionCard>
                      </>
                    ) : null}

                    {detailTab === 'summary' ? (
                      <>
                        <SectionCard title="한 줄 요약">
                          <p className="admin-lead-summary">{detail.summaryReport.oneLineSummary || '—'}</p>
                        </SectionCard>
                        {objectEntries(detail.summaryReport.summary).map(([key, value]) => (
                          <SectionCard key={key} title={SUMMARY_LABELS[key] || key}>
                            <ReportText text={typeof value === 'string' ? value : textValue(value)} />
                          </SectionCard>
                        ))}
                      </>
                    ) : null}

                    {detailTab === 'detail' ? (
                      detail.detailReport ? (
                        <>
                          {DETAIL_LABELS.flatMap(([key, label]) => {
                            const value = detail.detailReport?.[key];
                            return typeof value === 'string' && value.trim()
                              ? [<SectionCard key={key} title={label}><ReportText text={value} /></SectionCard>]
                              : [];
                          })}
                          {!DETAIL_LABELS.some(([key]) => typeof detail.detailReport?.[key] === 'string') ? (
                            <JsonBlock value={detail.detailReport} />
                          ) : null}
                        </>
                      ) : <EmptyState>아직 생성된 상세 리포트가 없습니다.</EmptyState>
                    ) : null}

                    {detailTab === 'answers' ? (
                      detail.answers.length ? (
                        <div className="admin-answer-list">
                          {detail.answers.map(answer => (
                            <article key={answer.order}>
                              <div className="admin-answer-number">{answer.order}</div>
                              <div>
                                <h3>{answer.question}</h3>
                                <p className="admin-answer-text">{answer.answer || '—'}</p>
                                {answer.reason ? <p className="admin-answer-reason">이유 · {answer.reason}</p> : null}
                                {answer.branchContext && Object.keys(answer.branchContext).length ? (
                                  <details>
                                    <summary>질문 분기 정보</summary>
                                    <JsonBlock value={answer.branchContext} />
                                  </details>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : <EmptyState>저장된 문답이 없습니다.</EmptyState>
                    ) : null}

                    {detailTab === 'raw' ? (
                      <SectionCard title="원본 저장 JSON" note="보안 토큰과 해시는 제외됨">
                        <JsonBlock value={detail.raw} />
                      </SectionCard>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState>왼쪽 목록에서 캐릭터를 선택해주세요.</EmptyState>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
