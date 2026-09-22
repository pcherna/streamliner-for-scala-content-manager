'use strict';

// Run with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

// Values built inside the script's vm context carry that realm's prototypes,
// which strict deep equality rejects. A JSON round-trip compares the shape.
function same(actual, expected, message) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
}

function withConfig(config, extra) {
  return load(Object.assign({ storage: { streamlinerConfig: JSON.stringify(config) } }, extra || {}));
}

test('loads against the bare window without throwing, and sweeps cleanly', () => {
  const app = load();
  assert.equal(typeof app.streamliner.version, 'string');
  same(app.warnings, []);
});

test('config: a saved value of the wrong type is ignored', () => {
  const app = withConfig({
    speedFactor: '20',        // string where a number belongs
    searchHotkey: 7,          // number where a string belongs
    labelOverrides: 'x',      // string where an object belongs
    darkMode: 1,              // number where a boolean belongs
    listFilterHeight: '300px' // right type, kept
  });
  const c = app.streamliner.config;
  assert.equal(c.speedFactor, 10);
  assert.equal(c.searchHotkey, '/');
  assert.equal(typeof c.labelOverrides, 'object');
  assert.equal(c.darkMode, false);
  assert.equal(c.listFilterHeight, '300px');
});

test('config: an unknown key is ignored', () => {
  const app = withConfig({ noSuchSetting: true });
  assert.equal('noSuchSetting' in app.streamliner.config, false);
});

test('config: sameShape distinguishes objects, arrays, null and NaN', () => {
  const { sameShape } = load().internals;
  assert.equal(sameShape({}, {}), true);
  assert.equal(sameShape([], {}), false);
  assert.equal(sameShape({}, []), false);
  assert.equal(sameShape(null, {}), false);
  assert.equal(sameShape(NaN, 1), false);
  assert.equal(sameShape(2.5, 1), true);
  assert.equal(sameShape('a', 'b'), true);
  assert.equal(sameShape(true, false), true);
  assert.equal(sameShape(1, true), false);
});

test('cssValue: without CSS.supports the value passes through', () => {
  const app = withConfig({ pinnedMenuWidth: '140px' });
  assert.equal(app.internals.cssValue('pinnedMenuWidth', 'min-width'), '140px');
});

test('cssValue: a value CSS.supports rejects falls back to the default', () => {
  const app = withConfig({ pinnedMenuWidth: 'red; } body { display:none' });
  app.window.CSS = { supports: (prop, value) => /^\d+px$/.test(value) };
  assert.equal(app.internals.cssValue('pinnedMenuWidth', 'min-width'), '118px');
  app.streamliner.config.pinnedMenuWidth = '90px';
  assert.equal(app.internals.cssValue('pinnedMenuWidth', 'min-width'), '90px');
});

test('setTimeout patch coerces the delay the way the native call does', () => {
  const app = withConfig({ scaleTimeouts: true });
  const w = app.window;
  assert.equal(w.setTimeout.__cmHelperPatched, true);
  const fn = () => {};
  w.setTimeout(fn, '500');
  assert.equal(app.timers.at(-1).ms, 50, 'a numeric string is a number, then scaled');
  w.setTimeout(fn);
  assert.equal(app.timers.at(-1).ms, 0, 'no delay is 0');
  w.setTimeout(fn, 'soon');
  assert.equal(app.timers.at(-1).ms, 0, 'a non-number is 0');
  w.setTimeout(fn, 5000);
  assert.equal(app.timers.at(-1).ms, 5000, 'above the ceiling is left alone');
  w.setTimeout(fn, 400, 'a', 'b');
  same(app.timers.at(-1).args, ['a', 'b'], 'extra arguments pass through');
});

test('scaleTimeList scales each duration and leaves the rest', () => {
  const { scaleTimeList } = load().internals;
  assert.equal(scaleTimeList('0.2s, 150ms'), '0.02s, 15ms');
  assert.equal(scaleTimeList('0s'), null);
  assert.equal(scaleTimeList('inherit'), null);
  assert.equal(scaleTimeList('1s, inherit'), '0.1s, inherit');
});

