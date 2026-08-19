'use client';

import { useEffect } from 'react';

export function ReportSummaryToggleBridge(){
  useEffect(()=>{
    const cleanup=new Map<HTMLElement,(event:MouseEvent)=>void>();

    const wire=()=>{
      document.querySelectorAll<HTMLElement>('.summary-view-toggle').forEach(toggle=>{
        if(cleanup.has(toggle))return;
        const handler=(event:MouseEvent)=>{
          const buttons=[...toggle.querySelectorAll<HTMLButtonElement>('button')];
          if(buttons.length!==2)return;
          const active=buttons.find(button=>button.classList.contains('is-active'))||buttons[0];
          const target=event.target instanceof Element?event.target:null;
          const clicked=target?.closest('button') as HTMLButtonElement|null;

          // Inactive label keeps its original React onClick.
          // Clicking the active label or any empty part of the segmented control toggles to the opposite side.
          if(clicked&&clicked!==active)return;
          event.preventDefault();
          event.stopPropagation();
          const opposite=buttons.find(button=>button!==active);
          opposite?.click();
        };
        toggle.addEventListener('click',handler,true);
        cleanup.set(toggle,handler);
      });
    };

    wire();
    const observer=new MutationObserver(wire);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{
      observer.disconnect();
      cleanup.forEach((handler,toggle)=>toggle.removeEventListener('click',handler,true));
      cleanup.clear();
    };
  },[]);

  return null;
}
