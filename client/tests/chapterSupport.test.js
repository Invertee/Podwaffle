'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8');
const chapters = fs.readFileSync(path.join(clientRoot, 'js', 'chapterSupport.js'), 'utf8');

test('client loads chapter support before app startup', () => {
  const chapterIndex = index.indexOf('js/chapterSupport.js');
  const appIndex = index.indexOf('js/app.js');
  assert.ok(chapterIndex >= 0);
  assert.ok(appIndex > chapterIndex);
});

test('chapter support provides player navigation and queue tabs', () => {
  assert.match(chapters, /skipToPreviousChapter/);
  assert.match(chapters, /skipToNextChapter/);
  assert.match(chapters, /data-tab="queue"/);
  assert.match(chapters, /data-tab="chapters"/);
  assert.match(chapters, /Chapter \$\{index \+ 1\} of \$\{chapters\.length\}/);
});

test('chapter discovery supports external and inline chapters', () => {
  assert.match(chapters, /chapterSourceFromEntry/);
  assert.match(chapters, /corsproxy\.io/);
  assert.match(chapters, /normalizeChapters\(inline\)/);
});
