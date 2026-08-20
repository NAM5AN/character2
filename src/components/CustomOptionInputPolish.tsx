'use client';

import { useEffect } from 'react';

const STYLE_ID = 'custom-option-input-polish-style';
const OPTION_CLASS = 'custom-option-inline-input';

function ensureStyle(){
  if(document.getElementById(STYLE_ID)) return;
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=`
    .${OPTION_CLASS}{
      display:flex !important;
      align-items:center !important;
      min-height:48px;
      padding:15px !important;
      cursor:text !important;
    }
    .${OPTION_CLASS} > strong{
      display:none !important;
    }
    .${OPTION_CLASS} > input.input{
      width:100% !important;
      min-width:0;
      margin:0 !important;
      padding:0 !important;
      border:0 !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
      outline:0 !important;
      color:var(--ink) !important;
      line-height:1.45;
    }
    .${OPTION_CLASS} > input.input::placeholder{
      color:var(--muted) !important;
      opacity:1;
    }
    .${OPTION_CLASS}:focus-within{
      border-color:var(--character-point, var(--ink)) !important;
      box-shadow:0 0 0 2px color-mix(in srgb, var(--character-point, var(--ink)) 12%, transparent) !important;
    }
  `;
  document.head.appendChild(style);
}

function polish(root:ParentNode=document){
  root.querySelectorAll<HTMLElement>('.option').forEach(option=>{
    const strong=[...option.querySelectorAll<HTMLElement>(':scope > strong')].find(node=>node.textContent?.trim()==='직접 입력');
    const input=option.querySelector<HTMLInputElement>(':scope > input.input');
    if(!strong||!input) return;
    option.classList.add(OPTION_CLASS);
    input.placeholder='직접 적어주세요.';
    input.setAttribute('aria-label','직접 적어주세요.');
  });
}

export function CustomOptionInputPolish(){
  useEffect(()=>{
    ensureStyle();
    polish();
    const observer=new MutationObserver(records=>{
      for(const record of records){
        for(const node of record.addedNodes){
          if(node instanceof HTMLElement){
            if(node.matches('.option')) polish(node.parentElement||node);
            else polish(node);
          }
        }
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}
