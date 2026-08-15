import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'CHARA LAB — 자캐 정밀 분석',
  description: '프로필과 20문항으로 만드는 공유 가능한 Character Passport',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="container nav">
            <Link href="/" className="brand">CHARA LAB</Link>
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
