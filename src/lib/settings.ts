import { getSupabaseServer } from '@/lib/supabase/server';

// 이용 코드 해시는 DB(character2_app_settings)에만 존재합니다.
// 과거에는 여기에 기본 해시를 두고 DB 오류 시 그것으로 대조했지만, 저장소가 공개라
// 해시가 그대로 노출됐고 코드를 교체해도 이 값이 계속 통과하는 우회로가 됐습니다.
// 이제는 대조 자체를 DB에서만 하고, 확인할 수 없으면 통과시키지 않습니다(fail closed).
const DEFAULT_SETTINGS = {
  postype_url: 'https://posty.pe/pbacizvc',
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
      postype_url: row.postype_url || DEFAULT_SETTINGS.postype_url,
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
  } catch (error) {
    // 검증할 수 없으면 열어주지 않습니다. 일시적인 DB 장애로 결제 확인이 안 되는 편이
    // 노출된 기본 해시로 아무나 통과하는 것보다 낫습니다.
    console.warn('ACCESS_CODE_VALIDATION_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    return false;
  }
}
