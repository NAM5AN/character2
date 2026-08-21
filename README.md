# CHA LAB

캐릭터의 프로필과 오너의 답변을 바탕으로 성격, 관계 방식, 욕구, 두려움과 내적 모순을 단계적으로 해석하는 AI 캐릭터 분석 서비스입니다.

- 서비스: [cha-lab.com](https://cha-lab.com)
- 캐릭터 분석: [cha-lab.com/analyze](https://cha-lab.com/analyze)

> [!IMPORTANT]
> 이 저장소는 서비스 구조를 열람하고 평가할 수 있도록 공개되어 있지만 오픈소스가 아닙니다. 코드의 복제, 수정, 재배포, 호스팅 및 상업적 이용은 허가되지 않습니다. 자세한 내용은 [LICENSE](./LICENSE)를 확인해 주세요.

## 주요 기능

- 캐릭터 프로필 입력 및 구조화
- AI 해석에 대한 오너의 직접 검수
- 캐릭터별 맞춤 인터뷰 질문 생성
- 선택형, 척도형, 순위형, 직접 입력형 등 다양한 답변 방식
- 작성 중인 캐릭터 분석 저장 및 이어하기
- 성격 태그와 답변을 반영한 요약 리포트 생성
- 관계 패턴, 핵심 욕구와 두려움, 내적 모순을 다루는 상세 리포트
- 캐릭터별 테마 컬러가 적용된 공유 페이지
- 공유 코드 기반 리포트 조회 및 링크 공유
- 생성 상태, 실패·재시도 기록과 캐릭터 데이터를 관리하는 관리자 콘솔

## 분석 흐름

1. 캐릭터 이름과 프로필을 입력합니다.
2. AI가 프로필의 사실과 성향을 구조화합니다.
3. 오너가 AI의 추론을 검수하고 성격 태그를 확정합니다.
4. 캐릭터에 맞춰 생성된 인터뷰에 답변합니다.
5. 답변을 바탕으로 요약 리포트를 생성합니다.
6. 필요한 경우 상세 리포트를 생성합니다.
7. 발급된 공유 링크에서 일반 사용자 화면으로 리포트를 확인합니다.

## 기술 구성

| 영역 | 기술 |
| --- | --- |
| 웹 애플리케이션 | Next.js 16, React 19, TypeScript |
| AI 연동 | Vercel AI SDK, Vercel AI Gateway |
| 데이터베이스 | Supabase Postgres, RPC, RLS |
| 검증 | Zod |
| 배포 | Vercel |

## 로컬 실행

### 요구 사항

- Node.js 20 이상
- npm
- Supabase 프로젝트 또는 개발용 연결 정보
- AI 모델을 호출할 수 있는 로컬 또는 배포 환경

### 설치

```bash
git clone https://github.com/NAM5AN/character2.git
cd character2
npm install
```

`.env.example`을 `.env.local`로 복사한 뒤 개발 환경에 맞는 값을 설정합니다.

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 환경변수

| 변수 | 용도 | 공개 가능 여부 |
| --- | --- | --- |
| `OPENAI_MODEL` | 프로필 구조화 등에 사용할 모델 재정의 | 서버 설정 권장 |
| `ANTHROPIC_MODEL` | 리포트 생성 등에 사용할 모델 재정의 | 서버 설정 권장 |
| `SUPABASE_URL` | Supabase 프로젝트 URL | 공개 가능 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase 공개 클라이언트 키 | 공개 가능 |
| `CHARACTER2_TELEMETRY_SECRET` | 서버의 AI 사용 기록 RPC 인증 | 비공개, 서버 전용 |
| `RATE_LIMIT_SALT` | 요청 IP 해시용 추가 salt | 비공개, 서버 전용 |

운영 환경에서는 Vercel AI Gateway OIDC를 사용합니다. 실제 비밀값은 저장소에 커밋하지 말고 Vercel 또는 로컬의 `.env.local`에서 관리해야 합니다.

## 명령어

```bash
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run start    # 프로덕션 서버 실행
npm run lint     # ESLint 검사
npm run test     # Node 테스트 실행
```

## 디렉터리 구조

```text
src/app/          페이지와 API 라우트
src/components/   분석, 질문, 리포트 UI
src/lib/          AI, 데이터, 인증 및 공통 로직
supabase/         데이터베이스 마이그레이션
test/             자동화 테스트
public/           정적 파일
```

## 데이터와 보안

- 서비스 데이터는 `character2_*` 이름 공간으로 분리합니다.
- 브라우저에서 주요 테이블을 직접 조작하지 않고 제한된 RPC와 서버 API를 사용합니다.
- 데이터 접근은 Supabase RLS와 서버 측 검증을 전제로 합니다.
- 관리자 세션, 서버 전용 secret, 이용 코드와 운영 설정을 클라이언트 코드에 노출하지 않습니다.
- 실제 사용자 데이터나 운영용 환경변수를 이 저장소에 커밋하지 않습니다.

## 배포

`main` 브랜치는 Vercel 프로덕션 프로젝트와 연결되어 있습니다. 원격 `main`에 반영된 변경은 프로덕션 빌드를 거쳐 [cha-lab.com](https://cha-lab.com)에 배포됩니다.

## 기여와 문의

이 저장소는 현재 공개 협업형 오픈소스 프로젝트로 운영되지 않습니다. 버그 제보나 개선 제안은 GitHub Issues를 이용해 주세요. Pull Request를 준비하기 전에는 먼저 이슈에서 변경 방향을 논의해 주세요.

## 라이선스

Copyright (c) 2026 NAM5AN / CHA LAB. All rights reserved.

소스 코드는 열람과 평가 목적으로만 공개됩니다. 별도의 서면 허가 없이 복제, 수정, 재배포, 서비스 운영 또는 상업적으로 이용할 수 없습니다. 전체 조건은 [LICENSE](./LICENSE)를 따릅니다.
