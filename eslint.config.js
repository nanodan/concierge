module.exports = [
  {
    files: ['**/*.js'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'semi': ['warn', 'always'],
    },
  },
  {
    ignores: ['node_modules/', 'data/', '.claude/'],
  },
];
