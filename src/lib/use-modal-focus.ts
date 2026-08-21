'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableInside(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
  });
}

/**
 * 모달이 열려 있는 동안 키보드 사용자를 모달 안에 붙잡아 둔다.
 *
 * aria-modal="true" 는 스크린리더에게 "배경은 없는 셈 치라"고 말한다. 그런데 포커스가
 * 배경으로 빠져나갈 수 있으면, 사용자는 읽히지도 않는 곳에 커서를 둔 채 길을 잃는다.
 * 선언과 실제 동작을 맞추기 위해 네 가지를 함께 처리한다.
 *
 *  - 열릴 때 모달 안 첫 요소로 포커스 이동
 *  - Escape 로 닫기
 *  - Tab / Shift+Tab 이 모달 안에서 순환
 *  - 닫힐 때 열기 전 있던 곳으로 포커스 복귀
 */
export function useModalFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const restoreTo = document.activeElement as HTMLElement | null;

    // 첫 입력 요소가 있으면 그쪽이 자연스럽고, 없으면 모달 자체에 포커스를 준다.
    const first = focusableInside(container)[0];
    if (first) first.focus();
    else {
      container.tabIndex = -1;
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusableInside(container);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      // 경계에서 넘어가려 할 때만 가로채 반대편으로 보낸다.
      if (event.shiftKey && (active === firstItem || !container.contains(active))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // 모달을 연 버튼이 아직 화면에 있으면 그리로 돌려보낸다.
      if (restoreTo && restoreTo.isConnected) restoreTo.focus();
    };
  }, [open, containerRef, onClose]);
}
