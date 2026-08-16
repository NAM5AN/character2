import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'CHARA LAB — 자캐 정밀 분석',
  description: '프로필과 20문항으로 만드는 공유 가능한 Character Passport',
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
  const deploymentTitle = deploymentSha || deploymentId || deploymentUrl || 'local development';

  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="container nav">
            <div className="brand-wrap">
              <Link href="/" className="brand">CHARA LAB</Link>
              <span className="deploy-version" title={deploymentTitle}>배포 {deploymentVersion}</span>
            </div>
            <nav className="nav-links">
              <Link className="nav-link" href="/analyze">자캐 분석</Link>
              <Link className="nav-link optional" href="/#lookup">코드 불러오기</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer"><div className="container">CHARA LAB · Character Passport v1</div></footer>
      </body>
    </html>
  );
}
