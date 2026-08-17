import 'server-only';

export type ProfileLinkKind = 'google_docs' | 'postype' | 'notion';

type ResolvedProfileInput = {
  text: string;
  sourceUrl?: string;
  kind?: ProfileLinkKind;
};

const MAX_PROFILE_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 12_000;

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function kindForUrl(url: URL): ProfileLinkKind | null {
  const host = url.hostname.toLowerCase();
  if (host === 'docs.google.com' && /^\/document\/d\/[a-zA-Z0-9_-]+/u.test(url.pathname)) return 'google_docs';
  if (hostMatches(host, 'postype.com')) return 'postype';
  if (hostMatches(host, 'notion.so') || hostMatches(host, 'notion.site')) return 'notion';
  return null;
}

function redirectAllowed(kind: ProfileLinkKind, url: URL) {
  const host = url.hostname.toLowerCase();
  if (kind === 'google_docs') return host === 'docs.google.com' || hostMatches(host, 'googleusercontent.com');
  if (kind === 'postype') return hostMatches(host, 'postype.com');
  return hostMatches(host, 'notion.so') || hostMatches(host, 'notion.site');
}

function googleDocsExportUrl(url: URL) {
  const match = url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/u);
  if (!match) throw new Error('PROFILE_LINK_UNSUPPORTED: 구글 문서 링크 형식만 사용할 수 있어요.');
  return new URL(`https://docs.google.com/document/d/${match[1]}/export?format=txt`);
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/giu, (_, token: string) => {
    const key = token.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key === 'nbsp') return ' ';
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return _;
  });
}

function preferredHtmlRegion(html: string) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1];
  if (article && article.replace(/<[^>]+>/gu, '').trim().length > 100) return article;
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1];
  if (main && main.replace(/<[^>]+>/gu, '').trim().length > 100) return main;
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1];
  return body || html;
}

function htmlToReadableText(html: string) {
  let source = preferredHtmlRegion(html)
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<(br|hr)\s*\/?\s*>/giu, '\n')
    .replace(/<\/(p|div|section|article|main|aside|header|footer|nav|li|ul|ol|h[1-6]|blockquote|pre|table|tr)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');

  source = decodeHtmlEntities(source).replace(/\r\n?/gu, '\n');
  const lines = source
    .split('\n')
    .map(line => line.replace(/[\t ]+/gu, ' ').trim())
    .filter(Boolean);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped.at(-1) === line) continue;
    deduped.push(line);
  }
  return deduped.join('\n').trim();
}

async function fetchWithTrustedRedirects(initialUrl: URL, kind: ProfileLinkKind) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    if (!redirectAllowed(kind, current)) throw new Error('PROFILE_LINK_UNSUPPORTED: 허용되지 않은 주소로 이동하는 링크예요.');
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; CHARA-LAB/1.0; +https://character2-eight.vercel.app)',
        accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('PROFILE_LINK_UNREADABLE: 링크 이동 주소를 확인하지 못했어요.');
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error('PROFILE_LINK_UNREADABLE: 링크 이동이 너무 많아 문서를 읽지 못했어요.');
}

async function readProfileUrl(url: URL, kind: ProfileLinkKind) {
  const target = kind === 'google_docs' ? googleDocsExportUrl(url) : url;
  const response = await fetchWithTrustedRedirects(target, kind);
  if (!response.ok) {
    throw new Error(`PROFILE_LINK_UNREADABLE: 문서를 읽지 못했어요. 링크가 공개되어 있는지 확인해주세요. (HTTP ${response.status})`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const raw = await response.text();
  let text = contentType.includes('text/html') ? htmlToReadableText(raw) : raw.replace(/\r\n?/gu, '\n').trim();
  text = text.replace(/\u0000/gu, '').trim();

  if (text.length < 20) {
    throw new Error('PROFILE_LINK_UNREADABLE: 문서 내용이 비어 있거나 읽을 수 없어요. 공개 링크인지 확인해주세요.');
  }
  if (text.length > MAX_PROFILE_CHARS) text = text.slice(0, MAX_PROFILE_CHARS).trimEnd();
  return text;
}

function parseUrlOnlyInput(input: string) {
  const trimmed = input.trim();
  if (!/^https?:\/\/\S+$/iu.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    throw new Error('PROFILE_LINK_INVALID: 링크 형식을 확인해주세요.');
  }
}

export async function resolveProfileInput(input: string, required = false): Promise<ResolvedProfileInput> {
  const trimmed = input.trim();
  if (!trimmed) {
    if (required) throw new Error('PROFILE_TEXT_REQUIRED: 공개 프로필 내용을 입력해주세요.');
    return { text: '' };
  }

  const url = parseUrlOnlyInput(trimmed);
  if (!url) {
    if (required && trimmed.length < 20) throw new Error('PROFILE_TEXT_TOO_SHORT: 공개 프로필을 조금 더 입력해주세요.');
    return { text: trimmed.slice(0, MAX_PROFILE_CHARS) };
  }

  const kind = kindForUrl(url);
  if (!kind) throw new Error('PROFILE_LINK_UNSUPPORTED: 링크는 구글 문서, 포스타입, 노션만 사용할 수 있어요.');
  const text = await readProfileUrl(url, kind);
  return { text, sourceUrl: url.toString(), kind };
}
