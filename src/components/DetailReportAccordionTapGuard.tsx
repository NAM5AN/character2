'use client';

import { useEffect } from 'react';

export function DetailReportAccordionTapGuard(){
  useEffect(()=>{
    const markUserTouch=(event:PointerEvent)=>{
      const target=event.target instanceof Element?event.target:null;
      const head=target?.closest<HTMLButtonElement>('.report-mag button.section-head');
      if(!head)return;
      head.closest<HTMLElement>('.report-section')?.setAttribute('data-detail-user-touched','1');
    };

    const blockLateProgrammaticToggle=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target:null;
      const head=target?.closest<HTMLButtonElement>('.report-mag button.section-head');
      if(!head||event.isTrusted)return;
      const section=head.closest<HTMLElement>('.report-section');
      if(section?.dataset.detailUserTouched!=='1')return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener('pointerdown',markUserTouch,true);
    document.addEventListener('click',blockLateProgrammaticToggle,true);
    return()=>{
      document.removeEventListener('pointerdown',markUserTouch,true);
      document.removeEventListener('click',blockLateProgrammaticToggle,true);
    };
  },[]);

  return null;
}
