'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 공유용 카드. AI/서버 없이 브라우저에서만 처리한다.
// 사진은 업로드 즉시 다운스케일해서(거대한 data URL을 state에 넣지 않음) 아이폰 대용량 사진에도 안전.
// 얼굴은 1:1 정사각형 크롭(드래그 이동 + 줌). 카드 이미지는 canvas로 합성해 공유/저장.

export type ShareCardMode = 'summary' | 'detail';

export type ShareCardData = {
  mode: ShareCardMode;
  name: string;
  oneLineSummary: string;
  excerpt?: string;   // 상세 카드용 짧은 심층 발췌
  aspects?: string[]; // 요약 카드용 관점 라벨
};

const CARD_W = 1080;
const CARD_H = 1560;
const FACE = 820;
const FACE_X = (CARD_W - FACE) / 2;
const FACE_Y = 96;
const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

type Theme = {
  bgTop: string; bgBottom: string; ink: string; sub: string;
  badgeBg: string; badgeInk: string; accent: string; badgeText: string; frame: string;
};

const THEMES: Record<ShareCardMode, Theme> = {
  summary: {
    bgTop: '#FFF7EC', bgBottom: '#FCE7C6', ink: '#2A2420', sub: '#6B5B45',
    badgeBg: '#E79A3C', badgeInk: '#FFFFFF', accent: '#C9812B', badgeText: '요약 리포트', frame: 'rgba(42,36,32,.10)',
  },
  detail: {
    bgTop: '#191C33', bgBottom: '#322A5C', ink: '#F6F1E6', sub: '#C9BCE6',
    badgeBg: '#D8B24E', badgeInk: '#1A1730', accent: '#E7CE86', badgeText: '심층 리포트', frame: 'rgba(255,255,255,.14)',
  },
};

