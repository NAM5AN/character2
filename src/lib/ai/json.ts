export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
  throw new Error('AI_JSON_PARSE_FAILED');
}
