import { AnalyzeFlow } from '@/components/AnalyzeFlow';
import { AnalyzeReviewUiPolish } from '@/components/AnalyzeReviewUiPolish';

export default function AnalyzePage(){
  return <main className="container page">
    <style>{`
      .stack > .card:first-child {
        background: transparent;
        border: 0;
        box-shadow: none;
        padding: 0;
        border-radius: 0;
      }
      .stack > .card:first-child h2 {
        font-size: clamp(27px, 3vw, 34px);
        line-height: 1.25;
        margin: 0 0 10px;
      }
      .stack > .card:nth-child(2) > .inference:first-of-type {
        border-top: 0;
        padding-top: 0;
      }
      .inference-top > span.muted {
        display: none !important;
      }
    `}</style>
    <AnalyzeReviewUiPolish/>
    <div className="page-head"><h1 style={{fontSize:'clamp(42px,6vw,72px)'}}>캐릭터 정밀 분석</h1></div>
    <AnalyzeFlow/>
  </main>
}
