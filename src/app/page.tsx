import Link from 'next/link';
import { LookupForm } from '@/components/LookupForm';

export default function Home() {
  return <main>
    <section className="container home-screen">
      <div className="home-intro">
        <h1>캐릭터를<br/>조금 더 깊게<br/>읽어보기.</h1>
        <p className="hero-copy">프로필을 통째로 붙여넣고, 캐릭터에게 맞춰 생성되는 20개의 질문에 답하세요. 분석 결과는 캐릭터 이름과 오너명으로 저장해 나중에 다시 꺼내보거나 이후 궁합·조합 기능에서 그대로 활용할 수 있습니다.</p>
        <div className="actions"><Link className="btn primary" href="/analyze">정밀 분석 시작</Link><a className="btn" href="#lookup">저장한 캐릭터 불러오기</a></div>
      </div>

      <div id="lookup" className="card home-lookup">
        <div><h2>이미 분석한 캐릭터가 있나요?</h2><p className="muted">저장할 때 사용한 캐릭터 이름과 오너명을 입력하면 리포트를 다시 불러올 수 있어요.</p></div>
        <LookupForm />
      </div>
    </section>
  </main>;
}
