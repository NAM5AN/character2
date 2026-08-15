import { getSupabaseServer } from '@/lib/supabase/server';
import { sha256 } from '@/lib/crypto';

const DEFAULT_ACCESS_CODE_HASH = '320b77859300260cb195f00c39de7212a7d859c61eb90cdd627c061f97923a7e';
const DEFAULT_SETTINGS = {
  postype_url: '',
  ai_access_code_hash: DEFAULT_ACCESS_CODE_HASH,
  code_version: 1,
};

export async function getAppSettings() {
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_get_settings');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return DEFAULT_SETTINGS;
    return {
      postype_url: row.postype_url || '',
      ai_access_code_hash: '',
      code_version: row.code_version ?? 1,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function validateAccessCode(code: string | undefined) {
  if (!code) return false;
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc('character2_validate_access_code', { p_code: code.trim() });
    if (error) throw error;
    return data === true;
  } catch {
    return sha256(code.trim()) === DEFAULT_ACCESS_CODE_HASH;
  }
}
