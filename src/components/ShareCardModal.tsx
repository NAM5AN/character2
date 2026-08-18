'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 공유용 "캐릭터 도감" 카드. AI/서버 없이 브라우저에서만 처리.
// 사진은 업로드 즉시 다운스케일(거대한 data URL을 state에 넣지 않음)해 아이폰 대용량 사진에도 안전.
// 얼굴은 1:1 크롭(드래그 + 줌). 헤더 + 작은 얼굴 + 라벨 패널 여러 개로 정보를 촘촘히 담는다.

export type ShareCardMode = 'summary' | 'detail';
export type CardSection = { label: string; text: string };

export type ShareCardData = {
  mode: ShareCardMode;
  name: string;
  shareCode: string;
  tagline: string;         // 폴백 한 줄 요약
  sections: CardSection[]; // 폴백 라벨 + 문장 (카드 문구 생성 전/실패 시)
};

type CardCopy = { nickname?: string; tagline: string; sections: CardSection[] };

const CARD_W = 1080;
const CARD_H = 1620; // 2:3
const M = 44;
const HEADER_H = 172;
const PHOTO = 344;
const GAP = 22;
const ROW_H = 208;
const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

type Theme = {
  bgTop: string; bgBottom: string; ink: string; sub: string;
  accent: string; onAccent: string; headerBg: string; headerInk: string;
  panelBg: string; badgeText: string;
};

const THEMES: Record<ShareCardMode, Theme> = {
  summary: {
    bgTop: '#FFF7EC', bgBottom: '#FBE4C0', ink: '#332A20', sub: '#8A755A',
    accent: '#D98A34', onAccent: '#FFFFFF', headerBg: '#E7963A', headerInk: '#FFFFFF',
    panelBg: 'rgba(255,255,255,.66)', badgeText: '요약 리포트',
  },
  detail: {
    bgTop: '#181B31', bgBottom: '#322A5C', ink: '#F4EFE4', sub: '#BCADDD',
    accent: '#D8B24E', onAccent: '#241C40', headerBg: '#2E2658', headerInk: '#EAD79A',
    panelBg: 'rgba(255,255,255,.07)', badgeText: '심층 리포트',
  },
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// 리포트 본문에서 카드용 짧은 문장을 뽑는다. 굵은 안내문(**...**)은 제거하고 첫 문장만.
export function cardExcerpt(text?: string, maxLen = 52): string {
  if (!text) return '';
  let t = text.replace(/\*\*(.+?)\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!t) t = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.+?[.!?。…])(\s|$)/u);
  let s = m ? m[1] : t;
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trim() + '…';
  return s;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 어떤 크기의 정사각형에도 같은 결과를 주는 얼굴 렌더러(크롭 프리뷰 + 카드 공용).
function renderFace(
  ctx: CanvasRenderingContext2D, x: number, y: number, S: number,
  src: CanvasImageSource, iw: number, ih: number, zoom: number, nOffX: number, nOffY: number, radius: number,
) {
  const cover = Math.max(S / iw, S / ih);
  const scale = cover * zoom;
  const w = iw * scale, h = ih * scale;
  const nMaxX = (zoom * Math.max(1, iw / ih) - 1) / 2;
  const nMaxY = (zoom * Math.max(1, ih / iw) - 1) / 2;
  const ox = clamp(nOffX, -nMaxX, nMaxX) * S;
  const oy = clamp(nOffY, -nMaxY, nMaxY) * S;
  const dx = x + (S - w) / 2 + ox;
  const dy = y + (S - h) / 2 + oy;
  ctx.save();
  roundRect(ctx, x, y, S, S, radius);
  ctx.clip();
  ctx.drawImage(src, dx, dy, w, h);
  ctx.restore();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const lines: string[] = [];
  let cur = '';
  for (const ch of clean) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch === ' ' ? '' : ch;
      if (lines.length === maxLines) break;
    } else {
      cur = test;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    const consumed = lines.join('').replace(/\s/g, '').length;
    if (consumed < clean.replace(/\s/g, '').length) {
      while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
  }
  return lines;
}

