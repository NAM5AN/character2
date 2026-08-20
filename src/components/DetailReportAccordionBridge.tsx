'use client';

import { useEffect } from 'react';

type ManagedTopic = HTMLElement & {
  __detailTopicClick?: EventListener;
  __detailTopicKey?: EventListener;
};

function topicBlocks(topic: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  let next = topic.nextElementSibling;
  while (next && !next.matches('article.topic')) {
    if (next instanceof HTMLElement && next.classList.contains('study-block')) blocks.push(next);
    next = next.nextElementSibling;
  }
  return blocks;
}

function syncTopic(topic: ManagedTopic, open: boolean) {
  topic.classList.toggle('is-topic-open', open);
  topic.setAttribute('aria-expanded', open ? 'true' : 'false');
  topicBlocks(topic).forEach(block => { block.hidden = !open; });
}

function bindTopic(topic: ManagedTopic) {
  if (topic.dataset.detailTopicAccordion === '1') return;
  topic.dataset.detailTopicAccordion = '1';
  topic.classList.add('detail-topic-accordion');
  topic.setAttribute('role', 'button');
  topic.setAttribute('tabindex', '0');
  topic.setAttribute('aria-expanded', 'false');
  syncTopic(topic, false);

  const click: EventListener = event => {
    const target = event.target as Element | null;
    if (target?.closest('a,button,input,textarea,select,video')) return;
    syncTopic(topic, !topic.classList.contains('is-topic-open'));
  };
  const key: EventListener = event => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== 'Enter' && keyboard.key !== ' ') return;
    keyboard.preventDefault();
    syncTopic(topic, !topic.classList.contains('is-topic-open'));
  };
  topic.addEventListener('click', click);
  topic.addEventListener('keydown', key);
  topic.__detailTopicClick = click;
  topic.__detailTopicKey = key;
}

function initializeSection(section: HTMLElement) {
  if (section.dataset.detailSectionAccordion === '1') return;
  section.dataset.detailSectionAccordion = '1';

  // MagazineSection currently mounts opened. Close it once on first appearance,
  // then leave subsequent user toggles untouched.
  if (section.classList.contains('is-open')) {
    const head = section.querySelector<HTMLElement>(':scope > .section-head');
    head?.click();
  }
}

export function DetailReportAccordionBridge() {
  useEffect(() => {
    const enhance = () => {
      document.querySelectorAll<HTMLElement>('.report-mag .report-section').forEach(initializeSection);
      document.querySelectorAll<ManagedTopic>('.report-mag .topic-grid > article.topic').forEach(bindTopic);
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

    return () => {
      observer.disconnect();
      document.querySelectorAll<ManagedTopic>('.detail-topic-accordion').forEach(topic => {
        if (topic.__detailTopicClick) topic.removeEventListener('click', topic.__detailTopicClick);
        if (topic.__detailTopicKey) topic.removeEventListener('keydown', topic.__detailTopicKey);
      });
    };
  }, []);

  return null;
}
