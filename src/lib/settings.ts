import { getSupabaseAdmin } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';

export async function getAppSettings() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('app_settings')
    .select('postype_url, ai_access_code_hash, code_version')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data ?? { postype_url: '', ai_access_code_hash: '', code_version: 0 };
}

export async function validateAccessCode(code: string | undefined) {
  if (!code) return false;
  const settings = await getAppSettings();
  if (!settings.ai_access_code_hash) return false;
  return sha256(code.trim()) === settings.ai_access_code_hash;
}
