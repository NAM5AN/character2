'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AdminFeedbackShortcut(){
  const pathname=usePathname();
  if(pathname!=='/admin/console')return null;
  return <Link className="btn primary admin-feedback-shortcut" href="/admin/feedback">제보함</Link>;
}
