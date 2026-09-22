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

// A CSSStyleDeclaration as far as darkDeclarations reads one.
function fakeStyle(decls) {
  return {
    getPropertyValue(p) { return decls[p] ? decls[p][0] : ''; },
    getPropertyPriority(p) { return decls[p] ? decls[p][1] || '' : ''; }
  };
}

test('dark mode: url() values are made absolute against their sheet', () => {
  const { absoluteUrls } = load().internals;
  const base = 'https://cm.example/ContentManager/css/scala.css';
  assert.equal(absoluteUrls('url("../images/a.png")', base), 'url("https://cm.example/ContentManager/images/a.png")');
  assert.equal(absoluteUrls("url('b.png') no-repeat", base), 'url("https://cm.example/ContentManager/css/b.png") no-repeat');
  assert.equal(absoluteUrls('url(c.png), linear-gradient(red, blue)', base),
    'url("https://cm.example/ContentManager/css/c.png"), linear-gradient(red, blue)');
  assert.equal(absoluteUrls('url("data:image/png;base64,AAA")', base), 'url("data:image/png;base64,AAA")');
  assert.equal(absoluteUrls('url(#clip)', base), 'url(#clip)');
  assert.equal(absoluteUrls('url("https://x.example/d.png")', base), 'url("https://x.example/d.png")');
  assert.equal(absoluteUrls('none', base), 'none');
});

test('dark mode: every handled property is copied, colours forced and images at their own priority', () => {
  const { darkDeclarations } = load().internals;
  const base = 'https://cm.example/ContentManager/css/scala.css';

  // The user-menu icon: an image the walk used to leave out. An image copy
  // keeps its priority, so an inline image still beats it.
  same(darkDeclarations(fakeStyle({ 'background-image': ['url("../images/userSettings.png")'] }), base), {
    normal: ['background-image:url("https://cm.example/ContentManager/images/userSettings.png")'],
    important: []
  });

  // 13.50 hides the text field ripple with transparent !important.
  same(darkDeclarations(fakeStyle({ 'background-color': ['transparent', 'important'] }), base), {
    normal: [],
    important: ['background-color:transparent !important']
  });

  const mixed = darkDeclarations(fakeStyle({
    'color': ['rgb(0, 0, 0)'],
    'border-top-color': ['currentcolor'],
    'box-shadow': ['none', 'important']
  }), base);
  same(mixed.normal, ['border-top-color:currentcolor !important', 'color:rgba(245,245,245,1) !important'], 'colours always reach inline styles');
  same(mixed.important, ['box-shadow:none !important']);

  // A tiled texture is still dropped.
  same(darkDeclarations(fakeStyle({
    'background-image': ['url("../images/bg.png")'],
    'background-repeat': ['repeat']
  }), base).normal, ['background-image:none']);

  same(darkDeclarations(fakeStyle({}), base), { normal: [], important: [] });
});

test('dark mode: copies skip the sign-in panels the app already draws dark', () => {
  const { outsideNativeDark } = load().internals;
  const W = ':where(:not(.loginRow>.cell~.cell *))';
  assert.equal(outsideNativeDark('.a'), '.a' + W);
  assert.equal(outsideNativeDark('.a, .b > .c'), '.a' + W + ', .b > .c' + W, 'each selector in a list');
  assert.equal(outsideNativeDark('.x:not(.y, .z)'), '.x:not(.y, .z)' + W, 'a comma inside :not() is not a split');
  assert.equal(outsideNativeDark('[title="a, b::c"] .d'), '[title="a, b::c"] .d' + W, 'nor one inside quotes');
  assert.equal(outsideNativeDark('.m::before'), '.m' + W + '::before', 'goes in front of a pseudo-element');
  assert.equal(outsideNativeDark('.m:after'), '.m' + W + ':after', 'the legacy form too');
  assert.equal(outsideNativeDark('::-webkit-scrollbar-thumb:hover'), W + '::-webkit-scrollbar-thumb:hover');
  assert.equal(outsideNativeDark('a:hover'), 'a:hover' + W, 'a pseudo-class is not a pseudo-element');
});

