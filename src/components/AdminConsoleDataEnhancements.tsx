'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const PAGE_SIZE = 12;
const FAILURE_COLLAPSE_KEY = 'chara_lab_admin_failures_collapsed_v1';

type AdminPaletteRow = {
  shareCode?: unknown;
  name?: unknown;
  ownerName?: unknown;
  themePalette?: unknown;
};

type PaletteItem = {
  shareCode: string;
  name: string;
  ownerName: string;
  palette: CharacterThemePalette | null;
};

function parsePaletteRows(value: unknown): PaletteItem[] {
  if (!value || typeof value !== 'object') return [];
  const characters = (value as { characters?: unknown }).characters;
  if (!Array.isArray(characters)) return [];
  return characters.map(raw => {
    const row = raw && typeof raw === 'object' ? raw as AdminPaletteRow : {};
    const parsed = themePaletteSchema.safeParse(row.themePalette);
    return {
      shareCode: typeof row.shareCode === 'string' ? row.shareCode.trim() : '',
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '이름 없음',
      ownerName: typeof row.ownerName === 'string' ? row.ownerName.trim() : '',
      palette: parsed.success ? parsed.data : null,
    };
  }).filter(row => row.shareCode);
}

function sourceLabel(source: CharacterThemePalette['source']) {
  if (source === 'text') return '텍스트 설정';
  if (source === 'image') return '이미지 관찰';
  return '텍스트 + 이미지';
}

function PaletteSwatch({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr)', gap: 10, alignItems: 'center', minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{ width: 34, height: 34, borderRadius: 9, background: color, border: '1px solid rgba(17,17,17,.18)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)' }}
      />
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 12, lineHeight: 1.2 }}>{label}</strong>
        <code style={{ display: 'block', marginTop: 3, fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{color}</code>
      </span>
    </div>
  );
}

function findFailureCard() {
  return [...document.querySelectorAll<HTMLElement>('.card')].find(card =>
    [...card.querySelectorAll('strong')].some(node => node.textContent?.trim() === 'AI 생성 실패'),
  ) || null;
}

function findCharacterGrid() {
  const marked = document.querySelector<HTMLElement>('.admin-character-grid');
  if (marked) return marked;
  return [...document.querySelectorAll<HTMLElement>('.stack')].find(stack =>
    Boolean(stack.querySelector('button[aria-label$="상세 열기"]')),
  ) || null;
}

function findDetailModal() {
  return [...document.querySelectorAll<HTMLElement>('.modal')].find(modal =>
    Boolean(modal.querySelector('button[aria-label="닫기"]')),
  ) || null;
}

function readDetailShareCode(modal: HTMLElement) {
  return [...modal.querySelectorAll<HTMLElement>('.tag')]
    .map(node => node.textContent?.trim() || '')
    .find(text => /^[A-Z0-9]{8}$/i.test(text)) || '';
}

