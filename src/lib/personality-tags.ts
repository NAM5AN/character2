export const PERSONALITY_TAG_MAX_SELECTIONS = 5;

export const PERSONALITY_TAG_CATALOG = [
  { key:'shy', label:'수줍은', family:'소심 · 수줍 · 내성적인 계열', tooltip:'소심 · 수줍 · 내성적', keywords:['소심','수줍','낯가림','낯을','내성적','부끄','숫기','조용','움츠','쭈뼛'] },
  { key:'proud', label:'당당한', family:'도도 · 자신감 · 자존심이 강한 계열', tooltip:'도도 · 자신감 · 자존심 강함', keywords:['도도','거만','오만','자신감','당당','자부심','콧대','우월','자존심','프라이드','고고'] },
  { key:'cold', label:'무심한', family:'차갑 · 시크 · 무뚝뚝한 계열', tooltip:'차갑 · 시크 · 무뚝뚝', keywords:['차가','시크','무뚝뚝','냉정','무심','쌀쌀','건조','무표정','까칠'] },
  { key:'warm', label:'다정한', family:'다정 · 따뜻 · 배려하는 계열', tooltip:'다정 · 따뜻 · 배려', keywords:['다정','따뜻','상냥','배려','친절','포근','자상','챙기','살가'] },
  { key:'playful', label:'장난스러운', family:'장난 · 능글 · 짓궂은 계열', tooltip:'장난 · 능글 · 짓궂음', keywords:['장난','짓궂','까불','능글','유쾌','익살','너스레','농담'] },
  { key:'cheerful', label:'활발한', family:'밝음 · 명랑 · 활동적인 계열', tooltip:'밝음 · 명랑 · 활동적', keywords:['활발','명랑','쾌활','발랄','에너지','텐션','싹싹','밝은','밝고','밝다'] },
  { key:'anxious', label:'예민한', family:'불안 · 눈치 · 걱정이 많은 계열', tooltip:'불안 · 눈치 · 걱정 많음', keywords:['예민','불안','걱정','눈치','긴장','초조','신경질','노심','조마'] },
  { key:'chaotic', label:'엉뚱한', family:'충동 · 즉흥 · 산만 · 4차원 계열', tooltip:'충동 · 즉흥 · 산만 · 4차원', keywords:['충동','즉흥','엉뚱','산만','사차원','4차원','제멋대로','변덕','자유분방','괴짜','기이','파괴','정신없','종잡'] },
  { key:'serious', label:'진지한', family:'원칙 · 책임감 · 논리적인 계열', tooltip:'원칙 · 책임감 · 논리적', keywords:['진지','원칙','규칙','완고','엄격','고지식','반듯','철저','책임감','논리','성실','올곧'] },
  { key:'gloomy', label:'냉소적인', family:'우울 · 냉소 · 무기력한 계열', tooltip:'우울 · 냉소 · 무기력', keywords:['우울','어둡','무기력','냉소','비관','침울','그늘','자조','염세','시니컬'] },
  { key:'aggressive', label:'거친', family:'다혈질 · 공격적 · 까칠한 계열', tooltip:'다혈질 · 공격적 · 까칠함', keywords:['공격','다혈질','폭력','사나','과격','거칠','호전','불같','성깔','욱하','드센'] },
  { key:'guarded', label:'경계심 있는', family:'방어적 · 츤데레 · 속내를 감추는 계열', tooltip:'방어적 · 츤데레 · 속내 감춤', keywords:['츤데레','방어적','경계','무장','내숭','새침','벽을','벽이','속마음','비밀'] },
  { key:'calm', label:'차분한', family:'침착 · 담담 · 평온한 계열', tooltip:'침착 · 담담 · 평온', keywords:['침착','차분','냉철','담담','평온','태연','의젓','묵직'] },
  { key:'lazy', label:'느긋한', family:'귀찮음 · 태평 · 게으른 계열', tooltip:'귀찮음 · 태평 · 게으름', keywords:['게으','느긋','태평','귀찮','나태','늘어지','늘어진'] },
  { key:'perfectionist', label:'완벽주의적인', family:'완벽주의 · 높은 기준 · 통제하는 계열', tooltip:'꼼꼼 · 철저 · 높은 기준', keywords:['완벽주의','완벽을','완벽하게','꼼꼼','세밀','정교','오차','실수 용납','기준이 높','완성도','흠잡'] },
  { key:'calculating', label:'계산적인', family:'전략 · 실리 · 이해득실을 따지는 계열', tooltip:'전략 · 실리 · 이해득실', keywords:['계산적','전략적','손익','실리','이해득실','득실','효율을 따','이득','손해를 따','가성비','현실적 판단'] },
  { key:'possessive', label:'집착하는', family:'집착 · 소유욕 · 강한 애착 계열', tooltip:'집착 · 소유욕 · 강한 애착', keywords:['집착','소유욕','독점욕','질투','놓지 못','붙잡','매달','내 사람','독점','빼앗길'] },
  { key:'dependent', label:'의존적인', family:'의존 · 확인 욕구 · 안정 추구 계열', tooltip:'의존 · 확인 욕구 · 안정 추구', keywords:['의존','의지하','기대다','기댄','확인받','허락받','결정 맡','혼자 결정 못','누군가에게 맡','안심시켜'] },
  { key:'naive', label:'순진한', family:'순진 · 선의 기대 · 낮은 경계심 계열', tooltip:'순진 · 잘 믿음 · 낮은 경계심', keywords:['순진','순수','잘 믿','곧이곧대로','의심하지','의심이 없','세상물정','악의가 없','사람을 믿','선의를 믿'] },
  { key:'dominant', label:'주도적인', family:'주도 · 결정 · 리더십 계열', tooltip:'주도 · 결정 · 리더십', keywords:['주도적','주도권','리더','이끌','지휘','통솔','앞장','결정권','명령','주도하'] },
  { key:'stubborn', label:'고집 센', family:'고집 · 확신 · 낮은 타협성 계열', tooltip:'고집 · 확신 · 낮은 타협성', keywords:['고집','완고','뚝심','양보 안','뜻을 굽히지','고집불통','타협하지','자기 뜻대로','입장을 바꾸지','꺾이지'] },
  { key:'competitive', label:'경쟁적인', family:'승부욕 · 비교 · 성취 계열', tooltip:'승부욕 · 비교 · 성취', keywords:['경쟁심','승부욕','지기 싫','이기고 싶','이겨야','1등','순위','라이벌','경쟁 상대','비교당'] },
  { key:'curious', label:'호기심 많은', family:'탐구 · 질문 · 새로운 자극 계열', tooltip:'탐구 · 호기심 · 새로운 자극', keywords:['호기심','궁금해','궁금하','탐구','캐묻','알아내','파고들','새로운 것','왜 그런지','호기심을'] },
  { key:'self_sacrificing', label:'자기희생적인', family:'희생 · 헌신 · 자기 후순위 계열', tooltip:'희생 · 헌신 · 자기 후순위', keywords:['자기희생','희생하','헌신','대신 감당','대신하다','자기보다 남','자신을 희생','손해를 감수','내 몫을 포기','자기 몫을 포기'] },
  { key:'theatrical', label:'극적인', family:'과시 · 주목 욕구 · 극적인 계열', tooltip:'과시 · 주목 욕구 · 극적', keywords:['관종','주목받','관심받고','오버','극적','드라마틱','무대','스포트라이트','튀고 싶','시선을 끌','화려하게','호들갑'] },
  { key:'rebellious', label:'반항적인', family:'반항 · 권위 거부 · 삐딱한 계열', tooltip:'반항 · 권위 거부 · 삐딱', keywords:['반항','삐딱','반골','권위','규칙을 거부','규칙을 어기','반발','대들','저항','청개구리','하지 말라면','틀에 갇히'] },
  { key:'dreamy', label:'몽상적인', family:'몽상 · 낭만 · 이상주의 계열', tooltip:'몽상 · 낭만 · 이상주의', keywords:['몽상','몽환','낭만','이상주의','공상','상상 속','꿈꾸','환상','붕 떠','이상을 좇','현실감이 없','뜬구름'] },
  { key:'oblivious', label:'둔감한', family:'둔감 · 눈치 없음 · 무신경한 계열', tooltip:'둔감 · 눈치 없음 · 무신경', keywords:['둔감','눈치가 없','눈치 없','무신경','무던','둔한','분위기 파악을 못','알아채지 못','개의치 않','신경 쓰지 않','대수롭지 않','무덤덤'] },
  { key:'sentimental', label:'감성적인', family:'감수성 · 눈물 많음 · 풍부한 감정 계열', tooltip:'감수성 · 눈물 많음 · 풍부한 감정', keywords:['감성적','감수성','눈물이 많','눈물 많','잘 울','감정이 풍부','감동','울컥','여리','센치','뭉클','그렁그렁'] },
  { key:'boastful', label:'허세 있는', family:'허세 · 과장 · 허풍 계열', tooltip:'허세 · 과장 · 허풍', keywords:['허세','허풍','뻥','자랑','부풀리','으스대','뽐내','큰소리','센 척','있는 척','잘난 척','과시하'] },
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
