'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const EASE = 'cubic-bezier(.2,.72,.2,1)';

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateEnter(element: HTMLElement, x = 0, y = 7, duration = 190) {
  if (reducedMotion()) return;
  element.animate(
    [
      { opacity: 0.68, transform: `translate3d(${x}px, ${y}px, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration, easing: EASE, fill: 'both' },
  );
}

function animateSummaryExpanded(element: HTMLElement) {
  if (reducedMotion()) return;
  element.getAnimations().forEach(animation => animation.cancel());
  const computed = window.getComputedStyle(element);
  const targetHeight = element.getBoundingClientRect().height;
  if (targetHeight < 1) return;

  element.style.overflow = 'hidden';
  const animation = element.animate(
    [
      {
        height: '0px',
        marginTop: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        borderTopWidth: '0px',
        borderBottomWidth: '0px',
        opacity: 0,
        transform: 'translateY(-10px)',
      },
      {
        height: `${targetHeight}px`,
        marginTop: computed.marginTop,
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        borderTopWidth: computed.borderTopWidth,
        borderBottomWidth: computed.borderBottomWidth,
        opacity: 1,
        transform: 'translateY(0)',
      },
    ],
    { duration: 340, easing: 'cubic-bezier(.22,.72,.2,1)', fill: 'both' },
  );

  void animation.finished.finally(() => {
    element.style.overflow = '';
    animation.cancel();
  });
}

function summaryCardExpandedFrom(node: HTMLElement) {
  const expanded = node.matches('.report-mag .summary-expanded')
    ? node
    : node.closest<HTMLElement>('.report-mag .summary-expanded')
      || node.querySelector<HTMLElement>('.report-mag .summary-expanded');
  if (!expanded) return null;
  return expanded.previousElementSibling?.classList.contains('summary-card-grid') ? expanded : null;
}

function questionOrder() {
  const text = document.querySelector<HTMLElement>('.analyze-page .question-card .q-meta span:first-child')?.textContent || '';
  const match = text.match(/(\d+)\s*\/\s*20/u);
  return match ? Number(match[1]) : null;
}

function detailPageNumber() {
  const text = document.querySelector<HTMLElement>('.report-mag .sheet-page-no')?.textContent?.trim() || '';
  const value = Number(text);
  return Number.isFinite(value) && value >= 1 && value <= 3 ? value : null;
}

function summaryMode() {
  const active = document.querySelector<HTMLElement>('.report-mag .summary-view-toggle button.is-active');
  return active?.textContent?.trim() || null;
}

export function GlobalScreenMotionBridge() {
  const pathname = usePathname();
  const lastQuestion = useRef<number | null>(null);
  const lastDetailPage = useRef<number | null>(null);
  const lastSummaryMode = useRef<string | null>(null);
  const queued = useRef(false);

  useEffect(() => {
    if (reducedMotion()) return;
    const frame = window.requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>('main');
      if (main) animateEnter(main, 0, 7, 185);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    const pendingSummaryExpanded = new Set<HTMLElement>();

    const syncDirectionalMotion = () => {
      queued.current = false;

      pendingSummaryExpanded.forEach(animateSummaryExpanded);
      pendingSummaryExpanded.clear();

      const order = questionOrder();
      if (order !== null) {
        if (lastQuestion.current !== null && order !== lastQuestion.current) {
          const direction = order > lastQuestion.current ? 1 : -1;
          const card = document.querySelector<HTMLElement>('.analyze-page .question-card');
          if (card) animateEnter(card, direction * 9, 0, 195);
        }
        lastQuestion.current = order;
      } else {
        lastQuestion.current = null;
      }

      const page = detailPageNumber();
      if (page !== null) {
        if (lastDetailPage.current !== null && page !== lastDetailPage.current) {
          const direction = page > lastDetailPage.current ? 1 : -1;
          const sheet = document.querySelector<HTMLElement>('.report-mag .sheet');
          if (sheet) animateEnter(sheet, direction * 8, 0, 205);
        }
        lastDetailPage.current = page;
      } else {
        lastDetailPage.current = null;
      }

      const mode = summaryMode();
      if (mode) {
        if (lastSummaryMode.current && mode !== lastSummaryMode.current) {
          const content = document.querySelector<HTMLElement>('.report-mag .summary-card-grid, .report-mag .summary-read-list');
          if (content) animateEnter(content, 0, 5, 175);
        }
        lastSummaryMode.current = mode;
      } else {
        lastSummaryMode.current = null;
      }
    };

    const queueSync = () => {
      if (queued.current) return;
      queued.current = true;
      window.requestAnimationFrame(syncDirectionalMotion);
    };

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type !== 'childList') continue;
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          const summaryExpanded = summaryCardExpandedFrom(node);
          if (summaryExpanded) pendingSummaryExpanded.add(summaryExpanded);

          const stageTarget = node.matches('.analyze-page > .card, .analyze-page > .stack')
            ? node
            : node.querySelector<HTMLElement>('.analyze-page > .card, .analyze-page > .stack');
          if (stageTarget && !stageTarget.classList.contains('question-card')) {
            animateEnter(stageTarget, 0, 6, 180);
          }
        }
      }
      queueSync();
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    syncDirectionalMotion();

    return () => {
      observer.disconnect();
      pendingSummaryExpanded.clear();
      if (queued.current) queued.current = false;
    };
  }, []);

  return null;
}
