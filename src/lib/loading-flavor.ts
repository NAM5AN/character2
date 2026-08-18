import { useEffect, useMemo, useState } from 'react';
import { applyName } from '@/lib/josa';

// 심즈 로딩 문구 스타일: 상담(인터뷰) 자리에서 캐릭터가 벌일 법한 짓 "~하는 중".
// 뜬금없어도 '그 자리에서 일어날 수 있는' 것이면 OK. 각 문구에 어울리는 성격 태그를 달아두고,
// 이미 분석한 텍스트(프로필·추론·성향 라벨·문답·요약)에서 감지한 태그와 겹치는 문구만 노출합니다.
// AI를 쓰지 않는 순수 키워드 매칭이라 토큰이 들지 않습니다.
type Flavor = { t: string; g: string[] };
const FLAVOR_POOL: Flavor[] = [
  // any: 성격과 무관하게 늘 어울리는 상담실 기본 상황 (대사 없이 행동만)
  { t: '{name}가 의자에 앉자마자 자세부터 고쳐 앉는 중', g: ['any'] },
  { t: '{name}가 카톡 읽씹해놓고 혼자 죄책감 느끼는 중', g: ['any'] },
  { t: '{name}가 괜히 시계 보며 끝나길 기다리는 중', g: ['any'] },
  { t: '{name}가 물컵만 만지작대며 딴청 부리는 중', g: ['any'] },
  { t: '{name}가 대기실에서 연습한 말 다 까먹은 중', g: ['any'] },
  // shy: 소심·수줍·내성
  { t: '{name}가 대답할수록 목소리가 작아지는 중', g: ['shy'] },
  { t: '{name}가 손 어디 둘지 몰라 무릎에 얹었다 뗐다 하는 중', g: ['shy'] },
  { t: '{name}가 발끝만 내려다보며 겨우 대답하는 중', g: ['shy'] },
  { t: '{name}가 말 꺼내려다 몇 번이나 다시 삼키는 중', g: ['shy'] },
  { t: '{name}가 얼굴 빨개져 소매 끝만 끌어당기는 중', g: ['shy'] },
  // proud: 도도·자신감·거만
  { t: '{name}가 다리 꼬고 여유로운 척 앉아있는 중', g: ['proud'] },
  { t: '{name}가 질문을 시시하다는 듯 웃어넘기는 중', g: ['proud'] },
  { t: '{name}가 턱을 살짝 들고 상담사를 내려다보는 중', g: ['proud'] },
  { t: '{name}가 자기 대답에 스스로 만족해 미소 짓는 중', g: ['proud'] },
  { t: '{name}가 머리 쓸어넘기며 여유를 뽐내는 중', g: ['proud'] },
  // cold: 차갑·시크·무뚝뚝·무심
  { t: '{name}가 단답으로 끊고 침묵으로 버티는 중', g: ['cold'] },
  { t: '{name}가 표정 하나 안 바꾸고 앉아있는 중', g: ['cold'] },
  { t: '{name}가 시계만 흘깃 보고 다시 무표정인 중', g: ['cold'] },
  { t: '{name}가 팔짱 낀 채 필요한 말만 하는 중', g: ['cold'] },
  { t: '{name}가 관심 없다는 듯 창밖으로 시선 돌리는 중', g: ['cold'] },
  // warm: 다정·따뜻·배려
  { t: '{name}가 상담사 컨디션까지 걱정해주는 중', g: ['warm'] },
  { t: '{name}가 대답 끝에 괜히 한 번 웃어주는 중', g: ['warm'] },
  { t: '{name}가 상담사 물잔 비면 슬쩍 채워주는 중', g: ['warm'] },
  { t: '{name}가 무거운 질문에도 부드럽게 고개 끄덕이는 중', g: ['warm'] },
  { t: '{name}가 어색해하는 상담사를 되려 다독이는 중', g: ['warm'] },
  // playful: 장난·짓궂·능글
  { t: '{name}가 질문을 농담으로 되받아치는 중', g: ['playful'] },
  { t: '{name}가 상담사 표정 따라 하며 장난치는 중', g: ['playful'] },
  { t: '{name}가 일부러 엉뚱한 답으로 반응 떠보는 중', g: ['playful'] },
  { t: '{name}가 의자 빙글빙글 돌리며 딴짓하는 중', g: ['playful'] },
  { t: '{name}가 상담사 펜을 슬쩍 가져가 돌리는 중', g: ['playful'] },
  // cheerful: 활발·밝·명랑
  { t: '{name}가 신나서 안 물어본 것까지 말하는 중', g: ['cheerful'] },
  { t: '{name}가 손짓 발짓 다 써가며 설명하는 중', g: ['cheerful'] },
  { t: '{name}가 웃음소리로 상담실을 채우는 중', g: ['cheerful'] },
  { t: '{name}가 자기 얘기하다 신나서 목소리 커지는 중', g: ['cheerful'] },
  { t: '{name}가 상담사한테 되레 질문을 쏟아내는 중', g: ['cheerful'] },
  // anxious: 예민·불안·눈치
  { t: '{name}가 이 대답이 맞았나 계속 곱씹는 중', g: ['anxious'] },
  { t: '{name}가 상담사 눈치를 세 번째 보는 중', g: ['anxious'] },
  { t: '{name}가 다리를 쉴 새 없이 떠는 중', g: ['anxious'] },
  { t: '{name}가 손톱 옆 거스러미만 계속 뜯는 중', g: ['anxious'] },
  { t: '{name}가 별말 아닌데 괜히 변명을 덧붙이는 중', g: ['anxious'] },
  // chaotic: 충동·엉뚱·산만·4차원
  { t: '{name}가 창밖 비둘기랑 눈싸움하는 중', g: ['chaotic'] },
  { t: '{name}가 질문은 잊고 천장 무늬 세는 중', g: ['chaotic'] },
  { t: '{name}가 갑자기 딴 얘기로 새는 중', g: ['chaotic'] },
  { t: '{name}가 대답하다 방금 무슨 말 했는지 까먹는 중', g: ['chaotic'] },
  { t: '{name}가 의자에서 자세를 열 번쯤 바꾸는 중', g: ['chaotic'] },
  // serious: 진지·원칙·논리
  { t: '{name}가 질문 의도부터 정색하고 따지는 중', g: ['serious'] },
  { t: '{name}가 대답을 논리적으로 정리해 말하는 중', g: ['serious'] },
  { t: '{name}가 대답하기 전 잠시 생각을 정돈하는 중', g: ['serious'] },
  { t: '{name}가 애매한 표현은 하나하나 바로잡는 중', g: ['serious'] },
  { t: '{name}가 상담 규칙부터 확인하고 시작하는 중', g: ['serious'] },
  // gloomy: 우울·냉소·무기력
  { t: '{name}가 시선을 바닥에 오래 두는 중', g: ['gloomy'] },
  { t: '{name}가 대답 끝마다 작게 한숨 쉬는 중', g: ['gloomy'] },
  { t: '{name}가 창밖 흐린 하늘만 오래 바라보는 중', g: ['gloomy'] },
  { t: '{name}가 기대 없는 얼굴로 어깨를 축 늘어뜨리는 중', g: ['gloomy'] },
  { t: '{name}가 다 부질없다는 듯 무기력하게 앉아있는 중', g: ['gloomy'] },
  // aggressive: 공격·다혈질·까칠
  { t: '{name}가 질문이 마음에 안 들어 발끈하는 중', g: ['aggressive'] },
  { t: '{name}가 언성부터 높였다 스스로 놀라는 중', g: ['aggressive'] },
  { t: '{name}가 책상을 툭 치고는 시선 홱 돌리는 중', g: ['aggressive'] },
  { t: '{name}가 마음에 안 드는 질문에 콧방귀 뀌는 중', g: ['aggressive'] },
  { t: '{name}가 다리 떨다 발을 쿵 내려놓는 중', g: ['aggressive'] },
  // guarded: 츤데레·방어·경계
  { t: '{name}가 별거 아닌 척 속마음은 끝까지 숨기는 중', g: ['guarded'] },
  { t: '{name}가 쿠션 끌어안고 방어 태세 잡는 중', g: ['guarded'] },
  { t: '{name}가 핵심 질문마다 슬쩍 말을 돌리는 중', g: ['guarded'] },
  { t: '{name}가 웃는 얼굴 뒤로 한 발 물러서는 중', g: ['guarded'] },
  { t: '{name}가 진짜 얘기는 끝까지 아껴두는 중', g: ['guarded'] },
  // calm: 침착·차분·담담
  { t: '{name}가 물 한 모금 마시고 차분히 답하는 중', g: ['calm'] },
  { t: '{name}가 서두르지 않고 한 박자 쉬어 말하는 중', g: ['calm'] },
  { t: '{name}가 어떤 질문에도 표정 흔들림 없이 답하는 중', g: ['calm'] },
  { t: '{name}가 손을 가지런히 모으고 천천히 대답하는 중', g: ['calm'] },
  { t: '{name}가 급할 것 없다는 듯 여유롭게 앉아있는 중', g: ['calm'] },
  // lazy: 게으름·느긋·귀찮
  { t: '{name}가 의자에 늘어져 반쯤 눕는 중', g: ['lazy'] },
  { t: '{name}가 다 귀찮다는 듯 대충 답하는 중', g: ['lazy'] },
  { t: '{name}가 하품 참으며 느릿느릿 대답하는 중', g: ['lazy'] },
  { t: '{name}가 질문 반쯤 흘려듣고 대충 끄덕이는 중', g: ['lazy'] },
  { t: '{name}가 턱 괴고 나른하게 천장 보는 중', g: ['lazy'] },
];
const FLAVOR_KEYWORDS: Record<string, string[]> = {
  shy: ['소심', '수줍', '낯가림', '낯을', '내성적', '부끄', '숫기', '조용', '움츠', '쭈뼛'],
  proud: ['도도', '거만', '오만', '자신감', '당당', '자부심', '콧대', '우월', '자존심', '프라이드', '고고'],
  cold: ['차가', '시크', '무뚝뚝', '냉정', '무심', '쌀쌀', '건조', '무표정', '까칠'],
  warm: ['다정', '따뜻', '상냥', '배려', '친절', '포근', '자상', '챙기', '살가'],
  playful: ['장난', '짓궂', '까불', '능글', '유쾌', '익살', '너스레', '농담'],
  cheerful: ['활발', '명랑', '쾌활', '발랄', '에너지', '텐션', '싹싹', '밝은', '밝고', '밝다'],
  anxious: ['예민', '불안', '걱정', '눈치', '긴장', '초조', '신경질', '노심', '조마'],
  chaotic: ['충동', '즉흥', '엉뚱', '산만', '사차원', '4차원', '제멋대로', '변덕', '자유분방', '괴짜', '기이', '파괴', '정신없', '종잡'],
  serious: ['진지', '원칙', '규칙', '완고', '엄격', '고지식', '반듯', '철저', '책임감', '논리', '성실', '올곧'],
  gloomy: ['우울', '어둡', '무기력', '냉소', '비관', '침울', '그늘', '자조', '염세', '시니컬'],
  aggressive: ['공격', '다혈질', '폭력', '사나', '과격', '거칠', '호전', '불같', '성깔', '욱하', '드센'],
  guarded: ['츤데레', '방어적', '경계', '무장', '내숭', '새침', '벽을', '벽이', '속마음', '비밀'],
  calm: ['침착', '차분', '냉철', '담담', '평온', '태연', '의젓', '묵직'],
  lazy: ['게으', '느긋', '태평', '귀찮', '나태', '늘어지', '늘어진'],
};