async function fileToWorkingCanvas(file: File, maxDim = 1400): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement | null = null;
  let iw = 0, ih = 0;
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(file);
    bmp = b; iw = b.width; ih = b.height;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
      });
      bmp = img; iw = img.naturalWidth; ih = img.naturalHeight;
    } finally { URL.revokeObjectURL(url); }
  }
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (cx) cx.drawImage(bmp as CanvasImageSource, 0, 0, w, h);
  if (bmp && 'close' in bmp && typeof bmp.close === 'function') bmp.close();
  return c;
}

export function ShareCardModal({ open, onClose, data }: { open: boolean; onClose: () => void; data: ShareCardData }) {
  const cardRef = useRef<HTMLCanvasElement | null>(null);
  const cropRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLCanvasElement | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [nOff, setNOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copy, setCopy] = useState<CardCopy | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const theme = THEMES[data.mode];

  // 카드에 실제로 그릴 문구: 생성된 장난스러운 카피가 있으면 그걸, 없으면 리포트 원문 기반 폴백.
  const eff: CardCopy = copy ?? { tagline: data.tagline, sections: data.sections };

  const fetchCopy = useCallback(async (refresh: boolean) => {
    setCopyBusy(true); setError('');
    try {
      const r = await fetch(`/api/characters/${data.shareCode}/card-copy`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: data.mode, refresh }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body?.copy?.sections?.length) setCopy(body.copy as CardCopy);
      else if (refresh) setError('문구를 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    } catch {
      if (refresh) setError('문구를 다시 만들지 못했어요.');
    } finally { setCopyBusy(false); }
  }, [data.shareCode, data.mode]);

  const drawCard = useCallback(() => {
    const canvas = cardRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CARD_W, CARD_H);

    // 배경.
    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, theme.bgTop); g.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, CARD_W, CARD_H);

    const labelTab = (x: number, y: number, label: string) => {
      ctx.font = `800 25px ${FONT}`;
      const w = ctx.measureText(label).width + 30;
      ctx.fillStyle = theme.accent;
      roundRect(ctx, x, y, w, 42, 12); ctx.fill();
      ctx.fillStyle = theme.onAccent;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(label, x + 15, y + 22);
      ctx.textBaseline = 'alphabetic';
    };

    const panel = (x: number, y: number, w: number, h: number, label: string, text: string, bodyLines = 2, bodyFont = 27) => {
      ctx.fillStyle = theme.panelBg;
      roundRect(ctx, x, y, w, h, 22); ctx.fill();
      labelTab(x + 18, y + 16, label);
      ctx.fillStyle = theme.ink;
      ctx.font = `500 ${bodyFont}px ${FONT}`;
      ctx.textAlign = 'left';
      const lines = wrapLines(ctx, text, w - 40, bodyLines);
      let ty = y + 16 + 42 + 38;
      for (const ln of lines) { ctx.fillText(ln, x + 20, ty); ty += bodyFont + 9; }
    };

    // 헤더 밴드.
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(0, 0, CARD_W, HEADER_H);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.headerInk;
    ctx.font = `800 62px ${FONT}`;
    ctx.fillText((data.name || '').slice(0, 14), M, 94);
    ctx.font = `700 26px ${FONT}`;
    ctx.globalAlpha = 0.92;
    ctx.fillText(`캐릭터 심리 도감 · ${theme.badgeText}`, M, 136);
    ctx.globalAlpha = 1;
    // 로고 사각형.
    const ls = 88;
    ctx.fillStyle = data.mode === 'detail' ? 'rgba(234,215,154,.16)' : 'rgba(255,255,255,.24)';
    roundRect(ctx, CARD_W - M - ls, (HEADER_H - ls) / 2, ls, ls, 18); ctx.fill();
    ctx.fillStyle = theme.headerInk;
    ctx.font = `800 46px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('C', CARD_W - M - ls / 2, HEADER_H / 2 + 17);
    ctx.textAlign = 'left';

    // 얼굴 (작게, 왼쪽).
    const py = HEADER_H + GAP;
    const img = imgRef.current;
    if (img && hasImage) {
      renderFace(ctx, M, py, PHOTO, img, img.width, img.height, zoom, nOff.x, nOff.y, 28);
    } else {
      ctx.save(); roundRect(ctx, M, py, PHOTO, PHOTO, 28); ctx.clip();
      ctx.fillStyle = theme.panelBg; ctx.fillRect(M, py, PHOTO, PHOTO);
      ctx.fillStyle = theme.accent; ctx.font = `800 200px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((data.name || '?').slice(0, 1), M + PHOTO / 2, py + PHOTO / 2 + 8);
      ctx.restore();
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    }
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 4; ctx.globalAlpha = 0.7;
    roundRect(ctx, M, py, PHOTO, PHOTO, 28); ctx.stroke(); ctx.globalAlpha = 1;

    // 한 줄 요약 패널 (얼굴 오른쪽).
    const tx = M + PHOTO + GAP;
    const tw = CARD_W - tx - M;
    panel(tx, py, tw, PHOTO, '한 줄 요약', eff.tagline || '', 5, 33);

    // 유형명(닉네임) 밴드 — 중앙.
    let bandBottom = py + PHOTO;
    if (eff.nickname) {
      const ny = py + PHOTO + GAP + 8;
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.sub; ctx.font = `700 26px ${FONT}`;
      ctx.fillText('이 캐릭터는', CARD_W / 2, ny + 6);
      ctx.fillStyle = theme.accent; ctx.font = `800 56px ${FONT}`;
      const nick = wrapLines(ctx, `“${eff.nickname}”`, CARD_W - M * 2, 1)[0] || `“${eff.nickname}”`;
      ctx.fillText(nick, CARD_W / 2, ny + 66);
      ctx.textAlign = 'left';
      bandBottom = ny + 92;
    }

    // 섹션 패널 그리드 (2열).
    const gy = bandBottom + GAP + 10;
    const colW = (CARD_W - M * 2 - GAP) / 2;
    const secs = eff.sections.slice(0, 6);
    secs.forEach((sec, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      panel(M + col * (colW + GAP), gy + row * (ROW_H + 20), colW, ROW_H, sec.label, sec.text, 3, 30);
    });

    // 푸터 (하단 고정).
    ctx.fillStyle = theme.sub;
    ctx.textAlign = 'center'; ctx.font = `600 25px ${FONT}`;
    ctx.fillText('이미지를 길게 눌러 저장 · CHARA LAB', CARD_W / 2, CARD_H - 46);
    ctx.textAlign = 'left';
  }, [theme, hasImage, zoom, nOff, data, eff]);

  const drawCrop = useCallback(() => {
    const canvas = cropRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = canvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#00000010'; ctx.fillRect(0, 0, S, S);
    const img = imgRef.current;
    if (img && hasImage) renderFace(ctx, 0, 0, S, img, img.width, img.height, zoom, nOff.x, nOff.y, 12);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo((S / 3) * i, 0); ctx.lineTo((S / 3) * i, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (S / 3) * i); ctx.lineTo(S, (S / 3) * i); ctx.stroke();
    }
  }, [hasImage, zoom, nOff]);

  useEffect(() => { if (open) { drawCard(); drawCrop(); } }, [open, drawCard, drawCrop]);

  // 모달을 열거나 모드가 바뀌면 카드 문구를 가져온다(캐시 있으면 즉시).
  useEffect(() => {
    if (!open) return;
    setCopy(null);
    void fetchCopy(false);
  }, [open, data.mode, data.shareCode, fetchCopy]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setBusy(true);
    try {
      imgRef.current = await fileToWorkingCanvas(file);
      setZoom(1); setNOff({ x: 0, y: 0 }); setHasImage(true);
    } catch {
      setError('이 사진을 불러오지 못했어요. 다른 사진(JPG/PNG)으로 시도해 주세요.');
    } finally { setBusy(false); }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!hasImage) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !hasImage) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / rect.width;
    const dy = (e.clientY - drag.current.y) / rect.height;
    drag.current = { x: e.clientX, y: e.clientY };
    setNOff(o => ({ x: o.x + dx, y: o.y + dy }));
  }
  function onPointerUp() { drag.current = null; }

  async function exportBlob(): Promise<Blob | null> {
    const canvas = cardRef.current;
    if (!canvas) return null;
    return await new Promise(res => canvas.toBlob(b => res(b), 'image/png', 0.95));
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function share() {
    setBusy(true); setError('');
    try {
      const blob = await exportBlob();
      if (!blob) { setError('카드를 만들지 못했어요.'); return; }
      const file = new File([blob], `${data.name || 'character'}_${data.mode}_card.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] }) && typeof navigator.share === 'function') {
        try { await navigator.share({ files: [file], title: `${data.name} 캐릭터 카드`, text: eff.tagline }); return; }
        catch { /* 취소/실패 시 저장으로 폴백 */ }
      }
      downloadBlob(blob, file.name);
    } catch {
      setError('공유하지 못했어요. 이미지 저장을 이용해 주세요.');
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const blob = await exportBlob();
      if (!blob) { setError('카드를 만들지 못했어요.'); return; }
      downloadBlob(blob, `${data.name || 'character'}_${data.mode}_card.png`);
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(720px, 100%)', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{data.mode === 'detail' ? '심층 리포트 공유 카드' : '요약 리포트 공유 카드'}</h3>
          <button className="btn" style={{ padding: '8px 12px' }} onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>사진을 넣고 얼굴이 가운데 오도록 옮기거나 확대한 뒤, 공유하거나 저장하세요. 사진은 이 카드에만 쓰이고 서버에 올라가지 않아요.</p>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: '1 1 240px', minWidth: 240 }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 300, aspectRatio: '1 / 1', margin: '0 auto' }}>
              <canvas
                ref={cropRef} width={300} height={300}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                style={{ width: '100%', height: '100%', borderRadius: 16, touchAction: 'none', cursor: hasImage ? 'grab' : 'default', background: '#eee', display: 'block' }}
              />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="label">확대 {zoom.toFixed(1)}×</label>
              <input type="range" min={1} max={3} step={0.01} value={zoom} disabled={!hasImage}
                onChange={e => setZoom(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <label className="btn" style={{ display: 'inline-block', cursor: 'pointer' }}>
              {hasImage ? '사진 바꾸기' : '사진 선택'}
              <input type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
            </label>
          </div>

          <div style={{ flex: '1 1 260px', minWidth: 240, display: 'flex', justifyContent: 'center' }}>
            <canvas ref={cardRef} width={CARD_W} height={CARD_H}
              style={{ width: '100%', maxWidth: 320, height: 'auto', borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.18)', display: 'block' }} />
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn soft" disabled={copyBusy} onClick={() => void fetchCopy(true)}>🎲 문구 다시 뽑기</button>
          {copyBusy && <span className="muted" style={{ fontSize: 13 }}>✨ 카드 문구 만드는 중…</span>}
          {!copyBusy && copy && <span className="muted" style={{ fontSize: 13 }}>맘에 안 들면 다시 뽑아보세요</span>}
        </div>

        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={busy} onClick={() => void share()}>{busy ? '처리 중…' : '공유하기'}</button>
          <button className="btn" disabled={busy} onClick={() => void save()}>이미지 저장</button>
        </div>
      </div>
    </div>
  );
}
