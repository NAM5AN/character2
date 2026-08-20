'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type DeploymentInfo = { version: string; title: string };

export function AdminDeploymentVersionPanel() {
  const pathname = usePathname();
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);

  useEffect(() => {
    if (pathname !== '/admin/console') {
      setDeployment(null);
      return;
    }

    let cancelled = false;
    void fetch('/api/admin/deployment', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return null;
        const body = await response.json().catch(() => null);
        return body?.deployment as DeploymentInfo | null;
      })
      .then(info => {
        if (!cancelled) setDeployment(info?.version ? info : null);
      })
      .catch(() => {
        if (!cancelled) setDeployment(null);
      });

    return () => { cancelled = true; };
  }, [pathname]);

  if (pathname !== '/admin/console' || !deployment) return null;

  return (
    <div className="container" style={{ paddingTop: 18 }}>
      <div
        style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
          fontSize: 12, color: 'var(--muted)',
        }}
      >
        <span>현재 배포 버전</span>
        <code
          title={deployment.title}
          style={{
            padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)',
            background: 'var(--paper)', color: 'var(--fg)', fontWeight: 800,
          }}
        >
          {deployment.version}
        </code>
      </div>
    </div>
  );
}
