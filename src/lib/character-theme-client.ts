import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const THEME_VARIABLES: Record<keyof Pick<CharacterThemePalette,'main'|'mainSub'|'point'|'pointSub'|'alt'|'altSub'>, string> = {
  main: '--character-main',
  mainSub: '--character-main-sub',
  point: '--character-point',
  pointSub: '--character-point-sub',
  // 투톤·오드아이 캐릭터에서만 채워지는 두 번째 포인트색.
  alt: '--character-alt',
  altSub: '--character-alt-sub',
};

export function applyCharacterThemePalette(palette: CharacterThemePalette, root?: HTMLElement) {
  const parsed = themePaletteSchema.safeParse(palette);
  if (!parsed.success) return false;
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return false;

  target.style.setProperty(THEME_VARIABLES.main, parsed.data.main);
  target.style.setProperty(THEME_VARIABLES.mainSub, parsed.data.mainSub);
  target.style.setProperty(THEME_VARIABLES.point, parsed.data.point);
  target.style.setProperty(THEME_VARIABLES.pointSub, parsed.data.pointSub);
  // 두 번째 색은 다색 캐릭터에서만 존재한다. 없으면 이전 캐릭터의 값이 남지 않도록 지운다.
  if (parsed.data.alt && parsed.data.altSub) {
    target.style.setProperty(THEME_VARIABLES.alt, parsed.data.alt);
    target.style.setProperty(THEME_VARIABLES.altSub, parsed.data.altSub);
    target.dataset.characterThemeAlt = 'on';
  } else {
    target.style.removeProperty(THEME_VARIABLES.alt);
    target.style.removeProperty(THEME_VARIABLES.altSub);
    delete target.dataset.characterThemeAlt;
  }
  target.dataset.characterTheme = 'active';
  return true;
}

export function resetCharacterThemePalette(root?: HTMLElement) {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;
  Object.values(THEME_VARIABLES).forEach(variable => target.style.removeProperty(variable));
  delete target.dataset.characterThemeAlt;
  delete target.dataset.characterTheme;
}
