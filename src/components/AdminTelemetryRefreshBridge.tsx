'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// AI usage telemetry is intentionally written after generation responses. The admin
// console already reloads character cards on window focus, so while that page is open
// we periodically emit the same signal and pick up late cost rows (including report
// regeneration attempts) without requiring a manual refresh.
export function AdminTelemetryRefreshBridge(){
  const pathname=usePathname();

  useEffect(()=>{
    if(pathname!=='/admin/console')return;
    const refresh=()=>{
      if(document.visibilityState!=='visible')return;
      window.dispatchEvent(new Event('focus'));
    };
    const first=window.setTimeout(refresh,3000);
    const interval=window.setInterval(refresh,8000);
    return()=>{
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  },[pathname]);

  return null;
}
