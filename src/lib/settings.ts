import { getSupabaseAdmin } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';

const DEFAULT_ACCESS_CODE_HASH = '320b77859300260cb195f00c39de7212a7d859c61eb90cdd627c061f97923a7e';
const DEFAULT_SETTINGS = {
  postype_url: '',
  ai_access_code_hash: DEFAULT_ACCESS_CODE_HASH,
  code_version: 1,
};

export async function getAppSettings() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('app_settings')
      .select('postype_url, ai_access_code_hash, code_version')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    return data ?? DEFAULT_SETTINGS;
  } catch (error) {
    if (error instanceof Error && error.message === 'SUPABASE_NOT_CONFIGURED') {
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

export async function validateAccessCode(code: string | undefined) {
  if (!code) return false;
  const settings = await getAppSettings();
  return sha256(code.trim()) === settings.ai_access_code_hash;
}