export function AdminConsoleDataEnhancements() {
  const pathname = usePathname();
  const active = pathname === '/admin/console';

  const [failureCard, setFailureCard] = useState<HTMLElement | null>(null);
  const [failureActions, setFailureActions] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const [grid, setGrid] = useState<HTMLElement | null>(null);
  const [paginationHost, setPaginationHost] = useState<HTMLElement | null>(null);
  const [itemCount, setItemCount] = useState(0);
  const [page, setPage] = useState(1);
  const previousCount = useRef(0);

  const [detailHost, setDetailHost] = useState<HTMLElement | null>(null);
  const [detailCode, setDetailCode] = useState('');
  const [paletteRows, setPaletteRows] = useState<PaletteItem[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);

  const loadPalettes = useCallback(async () => {
    if (!active) return;
    setPaletteLoading(true);
    try {
      const response = await fetch('/api/admin/data', { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json().catch(() => ({}));
      setPaletteRows(parsePaletteRows(body));
    } catch {
      // Palette display is supplementary to the existing admin data.
    } finally {
      setPaletteLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    try {
      const saved = localStorage.getItem(FAILURE_COLLAPSE_KEY);
      setCollapsed(saved === null ? true : saved === '1');
    } catch {
      setCollapsed(true);
    }
    void loadPalettes();
  }, [active, loadPalettes]);

  useEffect(() => {
    if (!active) return;
    let queued = false;

    const sync = () => {
      queued = false;

      const nextFailureCard = findFailureCard();
      setFailureCard(current => current === nextFailureCard ? current : nextFailureCard);
      const refreshButton = nextFailureCard
        ? [...nextFailureCard.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '새로고침')
        : null;
      const nextActions = refreshButton?.parentElement instanceof HTMLElement ? refreshButton.parentElement : null;
      setFailureActions(current => current === nextActions ? current : nextActions);

      const nextGrid = findCharacterGrid();
      setGrid(current => current === nextGrid ? current : nextGrid);
      if (nextGrid) {
        const cards = [...nextGrid.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('card'));
        const count = cards.length;
        if (previousCount.current !== count) {
          previousCount.current = count;
          setPage(1);
        }
        setItemCount(current => current === count ? current : count);

        let host = nextGrid.nextElementSibling instanceof HTMLElement && nextGrid.nextElementSibling.dataset.adminCharacterPagination === '1'
          ? nextGrid.nextElementSibling
          : null;
        if (!host) {
          host = document.createElement('div');
          host.dataset.adminCharacterPagination = '1';
          nextGrid.insertAdjacentElement('afterend', host);
        }
        setPaginationHost(current => current === host ? current : host);
      } else {
        setItemCount(0);
        setPaginationHost(null);
      }

      const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="캐릭터명"]');
      if (searchInput && searchInput.dataset.adminPaginationBound !== '1') {
        searchInput.dataset.adminPaginationBound = '1';
        searchInput.addEventListener('input', () => setPage(1));
      }

      const modal = findDetailModal();
      if (!modal) {
        setDetailCode('');
        setDetailHost(null);
      } else {
        const code = readDetailShareCode(modal);
        setDetailCode(current => current === code ? current : code);
        const scrollArea = modal.children[1] instanceof HTMLElement ? modal.children[1] : null;
        if (scrollArea) {
          let host = scrollArea.querySelector<HTMLElement>('[data-admin-palette-detail-host="1"]');
          if (!host) {
            host = document.createElement('div');
            host.dataset.adminPaletteDetailHost = '1';
            const accordion = [...scrollArea.children].find((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('stack'));
            if (accordion) accordion.insertAdjacentElement('afterend', host);
            else scrollArea.prepend(host);
          }
          setDetailHost(current => current === host ? current : host);
        } else {
          setDetailHost(null);
        }
      }
    };

    const queueSync = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(sync);
    };

    sync();
    const observer = new MutationObserver(queueSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!failureCard) return;
    [...failureCard.children].forEach((node, index) => {
      if (!(node instanceof HTMLElement) || index === 0) return;
      node.style.display = collapsed ? 'none' : '';
    });
    try { localStorage.setItem(FAILURE_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [failureCard, collapsed, itemCount]);

  const totalPages = Math.max(1, Math.ceil(itemCount / PAGE_SIZE));

  useEffect(() => {
    if (!grid) return;
    const safePage = Math.min(Math.max(page, 1), totalPages);
    if (safePage !== page) {
      setPage(safePage);
      return;
    }
    const start = (safePage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const cards = [...grid.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('card'));
    cards.forEach((card, index) => {
      const visible = index >= start && index < end;
      card.style.display = visible ? '' : 'none';
      card.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }, [grid, page, totalPages, itemCount]);

  const paletteMap = useMemo(() => new Map(paletteRows.map(row => [row.shareCode, row])), [paletteRows]);
  const detailPalette = detailCode ? paletteMap.get(detailCode) : undefined;

  if (!active) return null;

  return <>
    {failureActions && createPortal(
      <button
        type="button"
        className="btn soft"
        onClick={() => setCollapsed(value => !value)}
        aria-expanded={!collapsed}
        style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
      >
        {collapsed ? '펼치기' : '접기'}
      </button>,
      failureActions,
    )}

    {paginationHost && createPortal(
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 2px 4px' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          총 {itemCount}명 · {itemCount ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, itemCount)}` : '0'} 표시
        </span>
        <div className="actions" style={{ marginTop: 0, gap: 7 }}>
          <button className="btn soft" type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} style={{ padding: '7px 11px' }}>이전</button>
          <span className="tag" style={{ minWidth: 62, textAlign: 'center', padding: '8px 10px', fontWeight: 800 }}>{page} / {totalPages}</span>
          <button className="btn soft" type="button" disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} style={{ padding: '7px 11px' }}>다음</button>
        </div>
      </div>,
      paginationHost,
    )}

    {detailHost && createPortal(
      <details style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--paper)', overflow: 'hidden' }}>
        <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '14px 16px', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>UI 팔레트</span>
          <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>{detailPalette?.palette ? sourceLabel(detailPalette.palette.source) : '팔레트 없음'}</span>
        </summary>
        <div style={{ borderTop: '1px solid var(--line)', padding: '14px 16px 16px' }}>
          {paletteLoading && !detailPalette && <p className="muted" style={{ margin: 0, fontSize: 12 }}>팔레트 불러오는 중…</p>}
          {!paletteLoading && !detailPalette?.palette && <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>기존 캐릭터이거나 테마 저장 전에 생성되어 저장된 팔레트가 없어요.</p>}
          {detailPalette?.palette && <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '14px 18px' }}>
              <PaletteSwatch label="메인" color={detailPalette.palette.main}/>
              <PaletteSwatch label="메인서브" color={detailPalette.palette.mainSub}/>
              <PaletteSwatch label="포인트" color={detailPalette.palette.point}/>
              <PaletteSwatch label="포인트서브" color={detailPalette.palette.pointSub}/>
              {detailPalette.palette.alt && <PaletteSwatch label="보조 포인트" color={detailPalette.palette.alt}/>} 
              {detailPalette.palette.altSub && <PaletteSwatch label="보조 포인트서브" color={detailPalette.palette.altSub}/>} 
            </div>
            <p className="muted" style={{ margin: '12px 0 0', fontSize: 11 }}>
              {sourceLabel(detailPalette.palette.source)} · 신뢰도 {detailPalette.palette.confidence}
            </p>
          </>}
        </div>
      </details>,
      detailHost,
    )}
  </>;
}
