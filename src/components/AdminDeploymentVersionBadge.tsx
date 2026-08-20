'use client';

import { usePathname } from 'next/navigation';

export function AdminDeploymentVersionBadge({ version, title }: { version: string; title: string }) {
  const pathname = usePathname();
  if (!pathname.startsWith('/admin')) return null;
  return <span className="deploy-version" title={title}>배포 {version}</span>;
}
