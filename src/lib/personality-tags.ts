export const PERSONALITY_TAG_MAX_SELECTIONS = 5;

export const PERSONALITY_TAG_CATALOG = [
  { key:'shy', label:'수줍은', family:'소심 · 수줍 · 내성적인 계열', keywords:['소심','수줍','낯가림','낯을','내성적','부끄','숫기','조용','움츠','쭈뼛'] },
  { key:'proud', label:'당당한', family:'도도 · 자신감 · 자존심이 강한 계열', keywords:['도도','거만','오만','자신감','당당','자부심','콧대','우월','자존심','프라이드','고고'] },
  { key:'cold', label:'무심한', family:'차갑 · 시크 · 무뚝뚝한 계열', keywords:['차가','시크','무뚝뚝','냉정','무심','쌀쌀','건조','무표정','까칠'] },
  { key:'warm', label:'다정한', family:'다정 · 따뜻 · 배려하는 계열', keywords:['다정','따뜻','상냥','배려','친절','포근','자상','챙기','살가'] },
  { key:'playful', label:'장난스러운', family:'장난 · 능글 · 짓궂은 계열', keywords:['장난','짓궂','까불','능글','유쾌','익살','너스레','농담'] },
  { key:'cheerful', label:'활발한', family:'밝음 · 명랑 · 활동적인 계열', keywords:['활발','명랑','쾌활','발랄','에너지','텐션','싹싹','밝은','밝고','밝다'] },
  { key:'anxious', label:'예민한', family:'불안 · 눈치 · 걱정이 많은 계열', keywords:['예민','불안','걱정','눈치','긴장','초조','신경질','노심','조마'] },
  { key:'chaotic', label:'엉뚱한', family:'충동 · 즉흥 · 산만 · 4차원 계열', keywords:['충동','즉흥','엉뚱','산만','사차원','4차원','제멋대로','변덕','자유분방','괴짜','기이','파괴','정신없','종잡'] },
  { key:'serious', label:'진지한', family:'원칙 · 책임감 · 논리적인 계열', keywords:['진지','원칙','규칙','완고','엄격','고지식','반듯','철저','책임감','논리','성실','올곧'] },
  { key:'gloomy', label:'냉소적인', family:'우울 · 냉소 · 무기력한 계열', keywords:['우울','어둡','무기력','냉소','비관','침울','그늘','자조','염세','시니컬'] },
  { key:'aggressive', label:'거친', family:'다혈질 · 공격적 · 까칠한 계열', keywords:['공격','다혈질','폭력','사나','과격','거칠','호전','불같','성깔','욱하','드센'] },
  { key:'guarded', label:'경계심 있는', family:'방어적 · 츤데레 · 속내를 감추는 계열', keywords:['츤데레','방어적','경계','무장','내숭','새침','벽을','벽이','속마음','비밀'] },
  { key:'calm', label:'차분한', family:'침착 · 담담 · 평온한 계열', keywords:['침착','차분','냉철','담담','평온','태연','의젓','묵직'] },
  { key:'lazy', label:'느긋한', family:'귀찮음 · 태평 · 게으른 계열', keywords:['게으','느긋','태평','귀찮','나태','늘어지','늘어진'] },
] as const;

export type PersonalityTagKey = typeof PERSONALITY_TAG_CATALOG[number]['key'];
export type PersonalityTagDefinition = typeof PERSONALITY_TAG_CATALOG[number];
export const PERSONALITY_TAG_KEYS = PERSONALITY_TAG_CATALOG.map(tag=>tag.key) as PersonalityTagKey[];
export const PERSONALITY_TAG_BY_KEY = Object.fromEntries(PERSONALITY_TAG_CATALOG.map(tag=>[tag.key,tag])) as Record<PersonalityTagKey,PersonalityTagDefinition>;
export const PERSONALITY_TAG_AI_GUIDE = PERSONALITY_TAG_CATALOG.map(tag=>`${tag.key}=${tag.family}`).join(', ');

export function isPersonalityTagKey(value:unknown):value is PersonalityTagKey{
  return typeof value==='string'&&PERSONALITY_TAG_KEYS.includes(value as PersonalityTagKey);
}
export function personalityTagLabel(key:PersonalityTagKey){return PERSONALITY_TAG_BY_KEY[key].label}
export function personalityTagFamily(key:PersonalityTagKey){return PERSONALITY_TAG_BY_KEY[key].family}
export function normalizePersonalityTags(value:unknown,max=PERSONALITY_TAG_MAX_SELECTIONS):PersonalityTagKey[]{
  if(!Array.isArray(value))return[];
  return [...new Set(value.filter(isPersonalityTagKey))].slice(0,max);
}
