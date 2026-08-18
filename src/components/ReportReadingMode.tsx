'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type PortalMount = {
  root: HTMLElement;
  slot: HTMLElement;
};

function createControlSlot(root: HTMLElement) {
  const existing = root.querySelector<HTMLElement>(':scope > .report-reading-controls-slot');
  if (existing) return existing;

  const slot = document.createElement('div');
  slot.className = 'report-reading-controls-slot';
  const heading = root.querySelector<HTMLElement>(':scope > h2');
  if (heading) heading.insertAdjacentElement('afterend', slot);
  else root.prepend(slot);
  return slot;
}

export function ReportReadingMode() {
  const [mount, setMount] = useState<PortalMount | null>(null);
  const [compact, setCompact] = useState(true);

  useEffect(() => {
    let currentRoot: HTMLElement | null = null;
    let currentSlot: HTMLElement | null = null;
    let queued = false;

    const sync = () => {
      queued = false;
      const root = document.getElementById('paid-detail-report');

      if (!root) {
        currentRoot?.classList.remove('report-compact');
        currentRoot = null;
        currentSlot = null;
        setMount(null);
        return;
      }

      const slot = createControlSlot(root);
      if (root === currentRoot && slot === currentSlot) return;

      currentRoot?.classList.remove('report-compact');
      currentRoot = root;
      currentSlot = slot;
      setMount({ root, slot });
    };

    const scheduleSync = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(sync);
    };

    sync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      currentRoot?.classList.remove('report-compact');
      if (currentSlot?.isConnected) currentSlot.remove();
    };
  }, []);

  useEffect(() => {
    if (!mount) return;
    mount.root.classList.toggle('report-compact', compact);
    return () => mount.root.classList.remove('report-compact');
  }, [mount, compact]);

  if (!mount) return null;

  return createPortal(
    <div className="report-reading-controls" role="group" aria-label="상세 리포트 표시 방식">
      <span className="report-reading-description">
        {compact
          ? '핵심 소주제는 펼치고 나머지는 제목으로 먼저 보여드려요.'
          : '모든 소주제의 해석을 펼쳐서 보고 있어요.'}
      </span>
      <button
        type="button"
        className="btn report-reading-toggle"
        aria-pressed={!compact}
        onClick={() => setCompact(value => !value)}
      >
        {compact ? '전체 내용 펼치기' : '핵심만 보기'}
      </button>
    </div>,
    mount.slot,
  );
}
