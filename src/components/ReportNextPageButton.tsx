'use client';

import { useId } from 'react';

const DEFAULT_WAITING_MESSAGE='다음 페이지를 만들고 있어요 잠시만 기다려주세요';

export function ReportNextPageButton({
  disabled,
  busy=false,
  waitingMessage=DEFAULT_WAITING_MESSAGE,
  onClick,
}:{
  disabled:boolean;
  busy?:boolean;
  waitingMessage?:string;
  onClick:()=>void;
}){
  const tooltipId=useId();

  return <span
    className={`report-next-page-wrap${disabled?' is-waiting':''}`}
    tabIndex={disabled?0:undefined}
    role={disabled?'button':undefined}
    aria-label={disabled?'다음 페이지':undefined}
    aria-disabled={disabled||undefined}
    aria-describedby={disabled?tooltipId:undefined}
  >
    <button
      className="btn primary"
      type="button"
      style={{whiteSpace:'nowrap'}}
      disabled={disabled}
      tabIndex={disabled?-1:undefined}
      aria-hidden={disabled||undefined}
      aria-busy={disabled&&busy}
      onClick={onClick}
    >
      다음 페이지 →
    </button>
    {disabled&&<span
      id={tooltipId}
      className="report-next-page-tooltip"
      role="tooltip"
      aria-live="polite"
    >
      {waitingMessage}
    </span>}
  </span>;
}
