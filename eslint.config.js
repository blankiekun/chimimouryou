const eslint = require('@eslint/js');
const { fixupPluginRules } = require('@eslint/compat');
const headers = require('eslint-plugin-headers');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const rxjs = require('eslint-plugin-rxjs');
const tseslint = require('typescript-eslint');

let eslintPluginSvelte;

module.exports = (async () => {
  eslintPluginSvelte = await import('eslint-plugin-svelte');

  return tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    {
      ignores: [
        '**/build/*',
        '**/.svelte-kit/*',
        '**/service-worker.ts',
        '**/postcss.config.cjs',
        '**/.prettierrc.cjs',
        '**/material-elevation.cjs',
        '**/vite.config.js',
        '**/vitest.config.js',
        '**/vitest.browser.config.js',
        '**/vitest.bench.config.js',
        '**/eslint.config.js',
        '**/tailwind.config.cjs',
        'apps/web/static/**',
        'apps/desktop/yomitan/**',
        // Yomitan's own code in its own style (README there); kept as close to upstream as possible.
        'apps/web/src/lib/vendor/yomitan/**',
        'apps/desktop/dist/**'
      ]
    },
    {
      languageOptions: {
        parserOptions: {
          parser: '@typescript-eslint/parser',
          ecmaVersion: 2020,
          extraFileExtensions: ['.svelte'],
          project: './tsconfig.eslint.json',
          sourceType: 'module',
          tsconfigRootDir: './apps/web/'
        }
      },
      name: 'root',
      plugins: {
        headers,
        rxjs: fixupPluginRules(rxjs)
      },
      rules: {
        'no-return-assign': ['error', 'except-parens'],
        'no-underscore-dangle': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'prettier/prettier': [
          'error',
          {
            endOfLine: 'auto'
          }
        ]
      }
    },
    {
      files: ['**/!(*.d).ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
        ],
        'headers/header-format': [
          'error',
          {
            content: `@license BSD-3-Clause\nCopyright (c) {year}, ッツ Reader Authors\nAll rights reserved.`,
            source: 'string',
            style: 'jsdoc',
            trailingNewlines: 2,
            preservePragmas: false,
            variables: {
              year: `${new Date().getFullYear()}`
            }
          }
        ]
      }
    },
    {
      ...eslintPluginSvelte.configs['flat/recommended'],
      files: ['*.svelte'],
      languageOptions: {
        parserOptions: { parser: '@typescript-eslint/parser' }
      },
      rules: {
        'except-parens': 'off',
        quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }]
      }
    },
    {
      // The desktop shell: plain Node/Electron modules outside the web app's tsconfig.
      files: ['apps/desktop/**/*.{js,cjs}'],
      languageOptions: {
        parserOptions: { project: null },
        globals: { process: 'readonly', console: 'readonly', URL: 'readonly' }
      }
    },
    {
      // The social hub's Worker: its own package, outside the web app's tsconfig.
      files: ['deploy/social-hub/**/*.ts'],
      languageOptions: { parserOptions: { project: null } }
    },
    {
      files: ['service-worker.ts'],
      rules: {
        'headers/header-format': 'off'
      }
    }
  );
})();
