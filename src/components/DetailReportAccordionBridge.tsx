'use client';

import { useEffect } from 'react';

type ManagedTopic = HTMLElement & {
  __detailTopicClick?: EventListener;
  __detailTopicKey?: EventListener;
  __detailTopicAnimation?: Animation;
};

type ManagedBlock = HTMLElement & {
  __detailBlockAnimation?: Animation;
};

const SECTION_DURATION = 480;
const TOPIC_DURATION = 400;
const BLOCK_DURATION = 420;
const EASING = 'cubic-bezier(.22,.72,.2,1)';

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function topicBlocks(topic: HTMLElement): ManagedBlock[] {
  const blocks: ManagedBlock[] = [];
  let next = topic.nextElementSibling;
  while (next && !next.matches('article.topic')) {
    if (next instanceof HTMLElement && next.classList.contains('study-block')) blocks.push(next as ManagedBlock);
    next = next.nextElementSibling;
  }
  return blocks;
}

function animateSectionGrid(grid: HTMLElement) {
  if (reducedMotion() || grid.dataset.detailOpenAnimated === '1') return;
  const section = grid.closest<HTMLElement>('.report-section');
  if (!section?.classList.contains('is-open')) return;
  grid.dataset.detailOpenAnimated = '1';

  const computed = window.getComputedStyle(grid);
  const targetHeight = Math.max(grid.scrollHeight, grid.getBoundingClientRect().height);
  const targetMarginTop = computed.marginTop;
  grid.style.overflow = 'hidden';

  const animation = grid.animate([
    {
      height: '0px',
      marginTop: '0px',
      opacity: 0,
      transform: 'translateY(-14px)',
    },
    {
      height: `${targetHeight}px`,
      marginTop: targetMarginTop,
      opacity: 1,
      transform: 'translateY(0)',
    },
  ], {
    duration: SECTION_DURATION,
    easing: EASING,
    fill: 'both',
  });

  void animation.finished.finally(() => {
    grid.style.overflow = '';
    animation.cancel();
  });
}

function animateTopicHeight(topic: ManagedTopic, from: number, to: number) {
  if (reducedMotion() || Math.abs(from - to) < 1) return;
  topic.__detailTopicAnimation?.cancel();
  topic.style.overflow = 'hidden';
  const animation = topic.animate([
    { height: `${from}px` },
    { height: `${to}px` },
  ], {
    duration: TOPIC_DURATION,
    easing: EASING,
    fill: 'both',
  });
  topic.__detailTopicAnimation = animation;
  void animation.finished.finally(() => {
    if (topic.__detailTopicAnimation === animation) topic.__detailTopicAnimation = undefined;
    topic.style.overflow = '';
    animation.cancel();
  });
}

