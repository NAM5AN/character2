import Link from 'next/link';
import { LookupForm } from '@/components/LookupForm';

export default function Home() {
  return <main>
    <style>{`
      @media (min-width: 901px) {
        .home-screen {
          height: calc(100svh - 114px);
          min-height: 0;
          padding: 18px 0 20px;
          gap: 42px;
        }
        .home-intro h1 {
          font-size: clamp(50px, 4.8vw, 72px);
          margin-bottom: 18px;
        }
        .home-intro .hero-copy {
          font-size: 16px;
          line-height: 1.6;
        }
        .home-intro .actions { margin-top: 20px; }
        .home-lookup { padding: 26px 28px; }
        .home-lookup h2 {
          font-size: clamp(30px, 2.5vw, 36px);
          margin-bottom: 10px;
        }
        .home-lookup > div > p { margin-bottom: 14px; }
        .home-lookup .field { margin: 10px 0; }
        .home-lookup .input { padding: 12px 14px; }
        body:has(.home-screen) .footer {
          height: 42px;
          padding: 0;
          display: flex;
          align-items: center;
        }
      }
    `}</style>
    <section className="container home-screen">
      <div className="home-intro">
        <h1>캐릭터를<br/>조금 더 깊게<br/>읽어보기.</h1>
        <p className="hero-copy">프로필을 통째로 붙여넣고, 캐릭터에게 맞춰 생성되는 20개의 질문에 답하세요. 분석 결과는 캐릭터 이름과 오너명으로 저장해 나중에 다시 꺼내보거나 이후 궁합·조합 기능에서 그대로 활용할 수 있습니다.</p>
        <div className="actions"><Link className="btn primary" href="/analyze">정밀 분석 시작</Link><a className="btn" href="#lookup">저장한 캐릭터 불러오기</a></div>
      </div>

      <div id="lookup" className="card home-lookup">
        <div><h2>이미 분석한<br/>캐릭터가 있나요?</h2><p className="muted">저장할 때 사용한 캐릭터 이름과 오너명을 입력하면 리포트를 다시 불러올 수 있어요.</p></div>
        <LookupForm />
      </div>
    </section>
  </main>;
}