test('hotkeys: parse, match and label', () => {
  const app = load();
  const { parseHotkey, matchesHotkey, hotkeyLabel } = app.internals;
  same(parseHotkey('cmd+k'), { ctrl: false, alt: false, shift: false, meta: true, key: 'k' });
  assert.equal(parseHotkey(''), null);
  assert.equal(parseHotkey('ctrl+'), null);

  const slash = parseHotkey('/');
  assert.equal(matchesHotkey({ key: '/' }, slash), true);
  assert.equal(matchesHotkey({ key: '/', metaKey: true }, slash), false, 'an extra modifier is a different key');
  assert.equal(matchesHotkey({ key: '?', shiftKey: true }, slash), false);

  const alt = parseHotkey('alt+s');
  assert.equal(matchesHotkey({ key: 'ß', altKey: true, code: 'KeyS' }, alt), true, 'Mac Option reports the layout character');
  assert.equal(matchesHotkey({ key: 's', altKey: true, code: 'KeyS' }, alt), true);

  assert.equal(hotkeyLabel('cmd+k'), '⌘K');
  assert.equal(load({ platform: 'Win32' }).internals.hotkeyLabel('ctrl+k'), 'Ctrl+K');
});

test('label overrides round-trip through the textarea format', () => {
  const { textToOverrides, overridesToText } = load().internals;
  const src = { 'Maintenance Jobs': 'Maintenance', 'View API Documentation': 'API Docs' };
  same(textToOverrides(overridesToText(src)), src);
  same(textToOverrides('no equals\n = missing key\nkey = \n a = b '), { a: 'b' });
});

test('colours: parse and recolour by role', () => {
  const { parseRgb, hexToRgb, recolour, recolourGradient, colourFromValue } = load().internals;
  same(parseRgb('rgb(255, 0, 0)'), [255, 0, 0, 1]);
  same(parseRgb('rgba(0,0,0,.5)'), [0, 0, 0, 0.5]);
  same(parseRgb('rgb(0 0 0 / 50%)'), [0, 0, 0, 0.5]);
  assert.equal(parseRgb('red'), null);
  same(hexToRgb('#fff'), [255, 255, 255, 1]);
  same(hexToRgb('#00000080'), [0, 0, 0, 128 / 255]);
  assert.equal(hexToRgb('#12345'), null);

  assert.equal(recolour([255, 255, 255, 1], 'surface'), 'rgba(15,15,15,1)', 'white becomes the darkest surface');
  assert.equal(recolour([0, 0, 0, 1], 'surface'), 'rgba(0,0,0,1)', 'a surface never lightens');
  assert.equal(recolour([0, 0, 0, 1], 'text'), 'rgba(245,245,245,1)', 'black text becomes the lightest text');
  assert.equal(recolour([255, 255, 255, 1], 'text'), 'rgba(255,255,255,1)', 'text never darkens');

  assert.equal(colourFromValue('currentcolor'), null);
  assert.equal(colourFromValue('inherit'), null);
  same(colourFromValue('rgb(1, 2, 3)'), [1, 2, 3, 1]);
  same(colourFromValue('var(--x, rgb(1, 2, 3))'), [1, 2, 3, 1]);

  assert.equal(recolourGradient('url(a.png)'), null);
  assert.match(recolourGradient('linear-gradient(rgb(255,255,255) 0%, #f6f6f6 7%)'), /^linear-gradient\(rgba\(15,15,15,1\) 0%, rgba\(\d+,\d+,\d+,1\) 7%\)$/);
});

test('byName sorts without regard to case and with numbers in order', () => {
  const { byName } = load().internals;
  const names = ['Touchless.exe', 'agent10.exe', 'agent9.exe', 'Agent1.exe'].map((name) => ({ name }));
  same(names.sort(byName).map((f) => f.name), ['Agent1.exe', 'agent9.exe', 'agent10.exe', 'Touchless.exe']);
});

