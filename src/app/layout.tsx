import type { Metadata } from 'next';
import Link from 'next/link';
import { ReportSummaryToggleBridge } from '@/components/ReportSummaryToggleBridge';
import { AdminTelemetryRefreshBridge } from '@/components/AdminTelemetryRefreshBridge';
import { ReplayResultUrlBridge } from '@/components/ReplayResultUrlBridge';
import { FeedbackReporter } from '@/components/FeedbackReporter';
import { AdminFeedbackShortcut } from '@/components/AdminFeedbackShortcut';
import { AdminFailureDeleteBridge } from '@/components/AdminFailureDeleteBridge';
import { AdminCharacterIdentityEditBridge } from '@/components/AdminCharacterIdentityEditBridge';
import { DetailReportAccordionBridge } from '@/components/DetailReportAccordionBridge';
import { StoredReportThemeBridge } from '@/components/StoredReportThemeBridge';
import { ReportOwnerSaveGate } from '@/components/ReportOwnerSaveGate';
import { GlobalScreenMotionBridge } from '@/components/GlobalScreenMotionBridge';
import { AdminDeploymentVersionPanel } from '@/components/AdminDeploymentVersionPanel';
import { AdminConsoleLayoutPolish } from '@/components/AdminConsoleLayoutPolish';
import { AdminConsoleDataEnhancements } from '@/components/AdminConsoleDataEnhancements';
import './globals.css';
import './character-theme.css';
import './analyze-character-theme.css';
import './appearance-image-mobile.css';
import './bipolar-mobile-fix.css';
import './feedback.css';
import './report-pagination.css';
import './report-readability.css';
import './report-magazine.css';
import './report-summary-explorer.css';
import './report-summary-polish.css';
import './report-detail-uniform.css';
import './report-detail-accordion.css';
import './report-detail-chevron-point.css';
import './report-character-theme.css';
import './character-interaction-theme.css';
import './character-theme-final-sweep.css';
import './report-theme-activation-fix.css';
import './global-button-interactions.css';
import './admin-console-polish.css';
import './default-neutral-theme.css';
import './footer-layout.css';
import './touch-hover-fix.css';

const siteUrl = 'https://character2-eight.vercel.app';
const metadataTitle = 'CHA LAB ㅡ 캐릭터 정밀 해석';
const metadataDescription = '나도 몰랐던 내 캐릭터의 심리';
const metadataThumbnail = '/metadata-thumbnail.png';
const faviconPath = '/favicon.png?v=20260821';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: metadataTitle,
  description: metadataDescription,
  icons: {
    icon: faviconPath,
    shortcut: faviconPath,
    apple: faviconPath,
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: '/',
    siteName: 'CHARA LAB',
    title: metadataTitle,
    description: metadataDescription,
    images: [
      {
        url: metadataThumbnail,
        width: 1672,
        height: 941,
        alt: 'CHARA LAB 캐릭터 분석 메타데이터 썸네일',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: metadataTitle,
    description: metadataDescription,
    images: [metadataThumbnail],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '';
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || '';
  const deploymentUrl = process.env.VERCEL_URL || '';
  const deploymentVersion = deploymentSha
    ? deploymentSha.slice(0, 7)
    : deploymentId
      ? deploymentId.replace(/^dpl_/, '').slice(0, 7)
      : deploymentUrl
        ? deploymentUrl.split('-').at(-2)?.slice(0, 7) || 'vercel'
        : 'local';

  return (
    <html lang="ko">
      <body>
        {/* 키보드 사용자가 머리말·내비게이션을 건너뛰고 본문으로 바로 이동한다.
            평소에는 화면 밖에 있고 포커스를 받을 때만 나타난다. */}
        <a className="skip-to-content" href="#content">본문 바로가기</a>
        <ReportSummaryToggleBridge/>
        <AdminTelemetryRefreshBridge/>
        <ReplayResultUrlBridge/>
        <AdminFeedbackShortcut/>
        <AdminFailureDeleteBridge/>
        <AdminCharacterIdentityEditBridge/>
        <DetailReportAccordionBridge/>
        <StoredReportThemeBridge/>
        <ReportOwnerSaveGate/>
        <GlobalScreenMotionBridge/>
        <AdminConsoleLayoutPolish/>
        <AdminConsoleDataEnhancements/>
        <header className="site-header">
          <div className="container nav">
            <div className="brand-wrap">
              <Link href="/" className="brand">CHA-LAB</Link>
            </div>
            <nav className="nav-links">
              <Link className="nav-link" href="/analyze">캐릭터 분석</Link>
              <Link className="nav-link optional" href="/#lookup">저장 캐릭터</Link>
            </nav>
          </div>
        </header>
        <AdminDeploymentVersionPanel/>
        <div id="content" tabIndex={-1}>{children}</div>
        <footer className="footer"><div className="container"><FeedbackReporter deploymentVersion={deploymentVersion}/></div></footer>
      </body>
    </html>
  );
}
