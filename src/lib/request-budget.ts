// 개별 필드 상한과 별개로, 요청 본문 전체 크기에 예산을 둡니다.
//
// 이유: draft 는 클라이언트가 통째로 보내고 그대로 프롬프트가 됩니다. 필드마다 상한을
// 걸어도, 필드가 새로 늘거나 상한이 느슨한 조합을 겹쳐 쌓으면 다시 커질 수 있습니다.
// 전체 크기를 한 번 재서 막으면 그런 조합까지 한 번에 걸러지고, 앞으로 추가되는
// 필드도 자동으로 예산 안에 들어옵니다.
//
// 기준: 운영 데이터에서 draft 에 해당하는 저장 데이터가 최대 약 17KB 였습니다.
// 300KB 는 그보다 열 배 이상 넉넉해 정상 사용자는 절대 걸리지 않으면서,
// Vercel 본문 한도(약 4.5MB)까지 열려 있던 최악의 경우는 15배 이상 줄입니다.
const DEFAULT_MAX_BYTES = 300 * 1024;

export class RequestTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number) {
    super(`REQUEST_TOO_LARGE: 요청이 너무 큽니다(${Math.round(sizeBytes / 1024)}KB / 최대 ${Math.round(maxBytes / 1024)}KB).`);
    this.name = 'RequestTooLargeError';
  }
}

// 이미 파싱된 JSON 본문의 직렬화 크기를 재서 예산을 넘으면 던집니다.
// 스키마 검증보다 먼저 호출해, 큰 본문이 검증 비용조차 치르지 않게 합니다.
export function assertRequestBudget(body: unknown, maxBytes = DEFAULT_MAX_BYTES) {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8');
  } catch {
    // 순환 참조 등으로 직렬화가 안 되는 본문은 정상 요청이 아닙니다.
    throw new RequestTooLargeError(maxBytes + 1, maxBytes);
  }
  if (size > maxBytes) throw new RequestTooLargeError(size, maxBytes);
}

// JSON 본문을 읽고 예산 검사까지 한 번에 합니다.
export async function readJsonWithinBudget(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<unknown> {
  const raw = await request.text();
  const size = Buffer.byteLength(raw, 'utf8');
  if (size > maxBytes) throw new RequestTooLargeError(size, maxBytes);
  return JSON.parse(raw);
}
