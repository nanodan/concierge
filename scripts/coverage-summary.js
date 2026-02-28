#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const options = {
    lineMin: null,
    branchMin: null,
    funcMin: null,
    top: 12,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--line-min=')) {
      options.lineMin = Number(arg.slice('--line-min='.length));
    } else if (arg.startsWith('--branch-min=')) {
      options.branchMin = Number(arg.slice('--branch-min='.length));
    } else if (arg.startsWith('--func-min=')) {
      options.funcMin = Number(arg.slice('--func-min='.length));
    } else if (arg.startsWith('--top=')) {
      const value = Number(arg.slice('--top='.length));
      if (Number.isFinite(value) && value > 0) {
        options.top = Math.floor(value);
      }
    } else if (arg === '--verbose') {
      options.verbose = true;
    }
  }

  return options;
}

function getTestFiles() {
  const testDir = path.join(process.cwd(), 'test');
  const files = fs.readdirSync(testDir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name));
  return files;
}

function parseCoverageRows(reportText) {
  const rows = [];
  const lines = String(reportText || '').split('\n');
  const rowPattern = /^ℹ\s+(.+?)\s+\|\s+([0-9.]+)\s+\|\s+([0-9.]+)\s+\|\s+([0-9.]+)/;

  for (const raw of lines) {
    const match = raw.match(rowPattern);
    if (!match) continue;
    const name = match[1].trim();
    const linePct = Number(match[2]);
    const branchPct = Number(match[3]);
    const funcPct = Number(match[4]);
    rows.push({ name, linePct, branchPct, funcPct });
  }

  const overall = rows.find((row) => row.name === 'all files') || null;
  const fileRows = rows.filter((row) => row.name.includes('.js'));
  return { overall, fileRows };
}

function formatPct(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(2)}%`;
}

function checkThreshold(label, actual, min) {
  if (!Number.isFinite(min)) return { ok: true };
  if (Number.isFinite(actual) && actual >= min) return { ok: true };
  return {
    ok: false,
    message: `[COVERAGE] ${label} ${formatPct(actual)} is below required ${formatPct(min)}`,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const testFiles = getTestFiles();
  if (testFiles.length === 0) {
    console.error('[COVERAGE] No test files found under test/*.test.js');
    process.exit(1);
  }

  const args = ['--test', '--experimental-test-coverage', ...testFiles];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });

  if (options.verbose || result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }

  const reportText = `${result.stdout || ''}\n${result.stderr || ''}`;
  const { overall, fileRows } = parseCoverageRows(reportText);

  if (!overall) {
    const code = Number.isInteger(result.status) ? result.status : 1;
    process.exit(code);
  }

  const sortedByLine = [...fileRows]
    .sort((a, b) => a.linePct - b.linePct)
    .slice(0, options.top);

  console.log('\n[COVERAGE] Summary');
  console.log(`- Line: ${formatPct(overall.linePct)}`);
  console.log(`- Branch: ${formatPct(overall.branchPct)}`);
  console.log(`- Functions: ${formatPct(overall.funcPct)}`);

  if (sortedByLine.length > 0) {
    console.log(`[COVERAGE] Lowest ${sortedByLine.length} files by line coverage`);
    for (const row of sortedByLine) {
      console.log(`- ${row.name}: ${formatPct(row.linePct)} (branch ${formatPct(row.branchPct)}, funcs ${formatPct(row.funcPct)})`);
    }
  }

  let exitCode = Number.isInteger(result.status) ? result.status : 1;
  if (exitCode === 0) {
    const checks = [
      checkThreshold('line coverage', overall.linePct, options.lineMin),
      checkThreshold('branch coverage', overall.branchPct, options.branchMin),
      checkThreshold('function coverage', overall.funcPct, options.funcMin),
    ];
    const failed = checks.filter((item) => !item.ok);
    if (failed.length > 0) {
      for (const item of failed) {
        console.error(item.message);
      }
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

main();
