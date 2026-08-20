'use client';

import { useEffect } from 'react';

const MODAL_ID='owner-save-gate-modal';

function setNativeInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  if(setter)setter.call(input,value);
  else input.value=value;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}

function currentOwnerControls(){
  const panel=document.querySelector<HTMLElement>('.save-character-panel');
  const row=panel?.querySelector<HTMLElement>('.save-character-row');
  const input=row?.querySelector<HTMLInputElement>('input.input');
  const saveButton=row?.querySelector<HTMLButtonElement>('.btn.soft');
  return panel&&row&&input&&saveButton?{panel,row,input,saveButton}:null;
}

function ownerAlreadySaved(){
  const controls=currentOwnerControls();
  return !controls||controls.saveButton.textContent?.trim()==='저장 완료';
}

function removeModal(){
  document.getElementById(MODAL_ID)?.remove();
}

function openSaveModal(cta:HTMLButtonElement){
  removeModal();
  const controls=currentOwnerControls();
  if(!controls){
    cta.dataset.ownerSaveBypass='1';
    cta.click();
    queueMicrotask(()=>delete cta.dataset.ownerSaveBypass);
    return;
  }

  const backdrop=document.createElement('div');
  backdrop.id=MODAL_ID;
  backdrop.className='owner-save-gate-backdrop';

  const modal=document.createElement('div');
  modal.className='owner-save-gate-card';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-labelledby','owner-save-gate-title');

  const eyebrow=document.createElement('div');
  eyebrow.className='eyebrow';
  eyebrow.textContent='CHARACTER SAVE';

  const title=document.createElement('h3');
  title.id='owner-save-gate-title';
  title.textContent='상세 리포트 전에 캐릭터를 먼저 저장해주세요.';

  const copy=document.createElement('p');
  copy.textContent='오너명을 저장해두면 새로고침하거나 나중에 다시 접속해도 이 캐릭터의 리포트를 다시 찾을 수 있어요. 저장 후 상세 이용 코드 입력으로 바로 이어집니다.';

  const field=document.createElement('div');
  field.className='field';
  const label=document.createElement('label');
  label.className='label';
  label.textContent='오너명';
  const input=document.createElement('input');
  input.className='input';
  input.maxLength=80;
  input.placeholder='오너명을 입력해주세요.';
  input.value=controls.input.value;
  label.htmlFor='owner-save-gate-input';
  input.id='owner-save-gate-input';
  field.append(label,input);

  const error=document.createElement('div');
  error.className='error owner-save-gate-error';
  error.setAttribute('aria-live','polite');

  const actions=document.createElement('div');
  actions.className='actions';
  const save=document.createElement('button');
  save.type='button';
  save.className='btn primary';
  save.textContent='저장하고 상세 리포트 보기';
  const cancel=document.createElement('button');
  cancel.type='button';
  cancel.className='btn';
  cancel.textContent='취소';
  actions.append(save,cancel);

  modal.append(eyebrow,title,copy,field,error,actions);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  requestAnimationFrame(()=>input.focus());

  let waiting=false;
  const close=()=>{if(!waiting)removeModal()};
  cancel.addEventListener('click',close);
  backdrop.addEventListener('mousedown',event=>{if(event.target===backdrop)close()});

  const submit=async()=>{
    if(waiting)return;
    const owner=input.value.replace(/\s+/g,' ').trim();
    if(!owner){
      error.textContent='오너명을 입력해주세요.';
      input.focus();
      return;
    }

    waiting=true;
    input.disabled=true;
    save.disabled=true;
    cancel.disabled=true;
    save.textContent='저장 중…';
    error.textContent='';

    setNativeInputValue(controls.input,owner);

    // React state must receive the input event before the existing save button can
    // become enabled. Wait briefly, then reuse the existing save handler so there is
    // only one persistence path for owner identity.
    const enabled=await new Promise<boolean>(resolve=>{
      const started=Date.now();
      const tick=()=>{
        if(!controls.saveButton.disabled){resolve(true);return}
        if(Date.now()-started>1600){resolve(false);return}
        window.setTimeout(tick,40);
      };
      tick();
    });

    if(!enabled){
      waiting=false;
      input.disabled=false;
      save.disabled=false;
      cancel.disabled=false;
      save.textContent='저장하고 상세 리포트 보기';
      error.textContent='저장 버튼을 준비하지 못했어요. 잠시 후 다시 시도해주세요.';
      return;
    }

    controls.saveButton.click();

    const saved=await new Promise<boolean>(resolve=>{
      const started=Date.now();
      const tick=()=>{
        if(controls.saveButton.textContent?.trim()==='저장 완료'){resolve(true);return}
        const panelError=controls.panel.querySelector<HTMLElement>('.error')?.textContent?.trim();
        if(panelError){error.textContent=panelError;resolve(false);return}
        if(Date.now()-started>10000){resolve(false);return}
        window.setTimeout(tick,80);
      };
      tick();
    });

    if(!saved){
      waiting=false;
      input.disabled=false;
      save.disabled=false;
      cancel.disabled=false;
      save.textContent='저장하고 상세 리포트 보기';
      if(!error.textContent)error.textContent='캐릭터를 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
      return;
    }

    removeModal();
    cta.dataset.ownerSaveBypass='1';
    cta.click();
    queueMicrotask(()=>delete cta.dataset.ownerSaveBypass);
  };

  save.addEventListener('click',()=>void submit());
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      void submit();
    }
  });
}

export function ReportOwnerSaveGate(){
  useEffect(()=>{
    const onClick=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target.closest<HTMLButtonElement>('.full-preview-cta'):null;
      if(!target||target.dataset.ownerSaveBypass==='1'||target.disabled)return;
      if(ownerAlreadySaved())return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openSaveModal(target);
    };

    document.addEventListener('click',onClick,true);
    return()=>{
      document.removeEventListener('click',onClick,true);
      removeModal();
    };
  },[]);

  return <style>{`
    .owner-save-gate-backdrop {
      position: fixed;
      inset: 0;
      z-index: 115;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgba(17,18,16,.55);
    }
    .owner-save-gate-card {
      width: min(480px,100%);
      padding: 26px;
      border: 1px solid color-mix(in srgb,var(--character-point, var(--accent)) 20%,var(--line));
      border-radius: 22px;
      background: var(--character-surface,var(--paper));
      box-shadow: 0 30px 90px #0004;
    }
    .owner-save-gate-card h3 {
      margin: 8px 0 10px;
      font-size: 24px;
      letter-spacing: -.035em;
    }
    .owner-save-gate-card > p {
      margin: 0 0 18px;
      color: var(--muted);
      line-height: 1.65;
    }
    .owner-save-gate-card .field { margin: 14px 0; }
    .owner-save-gate-error:empty { display: none; }
    .owner-save-gate-card .actions { margin-top: 20px; }
    html[data-character-theme='active'] .owner-save-gate-card .btn:not(.danger) {
      border-color: var(--character-accent);
    }
    html[data-character-theme='active'] .owner-save-gate-card .btn.primary {
      background: var(--character-accent);
      border-color: var(--character-accent);
      color: #fff;
    }
    html[data-character-theme='active'] .owner-save-gate-card .btn:not(.primary):hover {
      background: var(--character-accent-soft);
    }
    html[data-character-theme='active'] .owner-save-gate-card .input {
      background: var(--character-surface);
      border-color: color-mix(in srgb,var(--character-point) 22%,var(--line));
    }
    html[data-character-theme='active'] .owner-save-gate-card .input:focus {
      border-color: var(--character-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb,var(--character-point) 13%,transparent);
    }
  `}</style>;
}
