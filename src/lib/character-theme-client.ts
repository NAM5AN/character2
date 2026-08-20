import { themePaletteSchema, type CharacterThemePalette } from '@/lib/theme-palette';

const THEME_VARIABLES: Record<keyof Pick<CharacterThemePalette,'main'|'mainSub'|'point'|'pointSub'>, string> = {
  main: '--character-main',
  mainSub: '--character-main-sub',
  point: '--character-point',
  pointSub: '--character-point-sub',
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
  target.dataset.characterTheme = 'active';
  return true;
}

export function resetCharacterThemePalette(root?: HTMLElement) {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;
  Object.values(THEME_VARIABLES).forEach(variable => target.style.removeProperty(variable));
  delete target.dataset.characterTheme;
}