function animateTopicBody(topic: ManagedTopic) {
  if (reducedMotion()) return;
  const body = topic.querySelector<HTMLElement>(':scope p');
  if (!body) return;
  body.animate([
    { opacity: 0, transform: 'translateY(-10px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], {
    duration: 330,
    delay: 55,
    easing: EASING,
    fill: 'both',
  });
}

function openBlock(block: ManagedBlock, immediate: boolean) {
  block.__detailBlockAnimation?.cancel();
  block.hidden = false;
  block.setAttribute('aria-hidden', 'false');
  if (immediate || reducedMotion()) return;

  const computed = window.getComputedStyle(block);
  const targetHeight = block.getBoundingClientRect().height;
  const animation = block.animate([
    {
      height: '0px',
      marginTop: '0px',
      marginBottom: '0px',
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
      marginBottom: computed.marginBottom,
      paddingTop: computed.paddingTop,
      paddingBottom: computed.paddingBottom,
      borderTopWidth: computed.borderTopWidth,
      borderBottomWidth: computed.borderBottomWidth,
      opacity: 1,
      transform: 'translateY(0)',
    },
  ], {
    duration: BLOCK_DURATION,
    delay: 45,
    easing: EASING,
    fill: 'both',
  });
  block.__detailBlockAnimation = animation;
  block.style.overflow = 'hidden';
  void animation.finished.finally(() => {
    if (block.__detailBlockAnimation === animation) block.__detailBlockAnimation = undefined;
    block.style.overflow = '';
    animation.cancel();
  });
}

function closeBlock(block: ManagedBlock, immediate: boolean) {
  block.__detailBlockAnimation?.cancel();
  block.setAttribute('aria-hidden', 'true');
  if (immediate || reducedMotion()) {
    block.hidden = true;
    return;
  }

  const computed = window.getComputedStyle(block);
  const startHeight = block.getBoundingClientRect().height;
  block.style.overflow = 'hidden';
  const animation = block.animate([
    {
      height: `${startHeight}px`,
      marginTop: computed.marginTop,
      marginBottom: computed.marginBottom,
      paddingTop: computed.paddingTop,
      paddingBottom: computed.paddingBottom,
      borderTopWidth: computed.borderTopWidth,
      borderBottomWidth: computed.borderBottomWidth,
      opacity: 1,
      transform: 'translateY(0)',
    },
    {
      height: '0px',
      marginTop: '0px',
      marginBottom: '0px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      opacity: 0,
      transform: 'translateY(-8px)',
    },
  ], {
    duration: 300,
    easing: 'cubic-bezier(.4,0,.25,1)',
    fill: 'forwards',
  });
  block.__detailBlockAnimation = animation;
  void animation.finished.finally(() => {
    if (block.__detailBlockAnimation === animation) block.__detailBlockAnimation = undefined;
    block.hidden = true;
    block.style.overflow = '';
    animation.cancel();
  });
}

function syncTopic(topic: ManagedTopic, open: boolean, immediate = false) {
  const startHeight = topic.getBoundingClientRect().height;
  topic.classList.toggle('is-topic-open', open);
  topic.setAttribute('aria-expanded', open ? 'true' : 'false');
  const endHeight = topic.getBoundingClientRect().height;

  if (!immediate) animateTopicHeight(topic, startHeight, endHeight);
  if (open && !immediate) animateTopicBody(topic);

  topicBlocks(topic).forEach(block => {
    if (open) openBlock(block, immediate);
    else closeBlock(block, immediate);
  });
}

function bindTopic(topic: ManagedTopic) {
  if (topic.dataset.detailTopicAccordion === '1') return;
  topic.dataset.detailTopicAccordion = '1';
  topic.classList.add('detail-topic-accordion');
  topic.setAttribute('role', 'button');
  topic.setAttribute('tabindex', '0');
  topic.setAttribute('aria-expanded', 'false');
  syncTopic(topic, false, true);

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
  // then leave subsequent user toggles untouched. User-opened topic grids are
  // animated when React inserts them back into the DOM.
  if (section.classList.contains('is-open')) {
    const head = section.querySelector<HTMLElement>(':scope > .section-head');
    head?.click();
  }
}

function collectAddedGrids(node: Node, grids: Set<HTMLElement>) {
  if (!(node instanceof HTMLElement)) return;
  if (node.matches('.report-mag .topic-grid')) grids.add(node);
  node.querySelectorAll<HTMLElement>('.report-mag .topic-grid').forEach(grid => grids.add(grid));
}

export function DetailReportAccordionBridge() {
  useEffect(() => {
    const enhance = () => {
      document.querySelectorAll<HTMLElement>('.report-mag .report-section').forEach(initializeSection);
      document.querySelectorAll<ManagedTopic>('.report-mag .topic-grid > article.topic').forEach(bindTopic);
    };

    enhance();
    let queued = false;
    const pendingGrids = new Set<HTMLElement>();
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => mutation.addedNodes.forEach(node => collectAddedGrids(node, pendingGrids)));
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        enhance();
        pendingGrids.forEach(animateSectionGrid);
        pendingGrids.clear();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<ManagedTopic>('.detail-topic-accordion').forEach(topic => {
        topic.__detailTopicAnimation?.cancel();
        if (topic.__detailTopicClick) topic.removeEventListener('click', topic.__detailTopicClick);
        if (topic.__detailTopicKey) topic.removeEventListener('keydown', topic.__detailTopicKey);
      });
      document.querySelectorAll<ManagedBlock>('.study-block').forEach(block => block.__detailBlockAnimation?.cancel());
    };
  }, []);

  return null;
}
