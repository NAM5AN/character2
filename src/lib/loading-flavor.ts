import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyName } from '@/lib/josa';
import {
  PERSONALITY_TAG_CATALOG,
  isPersonalityTagKey,
  type PersonalityTagKey,
} from '@/lib/personality-tags';

// 심즈 로딩 문구 스타일: 상담(인터뷰) 자리에서 캐릭터가 벌일 법한 짓 "~하는 중".
// 오너/AI가 확정한 성격 태그가 있으면 그 태그를 최우선으로 사용하고,
// 태그 정보가 없는 구버전 캐릭터나 분석 초기 단계에서만 텍스트 키워드 감지를 fallback으로 사용합니다.
type Flavor = { t: string; g: Array<PersonalityTagKey | 'any'> };
const FLAVOR_POOL: Flavor[] = [
  { t: '{name}가 의자에 앉자마자 자세부터 고쳐 앉는 중', g: ['any'] },
  { t: '{name}가 상담실 의자가 편한지 살짝 움직여보는 중', g: ['any'] },
  { t: '{name}가 상담실 안을 천천히 둘러보는 중', g: ['any'] },
  { t: '{name}가 상담사가 첫 질문을 고르길 기다리는 중', g: ['any'] },
  { t: '{name}가 책상 위에 놓인 안내문을 슬쩍 읽어보는 중', g: ['any'] },
  { t: '{name}가 상담 시작 안내를 듣고 고개를 끄덕이는 중', g: ['any'] },

  { t: '{name}가 대답할수록 목소리가 작아지는 중', g: ['shy'] },
  { t: '{name}가 손 어디 둘지 몰라 무릎에 얹었다 뗐다 하는 중', g: ['shy'] },
  { t: '{name}가 발끝만 내려다보며 겨우 대답하는 중', g: ['shy'] },
  { t: '{name}가 말 꺼내려다 몇 번이나 다시 삼키는 중', g: ['shy'] },
  { t: '{name}가 얼굴 빨개져 소매 끝만 끌어당기는 중', g: ['shy'] },
  { t: '{name}가 물컵만 만지작대며 딴청 부리는 중', g: ['shy'] },

  { t: '{name}가 다리 꼬고 여유로운 척 앉아있는 중', g: ['proud'] },
  { t: '{name}가 질문을 시시하다는 듯 웃어넘기는 중', g: ['proud'] },
  { t: '{name}가 턱을 살짝 들고 상담사를 내려다보는 중', g: ['proud'] },
  { t: '{name}가 자기 대답에 스스로 만족해 미소 짓는 중', g: ['proud'] },
  { t: '{name}가 머리 쓸어넘기며 여유를 뽐내는 중', g: ['proud'] },

  { t: '{name}가 단답으로 끊고 침묵으로 버티는 중', g: ['cold'] },
  { t: '{name}가 표정 하나 안 바꾸고 앉아있는 중', g: ['cold'] },
  { t: '{name}가 시계만 흘깃 보고 다시 무표정인 중', g: ['cold'] },
  { t: '{name}가 팔짱 낀 채 필요한 말만 하는 중', g: ['cold'] },
  { t: '{name}가 관심 없다는 듯 창밖으로 시선 돌리는 중', g: ['cold'] },

  { t: '{name}가 상담사 컨디션까지 걱정해주는 중', g: ['warm'] },
  { t: '{name}가 대답 끝에 괜히 한 번 웃어주는 중', g: ['warm'] },
  { t: '{name}가 상담사 물잔 비면 슬쩍 채워주는 중', g: ['warm'] },
  { t: '{name}가 무거운 질문에도 부드럽게 고개 끄덕이는 중', g: ['warm'] },
  { t: '{name}가 어색해하는 상담사를 되려 다독이는 중', g: ['warm'] },

  { t: '{name}가 질문을 농담으로 되받아치는 중', g: ['playful'] },
  { t: '{name}가 상담사 표정 따라 하며 장난치는 중', g: ['playful'] },
  { t: '{name}가 일부러 엉뚱한 답으로 반응 떠보는 중', g: ['playful'] },
  { t: '{name}가 의자 빙글빙글 돌리며 딴짓하는 중', g: ['playful'] },
  { t: '{name}가 상담사 펜을 슬쩍 가져가 돌리는 중', g: ['playful'] },

  { t: '{name}가 신나서 안 물어본 것까지 말하는 중', g: ['cheerful'] },
  { t: '{name}가 손짓 발짓 다 써가며 설명하는 중', g: ['cheerful'] },
  { t: '{name}가 웃음소리로 상담실을 채우는 중', g: ['cheerful'] },
  { t: '{name}가 자기 얘기하다 신나서 목소리 커지는 중', g: ['cheerful'] },
  { t: '{name}가 상담사한테 되레 질문을 쏟아내는 중', g: ['cheerful'] },

  { t: '{name}가 이 대답이 맞았나 계속 곱씹는 중', g: ['anxious'] },
  { t: '{name}가 상담사 눈치를 세 번째 보는 중', g: ['anxious'] },
  { t: '{name}가 다리를 쉴 새 없이 떠는 중', g: ['anxious'] },
  { t: '{name}가 손톱 옆 거스러미만 계속 뜯는 중', g: ['anxious'] },
  { t: '{name}가 별말 아닌데 괜히 변명을 덧붙이는 중', g: ['anxious'] },
  { t: '{name}가 카톡 읽씹해놓고 혼자 죄책감 느끼는 중', g: ['anxious'] },
  { t: '{name}가 대기실에서 연습한 말 다 까먹은 중', g: ['anxious'] },

  { t: '{name}가 창밖 비둘기랑 눈싸움하는 중', g: ['chaotic'] },
  { t: '{name}가 질문은 잊고 천장 무늬 세는 중', g: ['chaotic'] },
  { t: '{name}가 갑자기 딴 얘기로 새는 중', g: ['chaotic'] },
  { t: '{name}가 대답하다 방금 무슨 말 했는지 까먹는 중', g: ['chaotic'] },
  { t: '{name}가 의자에서 자세를 열 번쯤 바꾸는 중', g: ['chaotic'] },

  { t: '{name}가 질문 의도부터 정색하고 따지는 중', g: ['serious'] },
  { t: '{name}가 대답을 논리적으로 정리해 말하는 중', g: ['serious'] },
  { t: '{name}가 대답하기 전 잠시 생각을 정돈하는 중', g: ['serious'] },
  { t: '{name}가 애매한 표현은 하나하나 바로잡는 중', g: ['serious'] },
  { t: '{name}가 상담 규칙부터 확인하고 시작하는 중', g: ['serious'] },

  { t: '{name}가 시선을 바닥에 오래 두는 중', g: ['gloomy'] },
  { t: '{name}가 대답 끝마다 작게 한숨 쉬는 중', g: ['gloomy'] },
  { t: '{name}가 창밖 흐린 하늘만 오래 바라보는 중', g: ['gloomy'] },
  { t: '{name}가 기대 없는 얼굴로 어깨를 축 늘어뜨리는 중', g: ['gloomy'] },
  { t: '{name}가 다 부질없다는 듯 무기력하게 앉아있는 중', g: ['gloomy'] },

  { t: '{name}가 질문이 마음에 안 들어 발끈하는 중', g: ['aggressive'] },
  { t: '{name}가 언성부터 높였다 스스로 놀라는 중', g: ['aggressive'] },
  { t: '{name}가 책상을 툭 치고는 시선 홱 돌리는 중', g: ['aggressive'] },
  { t: '{name}가 마음에 안 드는 질문에 콧방귀 뀌는 중', g: ['aggressive'] },
  { t: '{name}가 다리 떨다 발을 쿵 내려놓는 중', g: ['aggressive'] },

  { t: '{name}가 별거 아닌 척 속마음은 끝까지 숨기는 중', g: ['guarded'] },
  { t: '{name}가 쿠션 끌어안고 방어 태세 잡는 중', g: ['guarded'] },
  { t: '{name}가 핵심 질문마다 슬쩍 말을 돌리는 중', g: ['guarded'] },
  { t: '{name}가 웃는 얼굴 뒤로 한 발 물러서는 중', g: ['guarded'] },
  { t: '{name}가 진짜 얘기는 끝까지 아껴두는 중', g: ['guarded'] },

  { t: '{name}가 물 한 모금 마시고 차분히 답하는 중', g: ['calm'] },
  { t: '{name}가 서두르지 않고 한 박자 쉬어 말하는 중', g: ['calm'] },
  { t: '{name}가 어떤 질문에도 표정 흔들림 없이 답하는 중', g: ['calm'] },
  { t: '{name}가 손을 가지런히 모으고 천천히 대답하는 중', g: ['calm'] },
  { t: '{name}가 급할 것 없다는 듯 여유롭게 앉아있는 중', g: ['calm'] },

  { t: '{name}가 의자에 늘어져 반쯤 눕는 중', g: ['lazy'] },
  { t: '{name}가 다 귀찮다는 듯 대충 답하는 중', g: ['lazy'] },
  { t: '{name}가 하품 참으며 느릿느릿 대답하는 중', g: ['lazy'] },
  { t: '{name}가 질문 반쯤 흘려듣고 대충 끄덕이는 중', g: ['lazy'] },
  { t: '{name}가 턱 괴고 나른하게 천장 보는 중', g: ['lazy'] },
  { t: '{name}가 괜히 시계 보며 끝나길 기다리는 중', g: ['lazy'] },

  { t: '{name}가 책상 위 물건들을 1cm 단위로 각 맞추는 중', g: ['perfectionist'] },
  { t: '{name}가 방금 한 대답이 완벽하지 않다며 처음부터 다시 하는 중', g: ['perfectionist'] },
  { t: '{name}가 상담사 넥타이가 삐뚤어진 걸 못 견뎌 하는 중', g: ['perfectionist'] },
  { t: '{name}가 자기 대답을 속으로 채점하며 감점하는 중', g: ['perfectionist'] },
  { t: '{name}가 벽에 걸린 액자가 수평인지 고개 기울여 확인하는 중', g: ['perfectionist'] },

  { t: '{name}가 이 상담이 자기한테 무슨 이득인지 계산하는 중', g: ['calculating'] },
  { t: '{name}가 어느 대답이 유리할지 머릿속으로 저울질하는 중', g: ['calculating'] },
  { t: '{name}가 상담사 표정 보며 정답을 역산하는 중', g: ['calculating'] },
  { t: '{name}가 괜히 손해 볼 말은 안 하려 단어를 고르는 중', g: ['calculating'] },
  { t: '{name}가 상담비가 아깝지 않은지 속으로 따져보는 중', g: ['calculating'] },

  { t: '{name}가 아까 빌려준 펜을 계속 눈으로 좇는 중', g: ['possessive'] },
  { t: '{name}가 상담사가 딴생각하는 것 같아 신경 곤두세우는 중', g: ['possessive'] },
  { t: '{name}가 상담사 관심을 독차지하려 화제를 붙드는 중', g: ['possessive'] },
  { t: '{name}가 자기 얘기 도중 시선이 딴 데 갈까 확인하는 중', g: ['possessive'] },
  { t: '{name}가 두고 갈 물건 하나까지 손에 꼭 쥐는 중', g: ['possessive'] },

  { t: '{name}가 이 대답이 맞는지 상담사에게 되묻는 중', g: ['dependent'] },
  { t: '{name}가 상담사가 고개 끄덕여주길 기다렸다 말 잇는 중', g: ['dependent'] },
  { t: '{name}가 혼자 정하기 어려워 결정을 자꾸 미루는 중', g: ['dependent'] },
  { t: '{name}가 이래도 될까요를 벌써 세 번째 묻는 중', g: ['dependent'] },
  { t: '{name}가 상담사 반응부터 살피고 대답을 고르는 중', g: ['dependent'] },

  { t: '{name}가 상담사 말을 하나도 안 의심하고 다 믿는 중', g: ['naive'] },
  { t: '{name}가 농담을 진담으로 알아듣고 진지해지는 중', g: ['naive'] },
  { t: '{name}가 함정 질문인 줄도 모르고 술술 다 말하는 중', g: ['naive'] },
  { t: '{name}가 처음 본 상담사한테 벌써 마음을 활짝 여는 중', g: ['naive'] },
  { t: '{name}가 세상 사람 다 착한 줄 알고 방긋 웃는 중', g: ['naive'] },

  { t: '{name}가 상담 순서를 자기가 정하려 드는 중', g: ['dominant'] },
  { t: '{name}가 제가 먼저 질문할게요 하며 주도권 잡는 중', g: ['dominant'] },
  { t: '{name}가 대화 흐름을 슬쩍 자기 쪽으로 끌고 가는 중', g: ['dominant'] },
  { t: '{name}가 팔짱 끼고 상황을 총괄하려 드는 중', g: ['dominant'] },
  { t: '{name}가 상담사에게 다음 질문을 지정해주는 중', g: ['dominant'] },

  { t: '{name}가 틀렸다는 말에도 뜻을 안 굽히는 중', g: ['stubborn'] },
  { t: '{name}가 아까 한 말을 끝까지 번복 안 하는 중', g: ['stubborn'] },
  { t: '{name}가 다른 관점 얘기에 팔짱만 더 꽉 끼는 중', g: ['stubborn'] },
  { t: '{name}가 그래도 제 말이 맞다며 제자리로 돌아오는 중', g: ['stubborn'] },
  { t: '{name}가 의자를 자기 원하는 각도로만 두려는 중', g: ['stubborn'] },

  { t: '{name}가 상담을 무슨 시험처럼 만점 받으려는 중', g: ['competitive'] },
  { t: '{name}가 앞사람보다 잘 대답했나 은근히 궁금해하는 중', g: ['competitive'] },
  { t: '{name}가 질문을 이기고 지는 승부로 여기는 중', g: ['competitive'] },
  { t: '{name}가 이 정도면 1등이죠 하고 확인받는 중', g: ['competitive'] },
  { t: '{name}가 상담사와 눈싸움에서도 안 지려 버티는 중', g: ['competitive'] },

  { t: '{name}가 상담사 서류를 거꾸로도 읽어보려는 중', g: ['curious'] },
  { t: '{name}가 되레 상담사한테 질문 공세를 퍼붓는 중', g: ['curious'] },
  { t: '{name}가 벽에 걸린 자격증을 한참 뜯어보는 중', g: ['curious'] },
  { t: '{name}가 녹음기가 어떻게 작동하는지 궁금해하는 중', g: ['curious'] },
  { t: '{name}가 그건 왜요를 벌써 다섯 번째 묻는 중', g: ['curious'] },

  { t: '{name}가 자기 얘기는 제쳐두고 상담사 걱정을 하는 중', g: ['self_sacrificing'] },
  { t: '{name}가 시간 다 됐다며 자기 질문을 양보하는 중', g: ['self_sacrificing'] },
  { t: '{name}가 상담사 힘들까 봐 대답을 짧게 줄이는 중', g: ['self_sacrificing'] },
  { t: '{name}가 자기보다 다음 사람 순서를 먼저 챙기는 중', g: ['self_sacrificing'] },
  { t: '{name}가 안 괜찮으면서 저는 괜찮아요 하는 중', g: ['self_sacrificing'] },

  { t: '{name}가 별것 아닌 얘기를 대하드라마처럼 풀어놓는 중', g: ['theatrical'] },
  { t: '{name}가 상담사 리액션이 약하자 더 크게 한숨 쉬는 중', g: ['theatrical'] },
  { t: '{name}가 조명이 자기한테 잘 드는 자리로 옮겨 앉는 중', g: ['theatrical'] },
  { t: '{name}가 눈물 연기까지 곁들여 사연을 말하는 중', g: ['theatrical'] },
  { t: '{name}가 상담사가 자기만 봐주는지 자꾸 확인하는 중', g: ['theatrical'] },

  { t: '{name}가 앉으라는 의자 말고 굳이 다른 데 앉는 중', g: ['rebellious'] },
  { t: '{name}가 상담 규칙을 왜 지켜야 하냐고 따지는 중', g: ['rebellious'] },
  { t: '{name}가 정해진 질문 순서를 일부러 무시하는 중', g: ['rebellious'] },
  { t: '{name}가 팔짱 끼고 삐딱하게 다리 꼬는 중', g: ['rebellious'] },
  { t: '{name}가 하지 말라는 건 꼭 한 번 해보려는 중', g: ['rebellious'] },

  { t: '{name}가 질문은 흘려듣고 창밖 구름에 이름 붙이는 중', g: ['dreamy'] },
  { t: '{name}가 대답하다 말고 딴 세계로 여행 떠난 중', g: ['dreamy'] },
  { t: '{name}가 천장을 밤하늘이라 상상하며 별을 세는 중', g: ['dreamy'] },
  { t: '{name}가 만약에 제가 새라면요 로 얘기를 시작하는 중', g: ['dreamy'] },
  { t: '{name}가 눈은 뜨고 있는데 꿈속을 헤매는 중', g: ['dreamy'] },

  { t: '{name}가 분위기 싸해진 줄도 모르고 태평하게 웃는 중', g: ['oblivious'] },
  { t: '{name}가 상담사 눈치 신호를 하나도 못 알아채는 중', g: ['oblivious'] },
  { t: '{name}가 민감한 질문을 아무렇지 않게 툭 넘기는 중', g: ['oblivious'] },
  { t: '{name}가 다들 조용한데 혼자 과자 봉지 뜯는 중', g: ['oblivious'] },
  { t: '{name}가 진지한 순간에 엉뚱한 포인트에서 웃는 중', g: ['oblivious'] },

  { t: '{name}가 별것 아닌 질문에도 눈물이 그렁그렁해지는 중', g: ['sentimental'] },
  { t: '{name}가 자기 얘기하다 스스로 감동해 울컥하는 중', g: ['sentimental'] },
  { t: '{name}가 상담실 화분 잎사귀를 보고도 뭉클해하는 중', g: ['sentimental'] },
  { t: '{name}가 휴지를 미리 한 장 뽑아 손에 쥐고 있는 중', g: ['sentimental'] },
  { t: '{name}가 슬픈 기억에 목소리가 잠겨 잠시 멈추는 중', g: ['sentimental'] },

  { t: '{name}가 안 물어본 자기 무용담을 늘어놓는 중', g: ['boastful'] },
  { t: '{name}가 별거 아닌 일을 열 배로 부풀려 말하는 중', g: ['boastful'] },
  { t: '{name}가 상담사한테 되레 아는 척 훈수 두는 중', g: ['boastful'] },
  { t: '{name}가 긴장한 걸 들킬까 봐 더 큰소리치는 중', g: ['boastful'] },
  { t: '{name}가 팔자 좋은 척 다리 꼬고 으스대는 중', g: ['boastful'] },
];

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
    // 분석 진행 중에는 세션이 일치할 때만 사용한다. finalize가 끝난 직후에는
    // 분석 세션이 지워지므로 방금 계산한 태그를 그대로 유지해 상세 리포트 로딩에도 쓴다.
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

