'use client';

import { useEffect, useState } from 'react';

type EditTarget = {
  shareCode: string;
  name: string;
  ownerName: string;
};

const SHARE_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/u;
const BUTTON_ATTR = 'data-admin-identity-edit';

function detailModalSnapshot(): EditTarget | null {
  if (typeof window === 'undefined' || window.location.pathname !== '/admin/console') return null;
  const modals = [...document.querySelectorAll<HTMLElement>('.modal-backdrop .modal')];
  for (const modal of modals) {
    const codeTag = [...modal.querySelectorAll<HTMLElement>('span.tag')]
      .find(node => SHARE_CODE_RE.test((node.textContent || '').trim()));
    if (!codeTag) continue;
    const header = modal.firstElementChild as HTMLElement | null;
    if (!header) continue;
    const name = header.querySelector<HTMLElement>('strong')?.textContent?.trim() || '';
    const ownerText = [...header.querySelectorAll<HTMLElement>('span')]
      .map(node => node.textContent?.trim() || '')
      .find(text => text.startsWith('오너 · ')) || '';
    const ownerName = ownerText.replace(/^오너\s*·\s*/u, '').trim();
    return {
      shareCode: (codeTag.textContent || '').trim(),
      name: name === '(이름 없음)' ? '' : name,
      ownerName: ownerName === '—' ? '' : ownerName,
    };
  }
  return null;
}

export function AdminCharacterIdentityEditBridge() {
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.location.pathname !== '/admin/console') return;

    const enhance = () => {
      const snapshot = detailModalSnapshot();
      if (!snapshot) return;
      const modals = [...document.querySelectorAll<HTMLElement>('.modal-backdrop .modal')];
      const modal = modals.find(item => [...item.querySelectorAll<HTMLElement>('span.tag')]
        .some(node => (node.textContent || '').trim() === snapshot.shareCode));
      if (!modal || modal.querySelector(`[${BUTTON_ATTR}]`)) return;
      const closeButton = modal.querySelector<HTMLButtonElement>('button[aria-label="닫기"]');
      if (!closeButton?.parentElement) return;

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn soft';
      editButton.setAttribute(BUTTON_ATTR, '1');
      editButton.style.padding = '8px 12px';
      editButton.style.marginLeft = 'auto';
      editButton.textContent = '이름 수정';
      editButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const current = detailModalSnapshot();
        if (!current) return;
        setTarget(current);
        setName(current.name);
        setOwnerName(current.ownerName);
        setError('');
      });
      closeButton.parentElement.insertBefore(editButton, closeButton);
    };

    enhance();
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        enhance();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function save() {
    if (!target || busy) return;
    const normalizedName = name.replace(/\s+/gu, ' ').trim();
    const normalizedOwner = ownerName.replace(/\s+/gu, ' ').trim();
    if (!normalizedName) {
      setError('캐릭터명은 비워둘 수 없어요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/data/${target.shareCode}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: normalizedName, ownerName: normalizedOwner }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setError('관리자 로그인이 만료됐어요. 다시 로그인해주세요.');
        return;
      }
      if (!response.ok) {
        setError(body?.error === 'CHARACTER_NAME_INVALID'
          ? '캐릭터명은 1~80자로 입력해주세요.'
          : body?.error === 'OWNER_NAME_INVALID'
            ? '오너명은 80자 이내로 입력해주세요.'
            : `저장하지 못했어요. (${body?.error || response.status})`);
        return;
      }
      setTarget(null);
      window.location.reload();
    } catch {
      setError('저장 요청 중 오류가 발생했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  return <div className="modal-backdrop" style={{ zIndex: 160 }} onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) setTarget(null);
  }}>
    <div className="modal" role="dialog" aria-modal="true" aria-busy={busy} style={{ width: 'min(500px,100%)' }}>
      <div className="eyebrow">Admin · {target.shareCode}</div>
      <h3 style={{ marginTop: 8 }}>캐릭터 정보 수정</h3>
      <p>공유코드는 유지하고 캐릭터명과 오너명만 수정합니다. 오너명을 비우고 저장하면 오너명 정보가 제거돼요.</p>
      <div className="field">
        <label className="label"><span className="label-text">캐릭터명</span>
        <input className="input" maxLength={80} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
      </div>
      <div className="field">
        <label className="label"><span className="label-text">오너명 <span className="muted">(비워서 제거 가능)</span></span>
        <input className="input" maxLength={80} disabled={busy} value={ownerName} onChange={event => setOwnerName(event.target.value)} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? '저장 중…' : '변경사항 저장'}</button>
        <button className="btn" disabled={busy} onClick={() => setTarget(null)}>취소</button>
      </div>
    </div>
  </div>;
}
