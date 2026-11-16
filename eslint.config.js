import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // The client bundles these files: classic zod would ship whole, zod/mini tree-shakes (D24).
    files: ['client/**/*.{ts,vue}', 'shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'zod', message: "Use 'zod/mini' in code the browser bundles (D24)." }] },
      ],
    },
  },
  prettier,
)
