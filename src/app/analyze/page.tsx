import { AnalyzeFlow } from '@/components/AnalyzeFlow';
export default function AnalyzePage(){ return <main className="container page"><div className="page-head"><div className="eyebrow">Project 01 / Character analyzer</div><h1 style={{fontSize:'clamp(42px,6vw,72px)'}}>자캐 정밀 분석</h1><p>프로필을 읽은 뒤 AI의 첫 해석을 직접 검수하고, 캐릭터마다 달라지는 20개의 질문에 답합니다. 분석이 끝나면 8자리 공유 코드를 발급합니다.</p></div><AnalyzeFlow/></main> }
