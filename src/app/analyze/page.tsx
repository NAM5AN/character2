import { AnalyzeFlow } from '@/components/AnalyzeFlow';
import { AnalyzeReviewUiPolish } from '@/components/AnalyzeReviewUiPolish';
import { BipolarFiveLevelUi } from '@/components/BipolarFiveLevelUi';
import { PersonalityLoadingBridge } from '@/components/PersonalityLoadingBridge';
import { AnalyzeCharacterThemeBridge } from '@/components/AnalyzeCharacterThemeBridge';
import { CustomOptionInputPolish } from '@/components/CustomOptionInputPolish';

export default function AnalyzePage(){
  return <main className="container page analyze-page">
    <style>{`
      /* 제목만 있던 시절에는 첫 카드를 납작한 헤더처럼 썼다.
         성격 태그 피커가 들어온 review 화면에서는 정상 카드로 복귀시켜
         패딩/높이/테두리가 무너지지 않게 한다. */
      .stack > .card:first-child:not(:has(#personality-tag-picker)) {
        background: transparent;
        border: 0;
        box-shadow: none;
        padding: 0;
        border-radius: 0;
      }
      .stack > .card:first-child:has(#personality-tag-picker) {
        width: 100%;
        min-width: 0;
        height: auto !important;
        min-height: 0 !important;
        padding: 28px !important;
        overflow: visible !important;
        border: 1px solid var(--line) !important;
        border-radius: 24px !important;
        background: var(--character-surface, var(--paper)) !important;
        box-shadow: var(--shadow) !important;
      }
      .stack > .card:first-child h2 {
        font-size: clamp(27px, 3vw, 34px);
        line-height: 1.25;
        margin: 0 0 10px;
      }
      .stack > .card:first-child:has(#personality-tag-picker) #personality-tag-picker {
        width: 100%;
        min-width: 0;
        padding-bottom: 2px;
      }
      .stack > .card:first-child:has(#personality-tag-picker) .personality-chips {
        width: 100%;
        min-width: 0;
      }
      .stack > .card:nth-child(2) > .inference:first-of-type {
        border-top: 0;
        padding-top: 0;
      }
      .inference-top > span.muted {
        display: none !important;
      }
      #personality-tag-picker .personality-chip[data-selected="false"]::before {
        content: '•' !important;
        color: #aaa59b;
        font-size: 10px;
        font-weight: 900;
      }
      .question-card > div:last-child > p.muted {
        display: none !important;
      }
      @media (max-width: 760px) {
        .stack > .card:first-child:has(#personality-tag-picker) {
          padding: 22px 18px !important;
          border-radius: 20px !important;
        }
      }
    `}</style>
    <AnalyzeCharacterThemeBridge/>
    <AnalyzeReviewUiPolish/>
    <PersonalityLoadingBridge/>
    <BipolarFiveLevelUi/>
    <CustomOptionInputPolish/>
    <div className="page-head"><h1 style={{fontSize:'clamp(42px,6vw,72px)'}}>캐릭터 정밀 분석</h1></div>
    <AnalyzeFlow/>
  </main>
}
