module.exports = [
  {
    files: ['**/*.js'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'semi': ['warn', 'always'],
    },
  },
  {
    ignores: ['node_modules/', 'data/', '.claude/', 'public/lib/'],
  },
];