function detectFlavorTags(text: string): Set<PersonalityTagKey> {
  const normalized = (text || '').toLowerCase();
  const tags = new Set<PersonalityTagKey>();
  for (const definition of PERSONALITY_TAG_CATALOG) {
    if (definition.keywords.some(word => normalized.includes(word.toLowerCase()))) tags.add(definition.key);
  }
  return tags;
}

function flavorList(tags: Set<PersonalityTagKey>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const flavor of FLAVOR_POOL) {
    if (!flavor.g.some(tag => tag === 'any' || tags.has(tag))) continue;
    if (seen.has(flavor.t)) continue;
    seen.add(flavor.t);
    out.push(flavor.t);
  }
  return out.length ? out : FLAVOR_POOL.filter(flavor => flavor.g.includes('any')).map(flavor => flavor.t);
}

export function pickFlavors(text: string, explicitTags?: PersonalityTagKey[] | null): string[] {
  // null/undefined는 "아직 확정 태그 없음"이므로 키워드 fallback.
  // []는 오너가 의도적으로 아무 태그도 선택하지 않은 상태이므로 공통 문구만 사용.
  const tags = explicitTags == null ? detectFlavorTags(text) : new Set(normalizeTags(explicitTags));
  return flavorList(tags);
}

// 우선순위: 명시적으로 전달된 태그 > 리포트 컨텍스트 태그 > 현재 분석 세션의 오너/인터뷰 태그 > 키워드 fallback.
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