// 상세 리포트 본문에서 카드용 짧은 발췌를 뽑는다. 굵은 안내문(**...**)은 제거하고 첫 문장만.
export function cardExcerpt(text?: string, maxLen = 96): string {
  if (!text) return '';
  let t = text.replace(/\*\*(.+?)\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!t) t = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.+?[.!?。…])(\s|$)/u);
  let s = m ? m[1] : t;
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trim() + '…';
  return s;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

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
    // 마지막 줄이 잘렸으면 말줄임.
    let last = lines[maxLines - 1];
    const consumed = lines.join('').length;
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
  const drag = useRef<{ x: number; y: number } | null>(null);
  const theme = THEMES[data.mode];

  const drawCard = useCallback(() => {
    const canvas = cardRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 배경 그라디언트.
    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, theme.bgTop); g.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, CARD_W, CARD_H);

    // 얼굴 (없으면 모노그램).
    const img = imgRef.current;
    if (img && hasImage) {
      renderFace(ctx, FACE_X, FACE_Y, FACE, img, img.width, img.height, zoom, nOff.x, nOff.y, 40);
    } else {
      ctx.save();
      roundRect(ctx, FACE_X, FACE_Y, FACE, FACE, 40);
      ctx.clip();
      ctx.fillStyle = data.mode === 'detail' ? 'rgba(255,255,255,.06)' : 'rgba(42,36,32,.05)';
      ctx.fillRect(FACE_X, FACE_Y, FACE, FACE);
      ctx.fillStyle = theme.accent;
      ctx.font = `800 360px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((data.name || '?').slice(0, 1), CARD_W / 2, FACE_Y + FACE / 2 + 12);
      ctx.restore();
    }
    // 얼굴 테두리.
    ctx.strokeStyle = theme.frame; ctx.lineWidth = 3;
    roundRect(ctx, FACE_X, FACE_Y, FACE, FACE, 40); ctx.stroke();

    let y = FACE_Y + FACE + 74;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // 뱃지.
    ctx.font = `800 30px ${FONT}`;
    const bt = theme.badgeText;
    const bw = ctx.measureText(bt).width + 44;
    ctx.fillStyle = theme.badgeBg;
    roundRect(ctx, FACE_X, y - 34, bw, 50, 25); ctx.fill();
    ctx.fillStyle = theme.badgeInk;
    ctx.fillText(bt, FACE_X + 22, y);
    y += 62;

    // 이름.
    ctx.fillStyle = theme.ink;
    ctx.font = `800 76px ${FONT}`;
    const nameLine = wrapLines(ctx, data.name || '', CARD_W - FACE_X * 2, 1)[0] || '';
    ctx.fillText(nameLine, FACE_X, y);
    y += 30;

    // 한 줄 요약.
    ctx.fillStyle = theme.ink;
    ctx.font = `600 38px ${FONT}`;
    const oneLines = wrapLines(ctx, data.oneLineSummary || '', CARD_W - FACE_X * 2, 3);
    for (const line of oneLines) { y += 52; ctx.fillText(line, FACE_X, y); }

    // 모드별 추가 내용.
    if (data.mode === 'detail' && data.excerpt) {
      y += 40;
      ctx.fillStyle = theme.accent;
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText('심층 해석', FACE_X, y);
      y += 12;
      ctx.fillStyle = theme.sub;
      ctx.font = `400 32px ${FONT}`;
      const ex = wrapLines(ctx, data.excerpt, CARD_W - FACE_X * 2, 2);
      for (const line of ex) { y += 44; ctx.fillText(line, FACE_X, y); }
    } else if (data.mode === 'summary' && data.aspects && data.aspects.length) {
      y += 44;
      ctx.font = `700 28px ${FONT}`;
      let cx = FACE_X;
      const chipH = 52, gap = 14, maxRight = CARD_W - FACE_X;
      for (const a of data.aspects) {
        const cw = ctx.measureText(a).width + 40;
        if (cx + cw > maxRight) { cx = FACE_X; y += chipH + gap; }
        ctx.fillStyle = 'rgba(201,129,43,.14)';
        roundRect(ctx, cx, y, cw, chipH, 26); ctx.fill();
        ctx.fillStyle = theme.accent;
        ctx.fillText(a, cx + 20, y + 35);
        cx += cw + gap;
      }
      y += chipH;
    }

    // 푸터 브랜드.
    ctx.fillStyle = theme.sub;
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('CHARA LAB · 캐릭터 심리 분석', FACE_X, CARD_H - 46);
  }, [theme, hasImage, zoom, nOff, data]);

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
    // 안내 격자.
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo((S / 3) * i, 0); ctx.lineTo((S / 3) * i, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (S / 3) * i); ctx.lineTo(S, (S / 3) * i); ctx.stroke();
    }
  }, [hasImage, zoom, nOff]);

  useEffect(() => { if (open) { drawCard(); drawCrop(); } }, [open, drawCard, drawCrop]);

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

  async function share() {
    setBusy(true); setError('');
    try {
      const blob = await exportBlob();
      if (!blob) { setError('카드를 만들지 못했어요.'); return; }
      const file = new File([blob], `${data.name || 'character'}_${data.mode}_card.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] }) && typeof navigator.share === 'function') {
        try { await navigator.share({ files: [file], title: `${data.name} 캐릭터 카드`, text: data.oneLineSummary }); return; }
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

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{data.mode === 'detail' ? '심층 리포트 공유 카드' : '요약 리포트 공유 카드'}</h3>
          <button className="btn" style={{ padding: '8px 12px' }} onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>사진을 넣고 얼굴이 가운데 오도록 옮기거나 확대한 뒤, 공유하거나 저장하세요. 사진은 이 카드에만 쓰이고 서버에 올라가지 않아요.</p>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
          {/* 크롭 + 컨트롤 */}
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

          {/* 카드 미리보기 */}
          <div style={{ flex: '1 1 220px', minWidth: 200, display: 'flex', justifyContent: 'center' }}>
            <canvas ref={cardRef} width={CARD_W} height={CARD_H}
              style={{ width: '100%', maxWidth: 260, height: 'auto', borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.18)', display: 'block' }} />
          </div>
        </div>

        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

        <div className="actions" style={{ marginTop: 18 }}>
          <button className="btn primary" disabled={busy} onClick={() => void share()}>{busy ? '처리 중…' : '공유하기'}</button>
          <button className="btn" disabled={busy} onClick={() => void save()}>이미지 저장</button>
        </div>
      </div>
    </div>
  );
}
