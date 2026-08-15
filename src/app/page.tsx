import Link from 'next/link';
import { LookupForm } from '@/components/LookupForm';

export default function Home() {
  return <main>
    <section className="container hero">
      <div>
        <div className="eyebrow">Character analysis / After community</div>
        <h1>자캐를<br/>조금 더 깊게<br/>읽어보기.</h1>
        <p className="hero-copy">프로필을 통째로 붙여넣고, 캐릭터에게 맞춰 생성되는 20개의 질문에 답하세요. 분석 결과는 8자리 Character Code로 저장되어 이후 궁합·커뮤 프로젝트에서 그대로 불러올 수 있습니다.</p>
        <div className="actions"><Link className="btn primary" href="/analyze">정밀 분석 시작</Link><a className="btn" href="#lookup">코드로 불러오기</a></div>
      </div>
      <div className="hero-card">
        <span className="eyebrow">Character Passport</span>
        <strong>20</strong>
        <p className="muted">고정 설문이 아니라 프로필과 이전 답변을 바탕으로 매번 달라지는 캐해 인터뷰.</p>
      </div>
    </section>
    <section className="container section">
      <div className="feature-grid">
        <article className="feature"><span className="num">01</span><h3>프로필 구조화</h3><p>원문 설정과 AI 추론을 분리해 Character Passport 초안을 만듭니다.</p></article>
        <article className="feature"><span className="num">02</span><h3>맞춤 20문항</h3><p>이미 적힌 설정은 다시 묻지 않고, 애매한 관계·갈등·내면을 파고듭니다.</p></article>
        <article className="feature"><span className="num">03</span><h3>8자리 공유 코드</h3><p>분석 결과를 Supabase에 저장하고 다른 프로젝트에서 같은 캐릭터를 재사용합니다.</p></article>
      </div>
    </section>
    <section id="lookup" className="container section">
      <div className="card two-col">
        <div><div className="eyebrow">Load character</div><h2 style={{marginTop:10}}>이미 분석한 자캐가 있나요?</h2><p className="muted">8자리 공유 코드만 있으면 로그인 없이 다시 불러올 수 있어요.</p></div>
        <div style={{alignSelf:'center'}}><LookupForm /></div>
      </div>
    </section>
  </main>;
}
