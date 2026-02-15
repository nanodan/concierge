const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_JS_DIR = path.join(__dirname, '..', 'public', 'js');

/**
 * Extract named imports from a source file
 * Returns array of { names: string[], from: string } objects
 */
function extractImports(source) {
  const imports = [];
  // Match: import { foo, bar } from './module.js'
  // Match: import { foo as bar, baz } from './module.js'
  // Match: import * as foo from './module.js'
  const importRegex = /import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const namedImports = match[1];
    const namespaceImport = match[2];
    const from = match[3];

    if (namespaceImport) {
      // import * as foo - namespace import, all exports are valid
      imports.push({ names: ['*'], from });
    } else if (namedImports) {
      // Parse named imports, handling "foo as bar" syntax
      const names = namedImports
        .split(',')
        .map(s => s.trim())
        .filter(s => s)
        .map(s => {
          // Handle "foo as bar" - extract "foo"
          const asMatch = s.match(/^(\w+)\s+as\s+\w+$/);
          return asMatch ? asMatch[1] : s;
        });
      imports.push({ names, from });
    }
  }
  return imports;
}

/**
 * Extract named exports from a source file
 * Returns Set of export names
 */
function extractExports(source) {
  const exports = new Set();

  // Match: export function foo()
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = funcRegex.exec(source)) !== null) {
    exports.add(match[1]);
  }

  // Match: export const foo = or export let foo =
  const varRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = varRegex.exec(source)) !== null) {
    exports.add(match[1]);
  }

  // Match: export class Foo
  const classRegex = /export\s+class\s+(\w+)/g;
  while ((match = classRegex.exec(source)) !== null) {
    exports.add(match[1]);
  }

  // Match: export { foo, bar }
  const namedExportRegex = /export\s+\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(source)) !== null) {
    const names = match[1].split(',').map(s => {
      // Handle "foo as bar" - export the "bar" name
      const asMatch = s.trim().match(/^\w+\s+as\s+(\w+)$/);
      return asMatch ? asMatch[1] : s.trim();
    }).filter(s => s);
    names.forEach(n => exports.add(n));
  }

  return exports;
}

/**
 * Resolve a relative import path to an absolute file path
 */
function resolveImportPath(importFrom, sourceFile) {
  const sourceDir = path.dirname(sourceFile);
  return path.resolve(sourceDir, importFrom);
}

/**
 * Get all JS files in a directory recursively
 */
function getJsFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('frontend module imports', () => {
  // Build a map of all exports from all frontend modules
  const moduleExports = new Map();
  const jsFiles = getJsFiles(PUBLIC_JS_DIR);

  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const exports = extractExports(source);
    moduleExports.set(file, exports);
  }

  it('should have at least some frontend modules', () => {
    assert.ok(jsFiles.length > 5, `Expected more than 5 JS files, found ${jsFiles.length}`);
  });

  it('all named imports should be exported by their source modules', () => {
    const errors = [];

    for (const file of jsFiles) {
      const source = fs.readFileSync(file, 'utf8');
      const imports = extractImports(source);

      for (const { names, from } of imports) {
        // Skip namespace imports (import * as foo)
        if (names.includes('*')) continue;

        // Resolve the import path
        const targetPath = resolveImportPath(from, file);

        // Skip external modules (not starting with ./ or ../)
        if (!from.startsWith('.')) continue;

        // Check if the target file exists in our module map
        if (!moduleExports.has(targetPath)) {
          errors.push(`${path.relative(PUBLIC_JS_DIR, file)}: Cannot find module '${from}'`);
          continue;
        }

        const targetExports = moduleExports.get(targetPath);

        // Check each imported name
        for (const name of names) {
          if (!targetExports.has(name)) {
            errors.push(
              `${path.relative(PUBLIC_JS_DIR, file)}: '${name}' is not exported from '${from}'`
            );
          }
        }
      }
    }

    if (errors.length > 0) {
      assert.fail(`Import/export mismatches found:\n  ${errors.join('\n  ')}`);
    }
  });

  it('key modules should export expected functions', () => {
    // Verify critical exports exist
    const checks = [
      { file: 'file-utils.js', exports: ['getFileIcon', 'FILE_ICONS', 'IMAGE_EXTS', 'CODE_EXTS', 'DOC_EXTS'] },
      { file: 'utils.js', exports: ['haptic', 'showToast', 'showDialog', 'apiFetch', 'formatFileSize'] },
      { file: 'markdown.js', exports: ['escapeHtml', 'renderMarkdown'] },
      { file: 'state.js', exports: ['getCurrentConversationId', 'setCurrentConversationId'] },
    ];

    for (const check of checks) {
      const filePath = path.join(PUBLIC_JS_DIR, check.file);

      if (!moduleExports.has(filePath)) {
        assert.fail(`Expected module ${check.file} to exist`);
        continue;
      }

      const exports = moduleExports.get(filePath);
      for (const name of check.exports) {
        assert.ok(
          exports.has(name),
          `Expected '${name}' to be exported from ${check.file}`
        );
      }
    }
  });
});
