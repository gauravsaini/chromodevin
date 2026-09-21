/**
 * Unit tests for Candidate Span Extraction & Spoken Normalizer.
 * Verifies pure functional contracts for text, URL, and candidate number parsing.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  cleanTranscript,
  extractTextCandidates,
  normalizeSpokenUrl,
  extractUrlCandidates,
  toHttpUrl,
  parseCandidatePick
} from '../packages/core/agent/voice-spans.js';

test('cleanTranscript normalizes whitespace and trims', () => {
  assert.strictEqual(cleanTranscript('   search   for   cats  '), 'search for cats');
  assert.strictEqual(cleanTranscript(''), '');
});

test('extractTextCandidates extracts payload text without verbs or destination phrases', () => {
  // 1. Quoted text
  const c1 = extractTextCandidates('type "hello world" into the box');
  assert.ok(c1.includes('hello world'), 'Contains quoted text');

  // 2. Search for verb
  const c2 = extractTextCandidates('search for alan turing');
  assert.ok(c2.includes('alan turing'), 'Contains query after search for');

  // 3. Site search with destination stripped
  const c3 = extractTextCandidates('search wikipedia for lofi beats into the search box');
  assert.ok(c3.some((c) => c.toLowerCase().includes('lofi beats')), 'Contains query with trailing destination stripped');

  // 4. Type verb
  const c4 = extractTextCandidates('type kevin browser into the input field');
  assert.ok(c4.some((c) => c.toLowerCase().includes('kevin browser')), 'Contains typed text');
});

test('normalizeSpokenUrl converts spoken domain phrases to standard URLs', () => {
  assert.strictEqual(normalizeSpokenUrl('example dot com'), 'example.com');
  assert.strictEqual(normalizeSpokenUrl('en dot wikipedia dot org slash wiki'), 'en.wikipedia.org/wiki');
  assert.strictEqual(normalizeSpokenUrl('www dot google dot com'), 'www.google.com');
  assert.strictEqual(normalizeSpokenUrl('h t t p s : / / github dot com'), 'https://github.com');
});

test('extractUrlCandidates extracts valid domain-like spans', () => {
  const urls = extractUrlCandidates('go to wikipedia.org and visit example.com');
  assert.ok(urls.includes('wikipedia.org'));
  assert.ok(urls.includes('example.com'));

  const spoken = extractUrlCandidates('open reddit dot com now');
  assert.ok(spoken.includes('reddit.com'));
});

test('toHttpUrl prepends https:// if protocol is missing', () => {
  assert.strictEqual(toHttpUrl('example.com'), 'https://example.com');
  assert.strictEqual(toHttpUrl('http://insecure.org'), 'http://insecure.org');
  assert.strictEqual(toHttpUrl('https://secure.org'), 'https://secure.org');
});

test('parseCandidatePick extracts candidate number or homophone for zero-model execution', () => {
  assert.strictEqual(parseCandidatePick('two'), 2);
  assert.strictEqual(parseCandidatePick('the second one'), 2);
  assert.strictEqual(parseCandidatePick('number 3'), 3);
  assert.strictEqual(parseCandidatePick('first link'), 1);
  assert.strictEqual(parseCandidatePick('option 4'), 4);
  assert.strictEqual(parseCandidatePick('to'), 2); // Homophone
  assert.strictEqual(parseCandidatePick('too'), 2); // Homophone
  assert.strictEqual(parseCandidatePick('for'), 4); // Homophone
  assert.strictEqual(parseCandidatePick('click the big blue button'), null);
});