function detectFlavorTags(text: string): Set<string> {
  const t = (text || '').toLowerCase();
  const tags = new Set<string>();
  for (const tag of Object.keys(FLAVOR_KEYWORDS)) {
    if (FLAVOR_KEYWORDS[tag].some(word => t.includes(word))) tags.add(tag);
  }
  return tags;
}

export function pickFlavors(text: string): string[] {
  const tags = detectFlavorTags(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const flavor of FLAVOR_POOL) {
    if (!flavor.g.some(tag => tag === 'any' || tags.has(tag))) continue;
    if (seen.has(flavor.t)) continue;
    seen.add(flavor.t);
    out.push(flavor.t);
  }
  return out.length ? out : FLAVOR_POOL.filter(f => f.g.includes('any')).map(f => f.t);
}

// 캐릭터 분석 텍스트로 어울리는 문구 세트를 골라, 생성 중일 때 2.6초마다 순환시켜 반환한다.
export function useRotatingFlavor(signalText: string, name: string, active: boolean): string {
  const flavors = useMemo(() => pickFlavors(signalText), [signalText]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    setTick(Math.floor(Math.random() * 997));
    const id = window.setInterval(() => setTick(t => t + 1), 2600);
    return () => window.clearInterval(id);
  }, [active]);
  const safeName = (name || '이 캐릭터').trim() || '이 캐릭터';
  return applyName(flavors[tick % flavors.length] || '', safeName);
}
