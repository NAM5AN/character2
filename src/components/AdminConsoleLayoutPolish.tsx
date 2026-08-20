'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

function markAdminConsole() {
  const main = document.querySelector<HTMLElement>('main.container.page');
  if (!main) return;

  main.classList.add('admin-console-page');

  for (const child of Array.from(main.children)) {
    const el = child as HTMLElement;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

    if (el.classList.contains('page-head')) {
      el.classList.add('admin-console-head');
      continue;
    }

    if (el.classList.contains('card')) {
      if (text.includes('AI Gateway 잔액')) el.classList.add('admin-ops-balance');
      else if (text.includes('AI 생성 실패')) el.classList.add('admin-ops-failures');
      else if (text.includes('일별 비용 추이')) el.classList.add('admin-ops-costs');
      else if (text.includes('결제코드 (이용코드)')) el.classList.add('admin-settings-card');
      continue;
    }

    if (el.classList.contains('field') && el.querySelector('input[placeholder*="캐릭터명"]')) {
      el.classList.add('admin-character-search');
      continue;
    }

    if (el.classList.contains('stack') && el.querySelector('button[aria-label$="상세 열기"]')) {
      el.classList.add('admin-character-grid');
      continue;
    }

    if (el.matches('p.error')) el.classList.add('admin-console-error');
    if (el.matches('p.muted') && text.includes('표시할 캐릭터가 없어요')) el.classList.add('admin-console-empty');
  }
}

export function AdminConsoleLayoutPolish() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== '/admin/console') return;

    let frame = window.requestAnimationFrame(markAdminConsole);
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(markAdminConsole);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
