import 'server-only';

import { NotionAPI } from 'notion-client';
import { getBlockValue, getPageContentBlockIds, getTextContent, parsePageId } from 'notion-utils';

export type ProfileLinkKind = 'google_docs' | 'postype' | 'notion';

type ResolvedProfileInput = {
  text: string;
  sourceUrl?: string;
  kind?: ProfileLinkKind;
};

// 붙여넣은 텍스트와 링크로 읽어온 본문에 같은 상한을 적용합니다. 한쪽만 막으면
// 링크로 우회할 수 있어 의미가 없습니다. 실제 프로필은 최대 6,616자였으므로
// 2만 자는 그 3배로, 정상 사용자는 닿지 않습니다.
const MAX_PROFILE_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 12_000;
// 본문을 통째로 메모리에 받기 전에 끊는 다운로드 상한. 남이 만든 문서를 우리가 받아오는
// 구조라 문서 크기를 우리가 통제할 수 없습니다. HTML 마크업 오버헤드를 감안해 넉넉히 잡되,
// 수백 MB짜리를 그대로 받아 함수가 죽는 일은 없게 합니다.
const MAX_FETCH_BYTES = 3 * 1024 * 1024;

function tooLongError(chars: number) {
  return new Error(`PROFILE_TEXT_TOO_LONG: 프로필이 너무 길어요(${chars.toLocaleString('ko-KR')}자). ${MAX_PROFILE_CHARS.toLocaleString('ko-KR')}자 이내로 줄여주세요.`);
}

// 응답 본문을 스트리밍으로 읽되 상한을 넘으면 즉시 중단합니다. response.text() 는
// 전체를 받아버리므로 상한이 있어도 다운로드 자체를 막지 못합니다.
async function readBodyCapped(response: Response, maxBytes = MAX_FETCH_BYTES) {
  const body = response.body;
  if (!body) return await response.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('PROFILE_LINK_TOO_LARGE: 문서가 너무 커서 읽지 못했어요. 분량을 줄이거나 본문을 직접 붙여넣어 주세요.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isNotionHost(hostname: string) {
  const host = hostname.toLowerCase();
  return hostMatches(host, 'notion.so') || hostMatches(host, 'notion.site') || host === 'app.notion.com';
}

function kindForUrl(url: URL): ProfileLinkKind | null {
  const host = url.hostname.toLowerCase();
  if (host === 'docs.google.com' && /^\/document\/d\/[a-zA-Z0-9_-]+/u.test(url.pathname)) return 'google_docs';
  if (hostMatches(host, 'postype.com')) return 'postype';
  if (isNotionHost(host)) return 'notion';
  return null;
}

function redirectAllowed(kind: ProfileLinkKind, url: URL) {
  const host = url.hostname.toLowerCase();
  if (kind === 'google_docs') return host === 'docs.google.com' || hostMatches(host, 'googleusercontent.com');
  if (kind === 'postype') return hostMatches(host, 'postype.com');
  return isNotionHost(host);
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

// notion-client 의 블록은 스키마가 느슨하다. any 대신 실제로 읽는 부분만 좁혀서 받는다.
type NotionTextProps = Record<string, Parameters<typeof getTextContent>[0]>;
function notionBlockText(block: { properties?: unknown } | null | undefined) {
  const properties = (block?.properties || {}) as NotionTextProps;
  const texts = [
    getTextContent(properties.title),
    getTextContent(properties.caption),
    getTextContent(properties.description),
  ]
    .map(value => String(value || '').replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  return [...new Set(texts)].join(' · ');
}

async function readNotionProfileUrl(url: URL) {
  const pageId = parsePageId(url.toString());
  if (!pageId) throw new Error('PROFILE_LINK_INVALID: 노션 페이지 ID를 확인하지 못했어요.');

  const notion = new NotionAPI({
    userTimeZone: 'Asia/Seoul',
    ofetchOptions: {
      timeout: FETCH_TIMEOUT_MS,
      retry: 1,
    },
  });

  let recordMap;
  try {
    recordMap = await notion.getPage(pageId, {
      concurrency: 2,
      fetchMissingBlocks: true,
      fetchCollections: false,
      fetchCustomEmojis: false,
      signFileUrls: false,
      fetchRelationPages: false,
      ofetchOptions: {
        timeout: FETCH_TIMEOUT_MS,
        retry: 1,
      },
    });
  } catch (error) {
    console.error('NOTION_PROFILE_FETCH_FAILED', {
      pageId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error('PROFILE_LINK_UNREADABLE: 노션 문서를 읽지 못했어요. 웹에 공개된 페이지인지 확인해주세요.');
  }

  const blockIds = getPageContentBlockIds(recordMap, pageId);
  const lines: string[] = [];

  for (const blockId of blockIds) {
    const block = getBlockValue(recordMap.block[blockId]);
    if (!block) continue;

    const text = notionBlockText(block);
    if (!text) continue;

    const type = typeof block.type === 'string' ? block.type : '';
    let line = text;
    if (type === 'bulleted_list') line = `• ${text}`;
    else if (type === 'numbered_list') line = `- ${text}`;
    else if (type === 'quote') line = `> ${text}`;

    if (lines.at(-1) !== line) lines.push(line);
    // 거대한 페이지를 끝까지 순회하지 않고 상한에서 바로 끊는다.
    if (lines.reduce((n, l) => n + l.length + 1, 0) > MAX_PROFILE_CHARS) break;
  }

  const text = lines.join('\n').replace(/\n{3,}/gu, '\n\n').replace(/\u0000/gu, '').trim();

  console.info('NOTION_PROFILE_READ', {
    pageId,
    blocks: blockIds.length,
    textLength: text.length,
  });

  if (text.length < 20) {
    throw new Error('PROFILE_LINK_UNREADABLE: 이 노션 링크에서는 공개된 프로필 본문을 읽지 못했어요. 노션에서 웹 공개된 페이지 링크를 사용해주세요.');
  }

  if (text.length > MAX_PROFILE_CHARS) throw tooLongError(text.length);
  return text;
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
  if (kind === 'notion') return readNotionProfileUrl(url);

  const target = kind === 'google_docs' ? googleDocsExportUrl(url) : url;
  const response = await fetchWithTrustedRedirects(target, kind);
  if (!response.ok) {
    throw new Error(`PROFILE_LINK_UNREADABLE: 문서를 읽지 못했어요. 링크가 공개되어 있는지 확인해주세요. (HTTP ${response.status})`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const raw = await readBodyCapped(response);
  let text = contentType.includes('text/html') ? htmlToReadableText(raw) : raw.replace(/\r\n?/gu, '\n').trim();
  text = text.replace(/\u0000/gu, '').trim();

  if (text.length < 20) {
    throw new Error('PROFILE_LINK_UNREADABLE: 문서 내용이 비어 있거나 읽을 수 없어요. 공개 링크인지 확인해주세요.');
  }
  if (text.length > MAX_PROFILE_CHARS) throw tooLongError(text.length);
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
    if (trimmed.length > MAX_PROFILE_CHARS) throw tooLongError(trimmed.length);
    return { text: trimmed };
  }

  const kind = kindForUrl(url);
  if (!kind) throw new Error('PROFILE_LINK_UNSUPPORTED: 링크는 구글 문서, 포스타입, 노션만 사용할 수 있어요.');
  const text = await readProfileUrl(url, kind);
  return { text, sourceUrl: url.toString(), kind };
}
