// 이름 끝 받침 여부에 맞춰 조사(이/가·은/는·을/를·과/와)를 골라 {name} 자리표시자를 치환한다.
// 예: applyName('{name}는 이런 캐릭터예요', '김재현') → '김재현은 이런 캐릭터예요'
//     applyName('{name}는 이런 캐릭터예요', '한시아') → '한시아는 이런 캐릭터예요'
// 한글이 아닌 이름은 기본형(가/는/를/와)으로 둔다.
export function applyName(template: string, name: string): string {
  const clean = (name || '').trim();
  const last = clean.length ? clean.charCodeAt(clean.length - 1) : 0;
  const isHangul = last >= 0xAC00 && last <= 0xD7A3;
  const hasBatchim = isHangul && ((last - 0xAC00) % 28 !== 0);
  return template
    .replace(/\{name\}가/g, `${clean}${hasBatchim ? '이' : '가'}`)
    .replace(/\{name\}는/g, `${clean}${hasBatchim ? '은' : '는'}`)
    .replace(/\{name\}을/g, `${clean}${hasBatchim ? '을' : '를'}`)
    .replace(/\{name\}와/g, `${clean}${hasBatchim ? '과' : '와'}`)
    .replace(/\{name\}/g, clean);
}