test('usage clauses: each non-zero count becomes a linked clause, in kind order', () => {
  const { usageClauses, USAGE_KINDS } = load().internals;
  const playlist = USAGE_KINDS.find((k) => k.name === 'playlist');
  const out = usageClauses(playlist, { channelsCount: 2, asSubPlaylistsCount: 0, messagesCount: 1 }, 42);
  same(out.map((c) => c.text), ['2 Channels', '1 Message']);
  assert.equal(out[0].href, '#channel/?*filters=' + encodeURIComponent('{"playlists":{"values":["42"]}}'));
  assert.equal(usageClauses(playlist, { channelsCount: 0 }, 42), null, 'nothing in use, nothing to say');
  assert.equal(usageClauses({ cats: [{ count: 'n', one: 'X', many: 'Xs' }] }, { n: 3 }, 1), null, 'a category with no link keeps the dialog');
});

test('bypass cache keys carry the list name so ids cannot collide across lists', () => {
  const { bypassKey, USAGE_KINDS } = load().internals;
  const media = USAGE_KINDS.find((k) => k.name === 'media');
  const playlist = USAGE_KINDS.find((k) => k.name === 'playlist');
  assert.notEqual(bypassKey(media, '7'), bypassKey(playlist, '7'));
});

test('routes: which list is showing', () => {
  const at = (hash) => load({ hash }).internals;
  assert.equal(at('#templates').onTemplateList(), true);
  assert.equal(at('#templates/?*filters=x').onTemplateList(), true);
  assert.equal(at('#media').onTemplateList(), false);
  assert.equal(at('#media/?*filters=x').usageKind().name, 'media');
  assert.equal(at('#playlists').usageKind().name, 'playlist');
  assert.equal(at('#channels').usageKind().name, 'channel');
  assert.equal(at('#dashboard').usageKind(), null);
  const off = withConfig({ bypassUsageDialog: false }, { hash: '#media' });
  assert.equal(off.internals.usageKind(), null);
});

test('request paths ask for the smallest page and only the fields needed', () => {
  const { usageCountPath, bypassPath, USAGE_KINDS } = load().internals;
  assert.match(usageCountPath(5), /^media\/search\?offset=0&limit=1&/);
  assert.match(usageCountPath(5), /&fields=id$/);
  const media = USAGE_KINDS.find((k) => k.name === 'media');
  assert.match(bypassPath(media, ['1', '2', '3']), /^media\/search\?offset=0&limit=3&/);
});

test('host in title: prefix, no dangling separator, and removal', () => {
  const app = load();
  const { syncHostTitle } = app.internals;
  assert.equal(app.document.title, 'cm.example', 'an empty title gets the host alone');
  app.document.title = 'Media';
  syncHostTitle();
  assert.equal(app.document.title, 'cm.example · Media');
  syncHostTitle();
  assert.equal(app.document.title, 'cm.example · Media', 'idempotent');
  app.streamliner.config.hostInTitle = false;
  syncHostTitle();
  assert.equal(app.document.title, 'Media');
  app.document.title = 'cm.example';
  syncHostTitle();
  assert.equal(app.document.title, '', 'the bare host goes too');
});

test('dark mode: the base sheet is in place before the first sweep', () => {
  const app = withConfig({ darkMode: true });
  const sheets = app.document.head.children.filter((el) => el.id === 'cm-helper-dark');
  assert.equal(sheets.length, 1);
  assert.match(sheets[0].textContent, /color-scheme: dark/);
  assert.equal(app.streamliner.isDark(), true);
});

test('a feature that throws is isolated, and given up on after three failures', () => {
  const app = load();
  const { runFeature } = app.internals;
  let calls = 0;
  const bad = () => { calls++; throw new Error('boom'); };
  for (let i = 0; i < 5; i++) runFeature('bad', bad);
  assert.equal(calls, 3, 'the cap stops it being called again');
  assert.equal(app.warnings.length, 3);
  assert.match(app.warnings[2][1], /giving up/);

  let good = 0;
  runFeature('good', () => { good++; });
  assert.equal(good, 1, 'other features are unaffected');
});

test('saveConfig writes only what differs from the defaults', () => {
  const app = load();
  app.streamliner.config.darkMode = true;
  app.streamliner.config.speedFactor = 10;
  app.streamliner.save();
  same(JSON.parse(app.store.streamlinerConfig), { darkMode: true });
});
