# CHARA LAB — P1 자캐 정밀 분석기

프로필 → AI 구조화 → 오너 추론 검수 → 캐릭터별 20문항 → Claude 최종 캐해 → Supabase 저장 → 8자리 공유 코드 발급까지 구현한 P1 MVP입니다.

## 핵심 원칙

- 회원가입/로그인 없음
- 캐릭터 데이터는 Supabase 저장
- 8자리 공유 코드는 읽기용
- 수정/삭제용 edit token은 생성 브라우저 localStorage에만 저장
- AI 이용 코드는 포스타입 유료 영역에서 확인, 브라우저 localStorage에 기억
- GPT: 구조화 + 다음 질문
- Claude: 최종 심층 캐해
- AI 키와 Supabase service role 키는 서버 전용

## 1. 설치

```bash
npm install
cp .env.example .env.local
```

## 2. Supabase

Supabase SQL Editor에서 `supabase/migrations/0001_initial.sql`을 실행하세요.

`.env.local`:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

service role 키는 절대 `NEXT_PUBLIC_` 환경변수로 만들지 마세요.

## 3. AI

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-5
```

모델 이름은 계정에서 실제 사용 가능한 모델명으로 바꿀 수 있습니다.

## 4. 포스타입 이용 코드 설정

```env
ADMIN_SECRET=긴-운영자-비밀값
RATE_LIMIT_SALT=긴-랜덤값
```

개발 서버를 연 뒤 `/admin`에서:

- ADMIN_SECRET
- 포스타입 유료글 URL
- 현재 AI 이용 코드

를 저장합니다.

사용자가 AI 기능을 실행할 때 코드가 없으면 포스타입 링크와 코드 입력 모달이 뜹니다. 맞는 코드는 `localStorage.chara_ai_access_code`에 저장되고, 관리자가 코드를 교체하면 다음 AI 요청에서 자동으로 삭제됩니다.

## 5. 실행

```bash
npm run dev
```

## P1 MVP 흐름

1. `/analyze`에서 이름 + 프로필 붙여넣기
2. GPT 프로필 구조화
3. AI 추론 맞음/애매함/아님 검수
4. 캐릭터별 맞춤 질문 20개
5. Claude 최종 캐해
6. Supabase Character Passport 저장
7. 8자리 공유 코드 발급
8. `/character/{CODE}`에서 로그인 없이 재조회

## 현재 의도적으로 제외한 기능

- PDF/이미지 프로필
- 2인 궁합
- 커뮤 그룹
- 관계망
- 회원가입/로그인
- 공개 캐릭터 검색
- 자체 결제/PG

## 배포 메모

- 현재 기본 AI 이용 코드의 평문은 저장소에 커밋하지 않습니다.
- Supabase `app_settings`가 연결되면 관리자 화면에서 설정한 코드가 기본값보다 우선합니다.
- Supabase 미연결 상태에서는 코드 검증만 동작하고, 실제 AI 분석/저장은 API 키와 DB 연결 후 사용할 수 있습니다.
