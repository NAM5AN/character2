import 'server-only';

export type ProfileLinkKind = 'google_docs' | 'postype' | 'notion';

type ResolvedProfileInput = {
  text: string;
  sourceUrl?: string;
  kind?: ProfileLinkKind;
};

type UnknownRecord = Record<string, unknown>;

const MAX_PROFILE_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 12_000;
const NOTION_API_BASE = 'https://app.notion.com/api/v3';

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

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
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

function notionPageId(input: string) {
  const clean = input.split('?')[0] || input;
  const compact = clean.match(/\b([\da-f]{32})\b/iu)?.[1]?.toLowerCase();
  if (compact) {
    return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  }
  return clean.match(/\b([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\b/iu)?.[1]?.toLowerCase() || null;
}

function normalizedNotionId(value: string) {
  return value.replace(/-/gu, '').toLowerCase();
}

function notionBlockValue(entry: unknown) {
  const record = asRecord(entry);
  const value = asRecord(record.value);
  return Object.keys(value).length ? value : null;
}

function semanticText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  if (typeof value[0] === 'string') return value[0];
  return value.map(semanticText).join('');
}

function notionBlockText(block: UnknownRecord) {
  const properties = asRecord(block.properties);
  const candidates = ['title', 'caption', 'description'] as const;
  const parts = candidates
    .map(key => semanticText(properties[key]).replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

function notionRootKey(blockMap: UnknownRecord, pageId: string) {
  const wanted = normalizedNotionId(pageId);
  return Object.keys(blockMap).find(key => normalizedNotionId(key) === wanted) || null;
}

function referencedContentIds(block: UnknownRecord) {
  const content = Array.isArray(block.content) ? block.content : [];
  return content.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function collectMissingNotionBlockIds(blockMap: UnknownRecord, pageId: string) {
  const root = notionRootKey(blockMap, pageId);
  if (!root) return [];
  const missing = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string) => {
    const normalized = normalizedNotionId(id);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const key = Object.keys(blockMap).find(candidate => normalizedNotionId(candidate) === normalized);
    if (!key) {
      missing.add(id);
      return;
    }
    const block = notionBlockValue(blockMap[key]);
    if (!block) return;
    for (const childId of referencedContentIds(block)) walk(childId);
  };
  walk(root);
  return [...missing].slice(0, 100);
}

function extractNotionReadableText(blockMap: UnknownRecord, pageId: string) {
  const root = notionRootKey(blockMap, pageId);
  if (!root) return '';
  const seen = new Set<string>();
  const lines: string[] = [];

  const push = (value: string) => {
    const cleaned = value.replace(/[\t ]+/gu, ' ').replace(/\r\n?/gu, '\n').trim();
    if (!cleaned) return;
    if (lines.at(-1) === cleaned) return;
    lines.push(cleaned);
  };

  const walk = (id: string, isRoot = false) => {
    const normalized = normalizedNotionId(id);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const key = Object.keys(blockMap).find(candidate => normalizedNotionId(candidate) === normalized);
    if (!key) return;
    const block = notionBlockValue(blockMap[key]);
    if (!block) return;

    const type = typeof block.type === 'string' ? block.type : '';
    const text = notionBlockText(block);
    if (text) {
      if (type === 'bulleted_list') push(`• ${text}`);
      else if (type === 'numbered_list') push(`- ${text}`);
      else if (type === 'quote') push(`> ${text}`);
      else push(text);
    }

    // Child-page links are useful context, but their full contents should not be
    // pulled into the submitted profile automatically. The submitted page itself
    // (including toggles and nested blocks) is traversed completely.
    if (!isRoot && (type === 'page' || type === 'collection_view_page')) return;

    const format = asRecord(block.format);
    const aliasPointer = asRecord(format.alias_pointer);
    const aliasId = typeof aliasPointer.id === 'string' ? aliasPointer.id : '';
    if (aliasId) walk(aliasId);

    for (const childId of referencedContentIds(block)) walk(childId);
  };

  walk(root, true);
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

async function notionApiRequest(endpoint: string, body: UnknownRecord) {
  const response = await fetch(`${NOTION_API_BASE}/${endpoint}`, {
    method: 'POST',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': 'notion-client (+https://github.com/NotionX/react-notion-x)',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`PROFILE_LINK_UNREADABLE: 노션 문서를 읽지 못했어요. 페이지가 웹에 공개되어 있는지 확인해주세요. (Notion HTTP ${response.status})`);
  }
  return asRecord(await response.json());
}

async function readNotionProfileUrl(url: URL) {
  const pageId = notionPageId(url.toString());
  if (!pageId) throw new Error('PROFILE_LINK_INVALID: 노션 페이지 ID를 확인하지 못했어요.');

  const chunk = await notionApiRequest('loadPageChunk', {
    pageId,
    limit: 100,
    chunkNumber: 0,
    cursor: { stack: [] },
    verticalColumns: false,
  });
  const recordMap = asRecord(chunk.recordMap);
  const blockMap = asRecord(recordMap.block);
  if (!Object.keys(blockMap).length || !notionRootKey(blockMap, pageId)) {
    throw new Error('PROFILE_LINK_UNREADABLE: 노션 페이지 내용을 가져오지 못했어요. 페이지가 웹에 공개되어 있는지 확인해주세요.');
  }

  // Long pages and deeply nested toggles can reference blocks that are not in the
  // first chunk. Fetch only those missing blocks, without changing the profile flow.
  for (let round = 0; round < 4; round += 1) {
    const missing = collectMissingNotionBlockIds(blockMap, pageId);
    if (!missing.length) break;
    const synced = await notionApiRequest('syncRecordValuesMain', {
      requests: missing.map(id => ({ table: 'block', id, version: -1 })),
    });
    const syncedBlocks = asRecord(asRecord(synced.recordMap).block);
    if (!Object.keys(syncedBlocks).length) break;
    Object.assign(blockMap, syncedBlocks);
  }

  let text = extractNotionReadableText(blockMap, pageId).replace(/\u0000/gu, '').trim();
  if (text.length < 20) {
    throw new Error('PROFILE_LINK_UNREADABLE: 노션 페이지에서 읽을 수 있는 프로필 텍스트를 찾지 못했어요. 페이지가 웹에 공개되어 있는지 확인해주세요.');
  }
  if (text.length > MAX_PROFILE_CHARS) text = text.slice(0, MAX_PROFILE_CHARS).trimEnd();
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
