import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveThemePalette, contrastRatio } from '../src/lib/theme-palette.ts';

function hexToHsl(hex) {
  const value = hex.replace('#', '');
  const n = parseInt(value, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

// 캐릭터 색은 사용자 데이터라 무엇이든 들어온다. 극단값을 고정해 두고,
// 팔레트가 "색조는 그대로, 대비는 보장" 이라는 약속을 계속 지키는지 감시한다.
const CASES = [
  ['형광 하늘', '#1A1A1A', '#5CE1E6'],
  ['밝은 노랑', '#2B2B2B', '#F5D547'],
  ['연분홍', '#3A2E2E', '#FFB6C1'],
  ['흰머리에 회색 눈', '#F2F2F2', '#B0B0B0'],
  ['검은머리에 빨강 눈', '#1B1B1B', '#C0392B'],
  ['연보라', '#2A2A2A', '#C9A7F0'],
  ['민트', '#222222', '#7FFFD4'],
  ['짙은 남색', '#111111', '#1B3A6B'],
  ['순백', '#333333', '#FFFFFF'],
  ['순흑', '#EEEEEE', '#000000'],
  ['형광 연두', '#222222', '#CCFF00'],
  ['파스텔 복숭아', '#EEFFEE', '#FFDAB9'],
];

test('accent 위 글자는 어떤 캐릭터 색에서도 4.5:1 을 넘는다', () => {
  for (const [label, hair, eye] of CASES) {
    const palette = deriveThemePalette(hair, eye, 'text', 80);
    assert.ok(palette, `${label}: 팔레트가 만들어져야 한다`);
    assert.ok(palette.pointInk, `${label}: 전경색이 있어야 한다`);
    const ratio = contrastRatio(hexToHsl(palette.pointInk), hexToHsl(palette.point));
    assert.ok(ratio >= 4.5, `${label}: 글자 대비 ${ratio.toFixed(2)} < 4.5`);
  }
});

test('accent 그래픽은 카드 표면 위에서 3:1 을 넘는다', () => {
  for (const [label, hair, eye] of CASES) {
    const palette = deriveThemePalette(hair, eye, 'text', 80);
    const ratio = contrastRatio(hexToHsl(palette.point), hexToHsl(palette.mainSub));
    assert.ok(ratio >= 3, `${label}: 그래픽 대비 ${ratio.toFixed(2)} < 3`);
  }
});

test('대비를 맞추느라 색조를 바꾸지는 않는다', () => {
  for (const [label, hair, eye] of CASES) {
    const eyeHsl = hexToHsl(eye);
    // 무채색은 색조라는 개념이 없으므로 검사 대상이 아니다.
    if (eyeHsl.s < 8) continue;
    const palette = deriveThemePalette(hair, eye, 'text', 80);
    const drift = hueDistance(eyeHsl.h, hexToHsl(palette.point).h);
    assert.ok(drift <= 2, `${label}: 색조가 ${drift.toFixed(0)}° 틀어졌다`);
  }
});

test('구버전 팔레트에는 전경색이 없어도 된다', () => {
  // pointInk 이전에 저장된 캐릭터가 깨지면 안 된다. CSS 기본값(흰색)으로 넘어간다.
  const palette = deriveThemePalette('#F4F1EB', '#57544C', 'text', 70);
  assert.ok(palette);
  assert.equal(typeof palette.pointInk, 'string');
});
