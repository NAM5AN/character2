import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**']),
  {
    rules: {
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
