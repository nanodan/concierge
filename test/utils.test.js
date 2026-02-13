const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatTime, formatTokens, truncate } = require('./helpers/utils.cjs');

describe('formatTokens', () => {
  it('returns "0" for null', () => {
    assert.equal(formatTokens(null), '0');
  });

  it('returns "0" for undefined', () => {
    assert.equal(formatTokens(undefined), '0');
  });

  it('returns string for small numbers', () => {
    assert.equal(formatTokens(0), '0');
    assert.equal(formatTokens(1), '1');
    assert.equal(formatTokens(999), '999');
  });

  it('formats thousands with k suffix', () => {
    assert.equal(formatTokens(1000), '1.0k');
    assert.equal(formatTokens(1500), '1.5k');
    assert.equal(formatTokens(10000), '10.0k');
    assert.equal(formatTokens(123456), '123.5k');
  });
});

describe('truncate', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(truncate('', 10), '');
    assert.equal(truncate(null, 10), '');
    assert.equal(truncate(undefined, 10), '');
  });

  it('returns original string if shorter than limit', () => {
    assert.equal(truncate('hello', 10), 'hello');
    assert.equal(truncate('hello', 5), 'hello');
  });

  it('truncates and adds ellipsis if longer than limit', () => {
    assert.equal(truncate('hello world', 5), 'hello...');
    assert.equal(truncate('abcdefghij', 3), 'abc...');
  });

  it('handles edge case of length 0', () => {
    assert.equal(truncate('hello', 0), '...');
  });
});

describe('formatTime', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(formatTime(0), '');
    assert.equal(formatTime(null), '');
    assert.equal(formatTime(undefined), '');
  });

  it('formats today timestamps as time only', () => {
    const now = new Date();
    now.setHours(14, 30, 0, 0);
    const result = formatTime(now.getTime());
    // Should contain time format (varies by locale)
    assert.ok(result.length > 0);
    assert.ok(!result.includes('Yesterday'));
  });

  it('formats yesterday as "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const result = formatTime(yesterday.getTime());
    assert.equal(result, 'Yesterday');
  });

  it('formats older dates as month and day', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 7);
    const result = formatTime(oldDate.getTime());
    // Should be something like "Feb 6" - contains month abbreviation
    assert.ok(result.length > 0);
    assert.ok(result !== 'Yesterday');
    // Should not be a time format (no colon for most locales)
    assert.ok(!result.includes(':') || result.includes(' '));
  });
});
