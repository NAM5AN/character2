import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**']),
  {
    rules: {
      // 접근성 규칙. 감사에서 실제로 발견된 유형(역할 오용, 라벨 미연결, 키보드로
      // 조작 불가한 클릭 요소)을 기계적으로 잡는다. 사람이 놓치기 쉬운 것들이다.
      // 현재 위반 0건인 규칙만 error 로 둬서, 새로 생기는 순간 빌드가 막힌다.
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either' }],

      // 모달 배경(클릭하면 닫힘)이 걸린다. 키보드에는 Escape 를 제공하므로 기능 손실은
      // 없지만 규칙은 그것까지 보지 못한다. 새 사례를 알아차리도록 경고로만 남긴다.
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',

      // 남아 있는 위반은 대부분 SSR 에서 계산할 수 없는 값(localStorage, URL, 창 크기)을
      // 마운트 후 채우는 정상 패턴이라, 규칙을 지키려면 오히려 코드를 망가뜨려야 한다.
      // 빌드를 막지는 않되 새로 늘어나는지 보이도록 경고로 남긴다.
      'react-hooks/set-state-in-effect': 'warn',

      // 이 저장소는 "의도적으로 안 쓰는 값"을 밑줄 접두어로 표시하고, 속성 하나를 빼는
      // 용도로 구조분해(`const {omitted, ...rest} = x`)를 쓴다. 기본 설정은 그 두 관례를
      // 위반으로 잡아서, 멀쩡한 코드를 고치게 만든다. 관례를 규칙에 알려준다.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
]);