// A readable stylesheet holding plain style rules, as eachStyleRule walks it.
function fakeSheet(rules) {
  const sheet = { href: 'https://cm.example/ContentManager/css/light.css', ownerNode: null };
  sheet.cssRules = rules.map(([selectorText, decls]) =>
    ({ type: 1, selectorText, style: fakeStyle(decls), parentStyleSheet: sheet }));
  return sheet;
}

function darkSheetFor(rules) {
  const app = load();
  app.document.styleSheets = [fakeSheet(rules)];
  app.streamliner.setDark(true, false);
  return app.document.head.children.find((el) => el.id === 'cm-helper-dark').textContent;
}

test('dark mode: the panel exclusion is added only where the app has the panel', () => {
  const W = ':where(:not(.loginRow>.cell~.cell *))';
  const plain = darkSheetFor([['.box', { 'color': ['rgb(0, 0, 0)'] }]]);
  assert.match(plain, /^\.box\{color:/m, '11.07 has no #contentRight, so no exclusion');
  assert.ok(!plain.includes(W));

  const panel = darkSheetFor([
    ['#contentRight', { 'background-color': ['rgb(43, 46, 55)'] }],
    ['.box', { 'color': ['rgb(0, 0, 0)'] }]
  ]);
  assert.ok(panel.includes('.box' + W + '{color:'), '12.00 and 13.50 get it on every copy');
  assert.ok(panel.includes('#contentRight' + W + '{'));
  assert.ok(!darkSheetFor([['#contentRightish', { 'color': ['rgb(0, 0, 0)'] }]]).includes(W),
    'a longer id is not the panel');
});

test('dark mode: a repeated rule keeps only its last copy', () => {
  const { keepLastCopies } = load().internals;
  same(keepLastCopies(['a', 'b', 'a', 'c', 'b']), ['a', 'c', 'b']);
  same(keepLastCopies([]), []);
});

test('dark mode: Scala logos are swapped, not inverted', () => {
  const app = withConfig({ darkMode: true });
  app.streamliner.setDark(true, false);
  const css = app.document.head.children.find((el) => el.id === 'cm-helper-dark').textContent;
  assert.match(css, /img\[src\*="svg\/scala_logo\.svg"\] \{ content: url\("https:\/\/cm\.example\/ContentManager\/images\/svg\/logo\.svg"\)/);
  assert.match(css, /svg\/logo\.svg"\) !important;[^}]*width: 662px !important/, 'the swap keeps the original width');
  assert.match(css, /img\[src\*="logo=true"\] \{ content: url\("https:\/\/cm\.example\/ContentManager\/images\/profiles\?logo=splash\.png"\)/);
  assert.doesNotMatch(css, /\.mdc-text-field::before/, 'the text field ripple is not forced white');

  const sel = app.internals.DARK_LOGO_SELECTOR;
  for (const asset of ['svg/logo.svg', 'svg/scala_logo.svg', 'logo=true', 'logo=splash', '.splash img']) {
    assert.ok(sel.includes(':not(' + (asset.startsWith('.') ? asset : '[src*="' + asset + '"]') + ')'), asset + ' is excluded');
  }
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

// An element with a working classList and attributes, as the menu and
// sign-in code read them.
function fakeEl(tag, attrs, classes) {
  const cls = new Set(classes || []);
  const at = Object.assign({}, attrs || {});
  return {
    tagName: tag.toUpperCase(),
    id: '',
    classList: {
      add(c) { cls.add(c); },
      remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); }
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(at, k) ? at[k] : null; },
    setAttribute(k, v) { at[k] = String(v); },
    removeAttribute(k) { delete at[k]; }
  };
}

test('section links: the current section stays a link only below its root', () => {
  const app = load({ hash: '#playlists/123' });
  const playlists = fakeEl('a', { href: '#playlists', tabindex: '-1' }, ['svg-group', 'disabled']);
  const media = fakeEl('a', { href: '#media' }, ['svg-group']);
  const anchors = [playlists, media];
  app.document.querySelectorAll = (sel) => sel.startsWith('a.cm-helper-section-link')
    ? anchors.filter((a) => a.classList.contains('cm-helper-section-link'))
    : anchors.filter((a) => a.classList.contains('disabled'));
  const { applySectionLinks } = app.internals;

  applySectionLinks();
  assert.equal(playlists.classList.contains('cm-helper-section-link'), true);
  assert.equal(playlists.getAttribute('tabindex'), '0', 'reachable by keyboard too');
  assert.equal(media.classList.contains('cm-helper-section-link'), false);

  app.window.location.hash = '#playlists';
  applySectionLinks();
  assert.equal(playlists.classList.contains('cm-helper-section-link'), false, 'on the root a click goes nowhere');
  assert.equal(playlists.getAttribute('tabindex'), '-1', 'the app\'s tabindex is put back');

  app.window.location.hash = '#playlists/9';
  applySectionLinks();
  app.streamliner.config.sectionLinks = false;
  applySectionLinks();
  assert.equal(playlists.classList.contains('cm-helper-section-link'), false, 'off undoes it');
});

test('sign-in Enter: focuses the Login button under the id 13.50 looks for', () => {
  const app = load();
  const { onSignInEnter } = app.internals;
  let focused = 0;
  const button = fakeEl('button', {}, ['signIn']);
  button.focus = () => { focused++; };
  const box = { querySelector: (sel) => (sel === 'button.signIn' ? button : null), parentElement: null };
  const input = { tagName: 'INPUT', type: 'password', parentElement: box };
  let holder = null;
  app.document.getElementById = () => holder;

  onSignInEnter({ key: 'a', target: input });
  assert.equal(focused, 0, 'only Enter');

  onSignInEnter({ key: 'Enter', target: input });
  assert.equal(focused, 1);
  assert.equal(button.id, 'signIn');

  button.classList.add('disabled');
  onSignInEnter({ key: 'Enter', target: input });
  assert.equal(focused, 1, 'a disabled button is left alone');
  button.classList.remove('disabled');

  holder = { id: 'signIn' };
  onSignInEnter({ keyCode: 13, target: input });
  assert.equal(focused, 1, 'another element already owns the id');
  holder = null;

  app.streamliner.config.fixSignIn = false;
  onSignInEnter({ key: 'Enter', target: input });
  assert.equal(focused, 1, 'off means off');
});

test('timeslot playlist link: a playlist the server returned is linked', () => {
  const app = load();
  const seen = [];
  const Playlist = function () {};
  Playlist.prototype.updateFields = function () { seen.push(this.accessViewPlaylist); };
  let editorDetails = 0;
  const Editor = function () {};
  Editor.prototype.updatePlaylistDetails = function () { editorDetails++; mods['components/schedule/playlist'] = Playlist; };
  const mods = { 'module/schedule/timeslotEditor': Editor, 'support/Resource': { PLAYLIST_VIEW: 'pv' } };
  const req = (name) => mods[name];
  req.defined = (name) => name in mods;
  app.window.require = req;
  let allowed = true;
  app.window.App = { hasPermissionWithoutImplicit: (r) => allowed && r === 'pv' };
  const { applyPlaylistLink } = app.internals;

  // Not defined yet: the editor is hooked, and patches it the moment it exists.
  applyPlaylistLink();
  new Editor().updatePlaylistDetails();
  assert.equal(editorDetails, 1, 'the original always runs');

  const view = () => { const v = new Playlist(); v.playlist = { attributes: {} }; v.accessViewPlaylist = false; return v; };
  let v = view();
  v.updateFields(v.playlist.attributes);
  assert.equal(seen.pop(), true, 'the success path gets the link');

  v = view();
  v.updateFields({ name: 'from options' });
  assert.equal(seen.pop(), false, 'the error path is left alone');

  allowed = false;
  v = view();
  v.updateFields(v.playlist.attributes);
  assert.equal(seen.pop(), false, 'no playlist view permission, no link');
  allowed = true;

  app.streamliner.config.timeslotPlaylistLink = false;
  v = view();
  v.updateFields(v.playlist.attributes);
  assert.equal(seen.pop(), false, 'off means off');
});
