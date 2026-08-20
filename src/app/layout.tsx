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

const siteUrl = 'https://character2-eight.vercel.app';
const metadataTitle = 'CHARA LAB — 캐릭터 정밀 분석';
const metadataDescription = '프로필과 20문항으로 만드는 공유 가능한 Character Passport';
const metadataThumbnail = '/metadata-thumbnail.png';
const faviconPath = '/favicon.png';

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
              <Link href="/" className="brand">CHARA LAB</Link>
            </div>
            <nav className="nav-links">
              <Link className="nav-link" href="/analyze">캐릭터 분석</Link>
              <Link className="nav-link optional" href="/#lookup">저장 캐릭터</Link>
            </nav>
          </div>
        </header>
        <AdminDeploymentVersionPanel/>
        {children}
        <footer className="footer"><div className="container"><span>CHARA LAB · Character Passport v1</span><FeedbackReporter deploymentVersion={deploymentVersion}/></div></footer>
      </body>
    </html>
  );
}
