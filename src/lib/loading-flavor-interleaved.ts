import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyName } from '@/lib/josa';
import {
  PERSONALITY_TAG_CATALOG,
  isPersonalityTagKey,
  type PersonalityTagKey,
} from '@/lib/personality-tags';
import { pickFlavors as groupedPickFlavors } from './loading-flavor';

const LOADING_TAG_KEY = 'chara_lab_personality_loading_tags_v1';
const ANALYSIS_SESSION_KEY = 'chara_lab_analysis_session_v1';
const LOADING_TAG_EVENT = 'chara-personality-loading-tags';

type LoadingTagState = {
  sessionId: string;
  tags: PersonalityTagKey[];
  source: 'owner' | 'interview' | 'final';
};

const PersonalityFlavorContext = createContext<PersonalityTagKey[] | null | undefined>(undefined);

function normalizeTags(value: unknown): PersonalityTagKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPersonalityTagKey))];
}

function detectFlavorTags(text: string): PersonalityTagKey[] {
  const normalized = (text || '').toLowerCase();
  const tags: PersonalityTagKey[] = [];
  for (const definition of PERSONALITY_TAG_CATALOG) {
    if (definition.keywords.some(word => normalized.includes(word.toLowerCase()))) tags.push(definition.key);
  }
  return tags;
}

const COMMON_FLAVORS = groupedPickFlavors('', []);
const COMMON_SET = new Set(COMMON_FLAVORS);

function tagFlavorGroup(tag: PersonalityTagKey) {
  return groupedPickFlavors('', [tag]).filter(text => !COMMON_SET.has(text));
}

function roundRobin(groups: string[][]) {
  const active = groups.filter(group => group.length > 0);
  if (!active.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(...active.map(group => group.length));

  // AAAAA BBBBB CCCCC 형태가 아니라 A1 B1 C1 A2 B2 C2 순으로 교차한다.
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of active) {
      const text = group[index];
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

export function pickFlavors(text: string, explicitTags?: PersonalityTagKey[] | null): string[] {
  // null/undefined = 아직 확정 태그 없음 → 텍스트 키워드 fallback.
  // [] = 오너가 의도적으로 아무 태그도 고르지 않음 → 공통 문구만.
  const tags = explicitTags == null ? detectFlavorTags(text) : normalizeTags(explicitTags);
  if (!tags.length) return [...COMMON_FLAVORS];

  const interleaved = roundRobin(tags.map(tagFlavorGroup));
  return interleaved.length ? interleaved : [...COMMON_FLAVORS];
}

function currentAnalysisSessionId() {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem(ANALYSIS_SESSION_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { draft?: { usageSessionId?: unknown } };
    return typeof parsed.draft?.usageSessionId === 'string' ? parsed.draft.usageSessionId : '';
  } catch {
    return '';
  }
}

function readBrowserLoadingTags(): PersonalityTagKey[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOADING_TAG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LoadingTagState>;
    const currentSession = currentAnalysisSessionId();
    if (currentSession && parsed.sessionId !== currentSession) return null;
    return normalizeTags(parsed.tags);
  } catch {
    return null;
  }
}

export function setLoadingPersonalityTags(
  sessionId: string,
  tags: PersonalityTagKey[],
  source: LoadingTagState['source'],
) {
  if (typeof window === 'undefined' || !sessionId) return;
  const state: LoadingTagState = { sessionId, tags: normalizeTags(tags), source };
  try {
    localStorage.setItem(LOADING_TAG_KEY, JSON.stringify(state));
  } catch {}
  window.dispatchEvent(new CustomEvent<LoadingTagState>(LOADING_TAG_EVENT, { detail: state }));
}

export function PersonalityFlavorProvider({
  tags,
  children,
}: {
  tags: PersonalityTagKey[] | null;
  children: ReactNode;
}) {
  return createElement(PersonalityFlavorContext.Provider, { value: tags }, children);
}

export function useRotatingFlavor(
  signalText: string,
  name: string,
  active: boolean,
  preferredTags?: PersonalityTagKey[] | null,
): string {
  const contextTags = useContext(PersonalityFlavorContext);
  const [browserTags, setBrowserTags] = useState<PersonalityTagKey[] | null>(() => readBrowserLoadingTags());

  useEffect(() => {
    const refresh = () => setBrowserTags(readBrowserLoadingTags());
    const onTags = (event: Event) => {
      const custom = event as CustomEvent<LoadingTagState>;
      const currentSession = currentAnalysisSessionId();
      if (currentSession && custom.detail?.sessionId !== currentSession) return;
      setBrowserTags(normalizeTags(custom.detail.tags));
    };
    window.addEventListener(LOADING_TAG_EVENT, onTags);
    window.addEventListener('storage', refresh);
    refresh();
    return () => {
      window.removeEventListener(LOADING_TAG_EVENT, onTags);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const explicitTags = preferredTags !== undefined
    ? preferredTags
    : contextTags !== undefined
      ? contextTags
      : browserTags;
  const tagKey = explicitTags == null ? 'fallback' : normalizeTags(explicitTags).join('|');
  const flavors = useMemo(() => pickFlavors(signalText, explicitTags), [signalText, tagKey]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    setTick(Math.floor(Math.random() * 997));
    const id = window.setInterval(() => setTick(value => value + 1), 2600);
    return () => window.clearInterval(id);
  }, [active, tagKey]);

  const safeName = (name || '이 캐릭터').trim() || '이 캐릭터';
  return applyName(flavors[tick % flavors.length] || '', safeName);
}
