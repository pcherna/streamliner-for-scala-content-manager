'use strict';

// The version is written in three places: the manifest for the extension,
// the @version header for the userscript managers, and VERSION for the
// settings panel. Nothing else keeps them in step.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('manifest.json, @version and VERSION agree', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'streamliner.user.js'), 'utf8');
  const header = /^\/\/ @version\s+(\S+)$/m.exec(source);
  const constant = /^\s*var VERSION = '([^']+)';$/m.exec(source);
  assert.ok(header, '@version header present');
  assert.ok(constant, 'VERSION constant present');
  assert.equal(header[1], manifest.version, '@version matches manifest.json');
  assert.equal(constant[1], manifest.version, 'VERSION matches manifest.json');
});

test('the userscript stays out of frames, like the extension', () => {
  const source = fs.readFileSync(path.join(root, 'streamliner.user.js'), 'utf8');
  assert.match(source, /^\/\/ @noframes$/m);
});

test('the manifest names the Chrome version that introduced MAIN world scripts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.minimum_chrome_version, '111');
});
