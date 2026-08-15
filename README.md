# CHARA LAB — P1 자캐 정밀 분석기

프로필 → GPT-5.6 Luna 구조화 → 오너 추론 검수 → 캐릭터별 20문항 → Claude Sonnet 5 최종 캐해 → Supabase 저장 → 8자리 공유 코드 발급까지 구현한 P1 MVP입니다.

## 배포

- Production: https://character2-eight.vercel.app
- GitHub: https://github.com/NAM5AN/character2
- Vercel AI Gateway OIDC를 사용하므로 OpenAI/Anthropic provider API 키를 별도로 저장하지 않습니다.
- AI 모델: `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`

## Supabase

기존 `shorts` 프로젝트 안에서 다른 작업물과 이름 공간을 분리했습니다.

- `character2_characters`
- `character2_passports`
- `character2_answers`
- `character2_access`
- `character2_app_settings`
- `character2_rate_limit_events`

기존 `baekji_*`, `ungeol_*`, `character_ai_*` 데이터는 건드리지 않습니다.

브라우저/서버에서 테이블을 직접 읽지 않고 `character2_*` RPC만 호출합니다. 테이블은 RLS 활성화 + anon/authenticated 직접 권한 revoke 상태입니다.

## 이용 코드

기본 AI 이용 코드: `CHARA82`

사용자가 코드를 한 번 입력하면 `localStorage.chara_ai_access_code`에 저장됩니다. 운영자가 코드를 교체하면 다음 AI 요청에서 이전 코드가 거절되고 재입력 창이 뜹니다.

`/admin`에서 관리자 비밀키로 포스타입 URL과 이용 코드를 바꿀 수 있습니다. 관리자 비밀키의 평문은 DB나 저장소에 저장하지 않습니다.

## P1 MVP 흐름

1. `/analyze`에서 이름 + 프로필 붙여넣기
2. GPT-5.6 Luna 프로필 구조화
3. AI 추론 맞음/애매함/아님 검수
4. 캐릭터별 맞춤 질문 20개
5. Claude Sonnet 5 최종 캐해
6. Supabase Character Passport 저장
7. 8자리 공유 코드 발급
8. `/character/{CODE}`에서 로그인 없이 재조회

## 의도적으로 제외

- PDF/이미지 프로필
- 2인 궁합
- 커뮤 그룹
- 관계망
- 회원가입/로그인
- 공개 캐릭터 검색
- 자체 결제/PG
