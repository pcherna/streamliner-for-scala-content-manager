// ==UserScript==
// @name         Streamliner for Scala Content Manager
// @namespace    https://github.com/peter/cm-browser-helper
// @version      1.32.0
// @description  Autofill fix, faster animations, search hotkey, dark mode, text side menus and a settings panel.
// @match        *://*/ContentManager/*
// @run-at       document-start
// @grant        none
// @license      GPL-3.0-or-later
// ==/UserScript==

// Streamliner. This one file is both a Tampermonkey userscript and the content script loaded
// by manifest.json. Chrome ignores the header comment above. See README.md.
//
// Copyright (C) 2026 Peter Cherna
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// General Public License at <https://www.gnu.org/licenses/> for more details.

(function () {
  'use strict';

  var CONFIG = {
    // ---- animation speed -------------------------------------------------
    // Animations run this many times faster. 1 disables all scaling.
    speedFactor: 10,
    scaleJquery: true,
    scaleCss: true,
    scaleWebAnimations: true,
    // Opt-in. Scales setTimeout delays at or below timeoutCeilingMs.
    // Off by default because the app also schedules real work on short timers.
    scaleTimeouts: false,
    timeoutCeilingMs: 1000,

    // ---- login -----------------------------------------------------------
    // Makes the Sign In button react to a password manager filling the fields.
    // Two halves of one job, so one switch. A server with disableLoginAutocomplete
    // on renders the login inputs readonly, which stops a password manager
    // filling them at all; and the app only enables Sign In from a keyup, which
    // a fill does not produce. Wanting one without the other makes no sense.
    fixSignIn: true,
    // Shows which server you are signing in to, on the login page.
    showHostBadge: true,
    // Puts the host in front of the page title, so the tab names the server.
    hostInTitle: true,
    // Only used on 13.x, where nothing nearby is heading-sized.
    hostBadgeSize: '19px',

    // ---- shortcuts -------------------------------------------------------
    focusSearch: true,
    // A single key, or one with modifiers: "/", "cmd+k", "ctrl+k", "alt+s".
    // A bare key is ignored while you are typing; a modifier combination is not.
    searchHotkey: '/',

    // ---- appearance ------------------------------------------------------
    // Pinned side menus show labels instead of icons.
    textOnlyPinnedMenu: true,
    pinnedMenuWidth: '118px',
    // Hover and keyboard-focus highlight for the compact menu rows.
    pinnedHoverColor: 'rgba(128,128,128,.30)',
    // Shorter labels for the compact menus only. The fly-in menu is untouched.
    // Keys are the full label text. The full text stays as the hover tooltip.
    labelOverrides: {
      'Settings': 'Report Settings',
      'Maintenance Jobs': 'Maintenance',
      'Scala Apps Configuration': 'Apps Config',
      'View API Documentation': 'API Docs',
      'Player Updater Management': 'Player Updaters',
      'Scala Software Updates blog': 'Scala Updates blog'
    },
    // Dark mode is off until you turn it on. The choice is remembered per server.
    darkMode: false,
    // Lightens logo artwork so black ink does not vanish on a dark page. The
    // trade is that a saturated mark comes back lighter than it started: the
    // Scala red reads pink. Turn this off to keep the brand exact and accept
    // that the wordmark goes dark on dark.
    darkModeInvertLogos: true,

    debug: false
  };

  // A frozen copy of the shipped defaults, so the settings panel can reset.
  var DEFAULTS = JSON.parse(JSON.stringify(CONFIG));
  var CONFIG_KEY = 'streamlinerConfig';

  // Settings live in localStorage on the Content Manager origin. That works the
  // same in the extension and the userscript: the content script runs in the
  // MAIN world where chrome.storage does not exist, and the userscript uses
  // @grant none. The cost is that settings are per server, which is wanted here
  // because 11.x and 13.x need different ones.
  function loadConfig() {
    try {
      var raw = window.localStorage.getItem(CONFIG_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      for (var k in saved) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) CONFIG[k] = saved[k];
      }
    } catch (e) { /* private mode, or corrupt json */ }
  }

  function saveConfig() {
    var out = {};
    for (var k in DEFAULTS) {
      if (JSON.stringify(CONFIG[k]) !== JSON.stringify(DEFAULTS[k])) out[k] = CONFIG[k];
    }
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(out));
    } catch (e) { /* private mode */ }
  }

  var VERSION = '1.32.0';
  var TAG = '[streamliner]';
  var POLL_MS = 250;
  var STYLE_ID = 'cm-helper-speed';
  var DARK_ID = 'cm-helper-dark';
  var SIGNIN_BUTTON = 'button.signIn';
  var ANCESTOR_DEPTH = 5;
  var SEARCH_SELECTOR = 'input.search, input#search, input[type="search"]';
  // The entry in the top-right dropdown is not optional: it is the only way
  // to reach the settings, so there is no setting to turn it off.
  var SETTINGS_LABEL = 'Streamliner Settings';

  // Captured before any patching, so the helper's own timers stay unscaled.
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeSetInterval = window.setInterval.bind(window);
  var nativeClearInterval = window.clearInterval.bind(window);

  function log() {
    if (!CONFIG.debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }

  function factor() {
    return CONFIG.speedFactor > 0 ? CONFIG.speedFactor : 1;
  }

  function scale(ms) {
    return Math.round((ms / factor()) * 1e5) / 1e5;
  }

  function makeStyle(id) {
    var el = document.createElement('style');
    el.id = id;
    el.setAttribute('data-cm-helper', 'true');
    (document.head || document.documentElement).appendChild(el);
    return el;
  }

  // ---------------------------------------------------------------- jQuery

  // Every jQuery animation resolves its duration through jQuery.speed, which
  // turns "fast", "slow" and the default into a number. Wrapping it covers
  // animate, fadeIn, fadeOut, slideUp, slideDown, show, hide and toggle.
  // jQuery.fn.delay bypasses speed and needs its own wrapper.
  function patchJquery($) {
    if (!$ || !$.fn || typeof $.speed !== 'function' || $.__cmHelperPatched) return;
    $.__cmHelperPatched = true;

    var origSpeed = $.speed;
    $.speed = function () {
      var opt = origSpeed.apply(this, arguments);
      if (opt && typeof opt.duration === 'number') opt.duration = scale(opt.duration);
      return opt;
    };

    var origDelay = $.fn.delay;
    if (typeof origDelay === 'function') {
      $.fn.delay = function (time, type) {
        var named = $.fx && $.fx.speeds ? $.fx.speeds[time] : undefined;
        var ms = typeof named === 'number' ? named : time;
        return origDelay.call(this, typeof ms === 'number' ? scale(ms) : ms, type);
      };
    }

    log('patched jQuery', $.fn.jquery || '(unknown version)');
  }

  // 11.07 loads jQuery 3.3.1 as a plain script and main.js bundles 3.0.0.
  // 13.50 loads 3.7.0. All of them assign window.jQuery and window.$.
  function trapGlobal(name, onValue) {
    var value;
    try {
      value = window[name];
    } catch (e) {
      value = undefined;
    }
    onValue(value);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () {
          return value;
        },
        set: function (v) {
          value = v;
          onValue(v);
        }
      });
    } catch (e) {
      log('could not trap window.' + name, e);
    }
  }

  // ------------------------------------------------------- stylesheet walk

  // Shared by the animation scaler and dark mode. Skips the helper's own
  // sheets and any cross-origin sheet that refuses to be read.
  function walkRules(rules, fn, prefix, suffix) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];

      // scala.css and light.css both arrive through @import.
      if (rule.type === CSSRule.IMPORT_RULE) {
        var imported = null;
        try {
          imported = rule.styleSheet ? rule.styleSheet.cssRules : null;
        } catch (e) {
          imported = null;
        }
        if (imported) walkRules(imported, fn, prefix, suffix);
        continue;
      }

      if (rule.type === CSSRule.MEDIA_RULE) {
        walkRules(rule.cssRules, fn, prefix + '@media ' + rule.media.mediaText + '{', '}' + suffix);
        continue;
      }

      if (rule.type === CSSRule.SUPPORTS_RULE) {
        walkRules(rule.cssRules, fn, prefix + '@supports ' + rule.conditionText + '{', '}' + suffix);
        continue;
      }

      if (rule.type !== CSSRule.STYLE_RULE || !rule.style || !rule.selectorText) continue;
      fn(rule, prefix, suffix);
    }
  }

  function eachStyleRule(fn) {
    var sheets = document.styleSheets;
    if (!sheets) return 0;
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var node = sheet.ownerNode;
      if (node && node.getAttribute && node.getAttribute('data-cm-helper')) continue;
      var rules = null;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue; // cross-origin sheet
      }
      if (rules) walkRules(rules, fn, '', '');
    }
    return sheets.length;
  }

  // ------------------------------------------------- CSS animation scaling

  var TIME_PROPS = [
    'transition-duration',
    'transition-delay',
    'animation-duration',
    'animation-delay'
  ];

  // "0.2s, 150ms" -> "0.02s, 15ms". Returns null when nothing was scalable.
  function scaleTimeList(value) {
    var changed = false;
    var parts = String(value).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var m = part.match(/^(-?[0-9]*\.?[0-9]+)(ms|s)$/);
      if (!m) {
        out.push(part);
        continue;
      }
      var n = parseFloat(m[1]);
      if (!isFinite(n) || n === 0) {
        out.push(part);
        continue;
      }
      changed = true;
      out.push(scale(n) + m[2]);
    }
    return changed ? out.join(', ') : null;
  }

  var styleEl = null;

  function applyCssScaling() {
    if (!CONFIG.scaleCss) return;

    var out = [];
    eachStyleRule(function (rule, prefix, suffix) {
      var decls = [];
      for (var p = 0; p < TIME_PROPS.length; p++) {
        // scala.css declares the shake animation only in its -webkit- form.
        var names = [TIME_PROPS[p], '-webkit-' + TIME_PROPS[p]];
        for (var k = 0; k < names.length; k++) {
          var raw = rule.style.getPropertyValue(names[k]);
          if (!raw) continue;
          var scaled = scaleTimeList(raw);
          if (scaled) decls.push(names[k] + ':' + scaled + ' !important');
        }
      }
      if (decls.length) out.push(prefix + rule.selectorText + '{' + decls.join(';') + '}' + suffix);
    });
    if (!out.length) return;

    var css = out.join('\n');
    if (styleEl && styleEl.textContent === css) return;
    if (!styleEl) styleEl = makeStyle(STYLE_ID);
    styleEl.textContent = css;
    log('scaled ' + out.length + ' css rules');
  }

  // -------------------------------------------------------- Web Animations

  function patchWebAnimations() {
    if (!window.Element || !Element.prototype.animate) return;
    if (Element.prototype.animate.__cmHelperPatched) return;

    var orig = Element.prototype.animate;
    var patched = function (keyframes, options) {
      if (typeof options === 'number') {
        options = scale(options);
      } else if (options && typeof options === 'object') {
        var copy = {};
        for (var key in options) {
          if (Object.prototype.hasOwnProperty.call(options, key)) copy[key] = options[key];
        }
        if (typeof copy.duration === 'number') copy.duration = scale(copy.duration);
        if (typeof copy.delay === 'number') copy.delay = scale(copy.delay);
        if (typeof copy.endDelay === 'number') copy.endDelay = scale(copy.endDelay);
        options = copy;
      }
      return orig.call(this, keyframes, options);
    };
    patched.__cmHelperPatched = true;
    Element.prototype.animate = patched;
    log('patched Element.prototype.animate');
  }

  // ------------------------------------------------------------- setTimeout

  function patchTimeouts() {
    if (window.setTimeout.__cmHelperPatched) return;
    var orig = window.setTimeout;
    var patched = function (fn, delay) {
      var rest = Array.prototype.slice.call(arguments, 2);
      var d = typeof delay === 'number' ? delay : 0;
      if (d > 0 && d <= CONFIG.timeoutCeilingMs) d = scale(d);
      return orig.apply(window, [fn, d].concat(rest));
    };
    patched.__cmHelperPatched = true;
    window.setTimeout = patched;
    log('patched setTimeout up to ' + CONFIG.timeoutCeilingMs + 'ms');
  }

  // --------------------------------------------------------------- Sign In

  // The login view binds "click .signIn:not(.disabled)" and "keyup input".
  // Only the keyup handler clears the disabled class, and a password manager
  // fills the fields without one. Dispatching the keyup lets the app's own
  // validation run, which keeps its double-submit guard intact.

  var lastValues = new WeakMap();

  function isTextEntry(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var type = (el.type || 'text').toLowerCase();
    return type !== 'checkbox' && type !== 'radio' && type !== 'hidden' &&
           type !== 'submit' && type !== 'button' && type !== 'file' && type !== 'range';
  }

  function isSignInInput(el) {
    if (!isTextEntry(el)) return false;
    var node = el.parentElement;
    for (var i = 0; i < ANCESTOR_DEPTH && node; i++, node = node.parentElement) {
      if (node.querySelector(SIGNIN_BUTTON)) return true;
    }
    return false;
  }

  // Every text input that shares a container with a sign-in button. Covers the
  // login, reset-password, new-password and create-network views.
  function signInInputs() {
    var buttons = document.querySelectorAll(SIGNIN_BUTTON);
    var found = [];
    for (var i = 0; i < buttons.length; i++) {
      var node = buttons[i].parentElement;
      for (var d = 0; d < ANCESTOR_DEPTH && node; d++, node = node.parentElement) {
        var inputs = node.querySelectorAll('input');
        if (!inputs.length) continue;
        var kept = 0;
        for (var k = 0; k < inputs.length; k++) {
          if (!isTextEntry(inputs[k])) continue;
          kept++;
          if (found.indexOf(inputs[k]) === -1) found.push(inputs[k]);
        }
        if (!kept) continue;
        break;
      }
    }
    return found;
  }

  function notify(el, why) {
    var value = el.value;
    if (lastValues.get(el) === value) return;
    lastValues.set(el, value);

    if (el.hasAttribute('readonly')) el.removeAttribute('readonly');

    // updateFormStatus only reads keyCode to short-circuit on Enter, so a
    // synthetic event with no keyCode takes the safe branch.
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'a' }));
    log('dispatched keyup on', el.className || el.name || el.type, 'via', why);
  }

  function onValueEvent(e) {
    if (!isSignInInput(e.target)) return;
    notify(e.target, e.type);
  }

  var pollTimer = null;

  function pollTick() {
    var inputs = signInInputs();
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!lastValues.has(el)) lastValues.set(el, '');
      if (lastValues.get(el) !== el.value) notify(el, 'poll');
    }
  }

  function updateSignInWatch(present) {
    if (present && !pollTimer) {
      pollTimer = nativeSetInterval(pollTick, POLL_MS);
      log('sign-in form present, polling started');
      pollTick();
    } else if (!present && pollTimer) {
      nativeClearInterval(pollTimer);
      pollTimer = null;
      log('sign-in form gone, polling stopped');
    }

    if (present) {
      var inputs = signInInputs();
      for (var i = 0; i < inputs.length; i++) {
        if (!inputs[i].hasAttribute('readonly')) continue;
        inputs[i].removeAttribute('readonly');
        log('removed readonly from', inputs[i].className || inputs[i].name);
      }
    }
  }

  // ------------------------------------------------------------ host badge

  // Which server am I signing in to. The two versions lay the login page out
  // differently, so the badge follows the page rather than floating over it.
  // 11.x centres an <h1> title under the logo, and the badge goes under that in
  // the same style. 13.x has no title: the left panel carries the logo and the
  // copyright line, so the badge goes under the copyright, sized to match the
  // 11.x title so it reads as a heading either way.
  var badge = null;

  function hostBadgeText() {
    return window.location.host + window.location.pathname.replace(/\/+$/, '');
  }

  // Puts the host in front of the page title so the tab names the server. The
  // app rewrites the title on every navigation, so this watches the <title>
  // element and puts the prefix back. Host first, because tabs truncate.
  var titleWatched = false;

  function applyHostTitle() {
    if (!CONFIG.hostInTitle) return;
    var host = window.location.host;
    var current = document.title || '';
    if (current.indexOf(host) === 0) return;
    document.title = host + ' \u00b7 ' + current;
  }

  function watchTitle() {
    if (titleWatched) return;
    var node = document.querySelector('title');
    if (!node) return;
    titleWatched = true;
    new MutationObserver(function () {
      applyHostTitle();
    }).observe(node, { childList: true, characterData: true, subtree: true });
    applyHostTitle();
  }

  function removeHostBadge() {
    if (!badge) return;
    // On 11.x the badge is the app's own heading, so put its text back rather
    // than deleting the element.
    var original = badge.getAttribute ? badge.getAttribute('data-cm-title') : null;
    if (original !== null) {
      badge.textContent = original;
      badge.removeAttribute('data-cm-title');
      badge.removeAttribute('id');
      badge.removeAttribute('data-cm-helper');
    } else if (badge.parentNode) {
      badge.parentNode.removeChild(badge);
    }
    badge = null;
  }

  function updateHostBadge(present) {
    // A sign-in button alone is not enough. The reset-password and new-password
    // views have one too, and on 12.00 they carry an <h1> of their own, which
    // the 11.x branch below would happily overwrite with the host. Only the
    // sign-in form has a username field.
    var isLoginForm = present && !!document.querySelector('input.username');
    if (!CONFIG.showHostBadge || !isLoginForm || !document.body) {
      removeHostBadge();
      return;
    }
    if (badge && badge.parentNode && document.body.contains(badge)) return;
    removeHostBadge();

    // 11.x: the <h1> holds "Scala Enterprise Content Manager". Replacing its
    // text beats adding a line under it, and it means the badge is styled by
    // the app's own .login h1 rule with nothing declared here.
    var title = document.querySelector('.login h1, .landing h1');
    if (title) {
      if (title.getAttribute('data-cm-title') === null) {
        title.setAttribute('data-cm-title', title.textContent);
      }
      title.setAttribute('data-cm-helper', 'true');
      title.id = 'cm-helper-host';
      var wanted = hostBadgeText();
      if (title.textContent.trim() !== wanted) title.textContent = wanted;
      badge = title;
      log('host badge replaced the page title');
      return;
    }

    // 13.x has no title to replace. Its left panel carries the logo and a
    // copyright line, so the badge goes under the copyright. Nothing around it
    // is heading-sized, so the size is stated outright.
    var anchor = document.querySelector('#contentLeft p.version, .landing p.version, p.version');
    if (!anchor || !anchor.parentNode) return;

    badge = document.createElement('p');
    badge.id = 'cm-helper-host';
    badge.setAttribute('data-cm-helper', 'true');
    badge.textContent = hostBadgeText();
    badge.style.cssText = 'text-align:center;margin:14px 0 0;font-size:' + CONFIG.hostBadgeSize + ';';

    anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    log('host badge placed under the copyright line');
  }

  // ------------------------------------------------------ pinned side menu

  // The docked menus (.leftPinnedMenu / .rightPinnedMenu, min-width 75px with
  // overflow-x hidden) are the shrunken layout. This swaps the icon for the
  // label. The shrunken menu does not always render a label element, so the
  // icon is only hidden once an anchor is known to carry text: the marker class
  // cm-helper-has-label gates every hiding rule. A menu can never end up blank.
  var PINNED_ITEM = '.leftPinnedMenu li a, .rightPinnedMenu li a';

  var PINNED_TEXT_CSS = [
    '.leftPinnedMenu, .rightPinnedMenu { min-width: %W% !important; }',
    // The inner menu is position:fixed, so it sizes to its content rather than
    // to the cell above. Left alone it grows past the width the layout reserves
    // and overhangs the page: on 13.50 "Scala Software Updates blog" made the
    // right menu 171px against a 118px cell. Pinning the width makes it wrap.
    '.leftPinnedMenu .navbar-sidebar-menu, .rightPinnedMenu .navbar-sidebar-menu {',
    '  width: %W% !important; box-sizing: border-box !important; }',
    'a.cm-helper-has-label > svg, a.cm-helper-has-label > img { display: none !important; }',
    'a.cm-helper-has-label > span, a.cm-helper-has-label > .nav-label,',
    'a.cm-helper-has-label > .cm-helper-label {',
    '  display: inline-block !important; visibility: visible !important;',
    '  opacity: 1 !important; white-space: normal !important; overflow-wrap: anywhere;',
    // max-width:none would let a long label spill past the menu edge.
    '  width: auto !important; height: auto !important; max-width: 100% !important;',
    '  font-size: 11px !important; line-height: 1.35 !important;',
    '  text-indent: 0 !important; margin: 0 !important; text-align: left; color: inherit;',
    // light.css underlines these spans, which reads as noise in a nav list.
    '  text-decoration: none !important; }',
    // light.css gives the ul 12px side margins. In a 118px menu that is width
    // the labels need, so take it back and spend it on the hover target. This
    // gains room overall: the labels wrap less than they did with icons.
    '.leftPinnedMenu section ul, .rightPinnedMenu section ul {',
    '  margin-left: 4px !important; margin-right: 4px !important; }',
    // Some list items carry a nudge to line their icons up: the Schedules item
    // sits at margin-left -3px. With the icons gone that just skews the text.
    '.leftPinnedMenu li, .rightPinnedMenu li { margin-left: 0 !important; }',
    // inline-block, not block: a full-width row makes the hover target far
    // wider than the label it belongs to, and it reached under the arrow.
    '.leftPinnedMenu li a, .rightPinnedMenu li a {',
    '  display: inline-block !important; margin-left: 0 !important; padding: 2px 6px !important;',
    '  max-width: 100% !important; box-sizing: border-box !important;',
    '  border-radius: 3px; transition: background-color 90ms ease-out; }',
    // Hiding the icons removed the only hover feedback, because light.css
    // changes the svg fill on hover and little else. A mid grey overlay reads
    // on the light module sections and on the dark settings blocks alike, and
    // it survives dark mode because helper sheets are never colour-inverted.
    '.leftPinnedMenu li a:hover, .rightPinnedMenu li a:hover,',
    '.leftPinnedMenu li a:focus-visible, .rightPinnedMenu li a:focus-visible {',
    '  background-color: %H% !important; }',
    // The pin/unpin arrows are svg too, and must stay visible.
    '.showLeftPinnedMenu, .hideLeftPinnedMenu,',
    '.showRightPinnedMenu, .hideRightPinnedMenu { display: block !important; }',
    // The arrow shares its row with the first entry, and with icons gone the
    // label runs straight into it: on the right they abutted at exactly 0px.
    // Give that one row the arrow's width back as padding. The left arrow sits
    // at the end of the row, the right one at the start.
    // Margin, not padding: padding sits inside the box, so the hover pill still
    // covered the arrow. Margin keeps the box, and the highlight, clear of it.
    '.leftPinnedMenu section.settings li a { margin-right: 26px !important; }',
    '.rightPinnedMenu section.settings li a { margin-left: 28px !important; }'
  ].join('\n');

  var pinnedEl = null;

  function normalizeLabel(text) {
    return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Rebuilt on every pass so edits to CONFIG.labelOverrides take effect live.
  function buildOverrideIndex() {
    var index = {};
    var src = CONFIG.labelOverrides || {};
    for (var key in src) {
      if (Object.prototype.hasOwnProperty.call(src, key)) index[normalizeLabel(key)] = src[key];
    }
    return index;
  }

  function labelTextFor(a, index) {
    var existing = a.querySelector('.nav-label, .cm-helper-label, span');
    var full = existing ? existing.textContent.trim() : '';
    // 13.50 renders no label element at all: the text is in title, and on a few
    // items only in aria-label. data-test is the last resort.
    if (!full) full = (a.getAttribute('title') || a.getAttribute('aria-label') || '').trim();
    if (!full) {
      // Turn data-test="playerHealth" into "Player Health".
      var slug = (a.getAttribute('data-test') || '').trim();
      if (slug) {
        full = slug.replace(/[-_]+/g, ' ')
                   .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                   .replace(/^./, function (c) { return c.toUpperCase(); });
      }
    }
    if (!full) return null;

    // Remember the unshortened text, so repeat passes stay idempotent and the
    // tooltip still says what the item really is.
    full = a.getAttribute('data-cm-full') || full;
    a.setAttribute('data-cm-full', full);
    if (!a.getAttribute('title')) a.setAttribute('title', full);

    var key = normalizeLabel(full);
    var text = Object.prototype.hasOwnProperty.call(index, key) ? index[key] : full;

    if (existing) {
      if (existing.textContent.trim() !== text) existing.textContent = text;
      return existing;
    }
    var span = document.createElement('span');
    span.className = 'cm-helper-label';
    span.setAttribute('data-cm-helper', 'true');
    span.textContent = text;
    a.appendChild(span);
    return span;
  }

  function applyPinnedMenu() {
    if (!CONFIG.textOnlyPinnedMenu) return;
    if (!pinnedEl && (document.head || document.documentElement)) {
      pinnedEl = makeStyle('cm-helper-pinned');
      pinnedEl.textContent = PINNED_TEXT_CSS
        .split('%W%').join(CONFIG.pinnedMenuWidth)
        .split('%H%').join(CONFIG.pinnedHoverColor);
    }
    var index = buildOverrideIndex();
    var items = document.querySelectorAll(PINNED_ITEM);
    var labelled = 0;
    for (var i = 0; i < items.length; i++) {
      var a = items[i];
      var label = labelTextFor(a, index);
      // Only hide the icon once this anchor actually has text to show instead.
      if (label) labelled++;
      a.classList[label ? 'add' : 'remove']('cm-helper-has-label');
    }
    if (items.length) log('pinned menu: ' + labelled + '/' + items.length + ' items labelled');
  }

  // ------------------------------------------------------------- dark mode

  // A real dark theme, not a filter. Applying `filter: invert()` to <html>
  // makes it the containing block for fixed-position descendants, which breaks
  // this app's fixed sidebars and modals. Instead every colour declared in the
  // stylesheets gets its HSL lightness flipped, hue and saturation kept, and is
  // re-emitted as an !important override. Images are never touched.
  // Each colour property is mapped by the role it plays, not by inverting it.
  // A plain inversion turns an already-dark panel light, which is what made the
  // 13.x login form come out pale grey: #2b2e37 has lightness .19, and 1 - .19
  // is .81. Roles instead push every surface into a dark band and every piece
  // of text into a light one, whichever theme the page started from.
  var DARK_ROLES = {
    'background-color': 'surface',
    'border-top-color': 'edge',
    'border-right-color': 'edge',
    'border-bottom-color': 'edge',
    'border-left-color': 'edge',
    'outline-color': 'edge',
    'column-rule-color': 'edge',
    'color': 'text',
    'fill': 'text',
    'stroke': 'text',
    'caret-color': 'text',
    'text-decoration-color': 'text'
  };

  // Output lightness bands, [darkest, lightest].
  var DARK_BANDS = {
    surface: [0.06, 0.26],
    edge: [0.20, 0.36],
    text: [0.62, 0.96]
  };

  var DARK_PROPS = Object.keys(DARK_ROLES);

  // Photographs must not be inverted: the Media library is full of them, and a
  // negative thumbnail is worse than a dark one. Logos are the exception, since
  // their ink is usually black and vanishes once the page behind them is dark.
  // "logo" in the URL is a narrow enough test to be safe here: Content Manager
  // serves its brand art from images/profiles/?logo=... and scala_logo.svg,
  // while media thumbnails carry an asset id instead.
  //
  // invert() alone would turn the red mark cyan. Following it with a 180 degree
  // hue rotation puts the hue back, so black ink goes white and red stays red.
  var DARK_LOGO_SELECTOR = 'img[src*="logo"], .scala-logo img, #scalaImg, .splash img';

  // Split in two on purpose. Everything here is !important, and so is every
  // rule the walk generates, so when both target the same selector the later
  // one wins. Anything that has to beat a generated rule must come after it:
  // the app styles its own scrollbars, and Material's ripple selectors are
  // walked like any other rule.
  function darkBaseTop() {
    return [
      'html { color-scheme: dark !important; }',
      'html, body { background-color: #17181a !important; }'
    ].join('\n');
  }

  function darkBaseBottom() {
    var lines = [
      // color-scheme alone does not win when the app styles the scrollbar
      // itself, and Content Manager does.
      'html { scrollbar-color: #45484d #1b1c1e !important; }',
      '::-webkit-scrollbar, ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner {',
      '  background-color: #1b1c1e !important; }',
      '::-webkit-scrollbar-thumb { background-color: #45484d !important; }',
      '::-webkit-scrollbar-thumb:hover { background-color: #55585e !important; }',
      // Material's ripples are overlays: a circle behind a control, tinted with
      // the theme colour and held at a low opacity. The surface mapping never
      // lightens, so #6200ee became a dark purple, and a dark tint over a dark
      // field reads as a smudge. On the yk login page it drew a visible ellipse
      // behind the focused Username box. An overlay on a dark theme has to
      // lighten, so these are forced white and left to their own opacity.
      '.mdc-ripple-surface::before, .mdc-ripple-surface::after,',
      '.mdc-ripple-upgraded::before, .mdc-ripple-upgraded::after,',
      '.mdc-text-field::before, .mdc-text-field::after,',
      '.mdc-tab__ripple::before, .mdc-tab__ripple::after,',
      '.mdc-button::before, .mdc-button::after,',
      '.mdc-icon-button::before, .mdc-icon-button::after,',
      '.mdc-radio::before, .mdc-radio::after,',
      '.mdc-checkbox::before, .mdc-checkbox::after {',
      '  background-color: #ffffff !important; }'
    ];
    if (CONFIG.darkModeInvertLogos) {
      lines.push(DARK_LOGO_SELECTOR + ' { filter: invert(1) hue-rotate(180deg) !important; }');
    }
    return lines.join('\n');
  }

  function parseRgb(value) {
    var m = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:\s*[,\/]\s*([0-9.]+%?))?\s*\)$/
      .exec(String(value).trim());
    if (!m) return null;
    var a = 1;
    if (m[4] !== undefined) {
      a = m[4].charAt(m[4].length - 1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    return [+m[1], +m[2], +m[3], a];
  }

  // Canvas normalises anything CSS accepts as a colour: hex, named, rgb, hsl.
  // Two different sentinels catch a value the parser rejected, which otherwise
  // leaves fillStyle at whatever it held before.
  var colourProbe = null;

  function normaliseColour(value) {
    if (!colourProbe) {
      try {
        colourProbe = document.createElement('canvas').getContext('2d');
      } catch (e) {
        colourProbe = false;
      }
    }
    if (!colourProbe) return null;
    colourProbe.fillStyle = '#000000';
    colourProbe.fillStyle = value;
    var first = colourProbe.fillStyle;
    colourProbe.fillStyle = '#ffffff';
    colourProbe.fillStyle = value;
    if (first !== colourProbe.fillStyle) return null;
    return first;
  }

  function hexToRgb(value) {
    var hex = String(value).trim();
    if (hex.charAt(0) !== '#') return null;
    hex = hex.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(function (ch) { return ch + ch; }).join('');
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    var out = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    ];
    return isFinite(out[0]) && isFinite(out[1]) && isFinite(out[2]) ? out : null;
  }

  // currentcolor is not a colour, it is a reference to the element's own color,
  // which is already being recoloured. Resolving it produced black, the edge
  // band lightened that to grey, and because it appears on the universal
  // selector the result was an !important grey border on everything. 12.00's
  // dashboard uses 30px transparent borders as spacing between tiles, so that
  // painted a grey lattice across the whole dashboard. The other keywords are
  // context-dependent in the same way.
  var COLOUR_KEYWORDS = /^(currentcolor|inherit|initial|unset|revert|revert-layer|none|auto)$/i;

  // Stylesheet values are usually already rgb(), but a var() reference keeps
  // its raw text. Content Manager never declares the custom properties that
  // Material's rules ask for, so those rules fall through to the literal
  // fallback: var(--mdc-theme-primary, #6200ee) really does paint #6200ee.
  function colourFromValue(value) {
    var raw = String(value).trim();
    if (!raw || COLOUR_KEYWORDS.test(raw)) return null;
    var direct = parseRgb(raw);
    if (direct) return direct;

    var m = /^var\(\s*--[^,()]+,([\s\S]+)\)$/.exec(raw);
    if (m) raw = m[1].trim();
    if (!raw || /var\(/.test(raw) || COLOUR_KEYWORDS.test(raw)) return null;

    var normalised = normaliseColour(raw);
    if (!normalised) return null;
    return parseRgb(normalised) || hexToRgb(normalised);
  }

  function hslToRgb(h, s, l) {
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue(p, q, h + 1 / 3);
      g = hue(p, q, h);
      b = hue(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function recolour(c, role) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    // Hue and saturation are kept. Only lightness moves, into the band for
    // this role, inverted within the band so the original contrast direction
    // survives.
    var band = DARK_BANDS[role] || DARK_BANDS.surface;
    var nl = band[0] + (1 - l) * (band[1] - band[0]);

    // Two invariants matter more than the band itself. A surface must never
    // come out lighter than it started, or a page that was already dark gets
    // washed out. And text must never come out darker than it started.
    if (role === 'text') nl = Math.max(l, nl);
    else if (role !== 'edge') nl = Math.min(l, nl);

    var out = hslToRgb(h, s, nl);
    return 'rgba(' + out[0] + ',' + out[1] + ',' + out[2] + ',' + c[3] + ')';
  }

  // Gradients hide colours where a plain property walk never looks. Content
  // Manager paints its panels with
  //   linear-gradient(rgb(255,255,255) 0%, rgb(246,246,246) 7% ...)
  // so the filters box and the list stayed white while their text went light,
  // which is worse than leaving them alone. Every colour stop is recoloured as
  // a surface. A background-image that is only a url() is left untouched.
  function recolourGradient(value) {
    if (!/gradient\(/i.test(value)) return null;
    var changed = false;
    var out = String(value).replace(/rgba?\([^()]*\)/gi, function (token) {
      var c = parseRgb(token);
      if (!c || c[3] === 0) return token;
      changed = true;
      return recolour(c, 'surface');
    });
    out = out.replace(/#[0-9a-fA-F]{3,8}\b/g, function (token) {
      var c = hexToRgb(token);
      if (!c) return token;
      changed = true;
      return recolour(c, 'surface');
    });
    return changed ? out : null;
  }

  // Recolours every colour token in a value, leaving the rest of it alone.
  // Used for box-shadow, where the colour sits among lengths and keywords.
  function recolourColourList(value) {
    var raw = String(value).trim();
    if (!raw || raw === 'none') return null;
    var changed = false;
    var out = raw.replace(/rgba?\([^()]*\)/gi, function (token) {
      var c = parseRgb(token);
      if (!c || c[3] === 0) return token;
      changed = true;
      return recolour(c, 'surface');
    });
    out = out.replace(/#[0-9a-fA-F]{3,8}\b/g, function (token) {
      var c = hexToRgb(token);
      if (!c) return token;
      changed = true;
      return recolour(c, 'surface');
    });
    return changed ? out : null;
  }

  function buildDarkCss() {
    var out = [];
    eachStyleRule(function (rule, prefix, suffix) {
      var decls = [];
      for (var i = 0; i < DARK_PROPS.length; i++) {
        var prop = DARK_PROPS[i];
        var raw = rule.style.getPropertyValue(prop);
        if (!raw) continue;
        var c = colourFromValue(raw);
        if (!c || c[3] === 0) continue;
        decls.push(prop + ':' + recolour(c, DARK_ROLES[prop]) + ' !important');
      }
      var bgImage = rule.style.getPropertyValue('background-image') || '';
      var gradient = recolourGradient(bgImage);
      if (gradient) {
        decls.push('background-image:' + gradient + ' !important');
      } else if (bgImage.indexOf('url(') !== -1) {
        // A tiled image is a surface texture, and it paints straight over the
        // background-colour we just darkened. 11.x does exactly this:
        //   body { background: #e6e6e6 url(backgrounds/background.png) repeat }
        // so the whole page kept a pale texture on every screen. Dropping it
        // lets the recoloured colour through. Only images that tile on both
        // axes qualify: an icon is no-repeat and a grip repeats on one axis,
        // and both of those carry meaning worth keeping.
        var repeat = (rule.style.getPropertyValue('background-repeat') || '').trim().toLowerCase();
        if (repeat === 'repeat' || repeat === 'repeat repeat') {
          decls.push('background-image:none !important');
        }
      }

      // A box-shadow is another way to paint a surface. A large inset one fills
      // the element's whole box, and a light one then reads as a white panel.
      // The surface mapping never lightens, so an ordinary dark drop shadow
      // such as rgba(0,0,0,.1) passes through untouched.
      var shadow = recolourColourList(rule.style.getPropertyValue('box-shadow') || '');
      if (shadow) decls.push('box-shadow:' + shadow + ' !important');

      if (decls.length) out.push(prefix + rule.selectorText + '{' + decls.join(';') + '}' + suffix);
    });
    log('dark mode: recoloured ' + out.length + ' rules');
    return darkBaseTop() + '\n' + out.join('\n') + '\n' + darkBaseBottom();
  }

  var darkEl = null;
  var darkOn = false;
  var darkBuiltAt = -1;

  function refreshDark() {
    if (!darkOn || !darkEl) return;
    var count = document.styleSheets ? document.styleSheets.length : 0;
    if (count === darkBuiltAt) return;
    darkBuiltAt = count;
    darkEl.textContent = buildDarkCss();
  }

  function setDark(on, remember) {
    darkOn = !!on;
    if (darkOn) {
      if (!darkEl) darkEl = makeStyle(DARK_ID);
      darkBuiltAt = -1;
      refreshDark();
    }
    if (darkEl) darkEl.disabled = !darkOn;
    if (document.documentElement) {
      document.documentElement.classList[darkOn ? 'add' : 'remove']('cm-helper-dark');
    }
    if (remember !== false) {
      CONFIG.darkMode = darkOn;
      saveConfig();
    }
    log('dark mode', darkOn ? 'on' : 'off');
  }

  // ------------------------------------------------- settings menu item

  // On 13.x the dropdown entries are absolutely positioned against the same
  // right edge, so two of them land on top of each other. Ours takes the first
  // row and Logout moves down one, which also puts Settings before Logout.
  //
  // The row height cannot simply be measured: the sweep runs while the dropdown
  // is shut, where the entries have zero height. Measuring then produced a zero
  // offset and left the new item layered underneath Logout. So when the live
  // height is unavailable, the clone is briefly laid out with visibility hidden
  // to measure it, which is invisible to the reader and needs no open dropdown.
  // Lays an element out just long enough to measure it. The sweep runs while
  // the dropdown is shut, where the entries have no box at all, and measuring
  // then returned zero. Nothing is painted: the styles are restored in the same
  // synchronous block.
  // Measures what the entry wants on one line. Any pinned width is cleared
  // first, or the previous measurement would be measured again.
  function measureBox(el) {
    var width = el.style.width;
    el.style.width = 'auto';
    el.style.whiteSpace = 'nowrap';

    var rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      var display = el.style.display;
      var visibility = el.style.visibility;
      el.style.visibility = 'hidden';
      el.style.display = 'block';
      rect = el.getBoundingClientRect();
      el.style.display = display;
      el.style.visibility = visibility;
    }
    var out = { width: rect.width, height: rect.height };
    el.style.width = width;
    return out;
  }

  function positionUserMenuItem(node, logout) {
    if (window.getComputedStyle(node).position !== 'absolute') return; // 11.x flow layout

    // This runs again whenever the dropdown opens, so it must work from where
    // Logout started, not where it was last put. Reading the live value on a
    // second pass stacked our entry onto the already-shifted Logout and put
    // both on the same row.
    var top;
    if (logout.getAttribute('data-streamliner-base-top') === null) {
      top = parseFloat(window.getComputedStyle(logout).top);
      if (!isFinite(top)) return;
      logout.setAttribute('data-streamliner-base-top', String(top));
      logout.setAttribute('data-streamliner-shifted', logout.style.top || '');
    } else {
      top = parseFloat(logout.getAttribute('data-streamliner-base-top'));
      if (!isFinite(top)) return;
    }

    // Measure both before touching either, or the first width written changes
    // what the second one measures.
    var ours = measureBox(node);
    var theirs = measureBox(logout);
    var height = theirs.height || ours.height;
    if (!height) return;

    node.style.top = top + 'px';
    logout.style.top = (top + height) + 'px';

    // Neither entry may wrap. Without this the label breaks onto a second line
    // and the dropdown clips it.
    node.style.whiteSpace = 'nowrap';
    logout.style.whiteSpace = 'nowrap';

    // Both entries are anchored to the same right edge and sized to their own
    // text, so they came out ragged rather than reading as one dropdown panel.
    // Give both the width of the wider one.
    var width = Math.max(ours.width, theirs.width);
    if (!width) return;
    node.style.boxSizing = 'border-box';
    node.style.width = width + 'px';
    if (logout.getAttribute('data-streamliner-width') === null) {
      logout.setAttribute('data-streamliner-width', logout.style.width || '');
    }
    logout.style.boxSizing = 'border-box';
    logout.style.width = width + 'px';
  }

  // The width is pinned from a measurement, and at install time the page is
  // often still using a fallback font. Roboto then arrives wider than what was
  // measured, and the label overflows the width it was given. Measuring again
  // once the fonts have settled is the fix.
  var fontsWatched = false;

  function remeasureUserMenuItem() {
    var node = document.querySelector('[data-streamliner-usermenu]');
    if (!node) return;
    var logout = null;
    var candidates = document.querySelectorAll('a.logout, a[href="#logout"]');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].closest('[data-streamliner-usermenu]')) continue;
      logout = candidates[i];
      break;
    }
    if (logout) positionUserMenuItem(node, logout);
  }

  function watchFonts() {
    if (fontsWatched || !document.fonts || !document.fonts.ready) return;
    fontsWatched = true;
    document.fonts.ready.then(function () {
      remeasureUserMenuItem();
      // A late webfont changes the compact menu labels too.
      if (CONFIG.textOnlyPinnedMenu) applyPinnedMenu();
    })['catch'](function () { /* no font API guarantees */ });
  }

  // The top-right dropdown is the one place that exists on both versions, so it
  // is the reliable way in. 11.07 builds it as li.userSettings > ul > li holding
  // Personal Settings, Logout and more. 13.50 builds it as a flat .system-menu
  // holding only Logout. Cloning the logout entry rather than building one means
  // the new item inherits whichever of those two shapes the page actually uses.
  function installUserMenuItem() {
    if (document.querySelector('[data-streamliner-usermenu]')) return;

    // Our own clone keeps the logout classes, so skip anything inside it.
    var logout = null;
    var candidates = document.querySelectorAll('a.logout, a[href="#logout"]');
    for (var c = 0; c < candidates.length; c++) {
      if (candidates[c].closest('[data-streamliner-usermenu]')) continue;
      logout = candidates[c];
      break;
    }
    if (!logout || !logout.parentElement) return;

    var source = logout.parentElement.tagName === 'LI' ? logout.parentElement : logout;
    var node = source.cloneNode(true);
    node.setAttribute('data-streamliner-usermenu', 'true');
    node.setAttribute('data-cm-helper', 'true');

    var a = node.tagName === 'A' ? node : node.querySelector('a');
    if (!a) return;

    // The cloned logout icon would be misleading, but removing it pulls the
    // label left of where Logout's label sits. Hiding it keeps the box, so the
    // two labels line up the way menu entries should.
    var icons = a.querySelectorAll('svg, img');
    for (var i = 0; i < icons.length; i++) icons[i].style.visibility = 'hidden';

    a.setAttribute('href', '#');
    a.setAttribute('title', SETTINGS_LABEL);
    a.setAttribute('aria-label', SETTINGS_LABEL);
    a.removeAttribute('data-test');
    // Keep the logout classes. On 13.50 the dropdown is shown by toggling a
    // class on .system-menu, and the rules that hide the entry until it opens
    // are written against .logout. Stripping the class left the new item
    // permanently visible in the header bar instead of inside the dropdown.
    // Nothing is inherited behaviourally: cloneNode does not copy listeners,
    // the href is neutralised, and the capture-phase handler below stops the
    // event before any delegated logout handler can see it.

    var span = a.querySelector('span');
    if (span) span.textContent = SETTINGS_LABEL;
    else a.textContent = SETTINGS_LABEL;

    a.addEventListener('click', function (e) {
      e.preventDefault();
      // The clone keeps the logout classes, so the event must not reach the
      // app's own handlers. That also stops whatever would close the menu, so
      // close it here: 13.x holds the dropdown open with a class, and 11.x and
      // 12.00 open theirs on hover, where blurring is enough.
      e.stopPropagation();
      for (var n = a; n && n !== document.body; n = n.parentElement) {
        if (n.classList && n.classList.contains('open')) n.classList.remove('open');
      }
      if (a.blur) a.blur();
      openSettings();
    }, true);

    source.parentNode.insertBefore(node, source);
    positionUserMenuItem(node, logout);

    // Opening the dropdown is the last moment before anyone sees it, so take
    // the measurement again there. This is what recovers the width if the
    // fonts, the zoom or the label changed after the entry was built.
    if (source.parentNode) {
      source.parentNode.addEventListener('click', function () {
        nativeSetTimeout(remeasureUserMenuItem, 0);
      }, true);
    }

    log('settings item added to the user menu');
  }

  // ------------------------------------------------------- settings panel

  var panel = null;

  var FIELD_NOTES = {
    speedFactor: 'Higher is faster. 1 turns animation scaling off.',
    scaleTimeouts: 'Also speeds up dialogs and menus on 13.x. Affects app timers, so try it before leaving it on.',
    fixSignIn: 'Only 11.x needs it. 13.x ships the button enabled.',
    pinnedMenuWidth: 'Wider menus take width from the page content.',
    searchHotkey: 'A key on its own, or with modifiers: "/", "cmd+k", "ctrl+k", "alt+s".',
    darkMode: 'Applies as soon as you save.',
    showHostBadge: 'Adds the host badge to the login page.',
    hostInTitle: 'Puts the host in the tab title, in front of the page name.',
    darkModeInvertLogos: 'Keeps logos legible on a dark page. A saturated mark comes back lighter.'
  };

  var RELOAD_KEYS = ['scaleJquery', 'scaleWebAnimations', 'scaleTimeouts'];

  // The panel is grouped by feature. Each group has a master switch on its
  // header row, a line saying what the feature does, and an Advanced expander
  // holding the detail. searchHotkey is the one setting worth seeing without
  // opening anything, because it is the one people actually change.
  //
  // Speedup has no boolean of its own, so its master is speedFactor: 1 means
  // off. Turning it back on restores the shipped factor.
  var SETTING_GROUPS = [
    {
      title: 'Dark Mode',
      master: 'darkMode',
      blurb: 'Repaints Content Manager in dark colours. Surfaces are darkened and text ' +
             'lightened; photographs are left alone.',
      advanced: ['darkModeInvertLogos']
    },
    {
      title: 'Speedup',
      master: 'speedFactor',
      masterKind: 'factor',
      blurb: 'Runs the interface animations faster. Almost every one is a jQuery animation ' +
             'on 11.x and a CSS transition on 13.x.',
      advanced: ['speedFactor', 'scaleJquery', 'scaleCss', 'scaleWebAnimations',
                 'scaleTimeouts', 'timeoutCeilingMs']
    },
    {
      title: 'Pinning Text Only Menus',
      master: 'textOnlyPinnedMenu',
      blurb: 'Shows labels instead of icons in the docked side menus, so entries can be ' +
             'read without hovering.',
      advanced: ['pinnedMenuWidth', 'pinnedHoverColor', 'labelOverrides']
    },
    {
      title: 'Focus Search',
      master: 'focusSearch',
      blurb: 'Adds a keyboard shortcut that jumps to the search box, and says so in the ' +
             'box\'s placeholder.',
      always: ['searchHotkey'],
      advanced: []
    },
    {
      title: 'Host Badge',
      // No single boolean owns this one, so the master is both sub-options at
      // once: off turns both off, on restores both.
      masterKind: 'any',
      masterKeys: ['showHostBadge', 'hostInTitle'],
      blurb: 'Names the server, so two tabs open on different Content Managers cannot be ' +
             'confused. On the login page, and in the tab title.',
      advanced: ['showHostBadge', 'hostInTitle', 'hostBadgeSize']
    },
    {
      title: 'Login Button enablement',
      master: 'fixSignIn',
      blurb: 'Lets a password manager fill and submit the login form: clears the readonly ' +
             'the server may set, and tells the app the fields changed.',
      advanced: []
    },
    {
      title: 'Debug',
      master: 'debug',
      blurb: 'Logs what the extension patched to the console, prefixed with [streamliner].',
      advanced: []
    }
  ];

  function overridesToText(obj) {
    var lines = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) lines.push(k + ' = ' + obj[k]);
    }
    return lines.join('\n');
  }

  function textToOverrides(text) {
    var out = {};
    String(text).split('\n').forEach(function (line) {
      var i = line.indexOf('=');
      if (i < 1) return;
      var k = line.slice(0, i).trim();
      var v = line.slice(i + 1).trim();
      if (k && v) out[k] = v;
    });
    return out;
  }

  function closeSettings() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  function openSettings() {
    if (panel) return;
    if (!document.body) return;

    panel = document.createElement('div');
    panel.setAttribute('data-cm-helper', 'true');
    // The panel carries a data-cm-helper marker, which is exactly what stops the
    // dark sheet recolouring it. So it has to pick its own palette.
    var skin = darkOn
      ? { card: '#1f2124', text: '#e8e8e8', muted: '#9a9a9a', line: '#34373b',
          field: '#141517', fieldLine: '#4a4d52', button: '#2a2d31', buttonLine: '#4a4d52' }
      : { card: '#ffffff', text: '#1a1a1a', muted: '#666666', line: '#e3e3e3',
          field: '#ffffff', fieldLine: '#cccccc', button: '#f5f5f5', buttonLine: '#cccccc' };

    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.55);' +
      'display:flex;align-items:center;justify-content:center;color:' + skin.text + ';' +
      'font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';

    var card = document.createElement('div');
    card.setAttribute('data-cm-helper', 'true');
    card.style.cssText = 'background:' + skin.card + ';color:' + skin.text + ';border-radius:8px;' +
      'width:min(560px,92vw);max-height:86vh;overflow:auto;' +
      'box-shadow:0 12px 48px rgba(0,0,0,.5);padding:0;';

    var head = document.createElement('div');
    head.style.cssText = 'padding:16px 20px;border-bottom:1px solid ' + skin.line + ';' +
      'position:sticky;top:0;background:' + skin.card + ';';
    var title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:650';
    title.textContent = 'Streamliner Settings';
    head.appendChild(title);

    var version = document.createElement('div');
    version.style.cssText = 'color:' + skin.muted + ';font-size:12px;margin-top:2px';
    version.textContent = 'Version ' + VERSION;
    head.appendChild(version);

    // textContent, not innerHTML: the host comes from the address bar.
    var scope = document.createElement('div');
    scope.style.cssText = 'color:' + skin.muted + ';font-size:12px';
    scope.textContent = '(Settings apply to ' + window.location.host + ' only)';
    head.appendChild(scope);
    card.appendChild(head);

    var body = document.createElement('div');
    body.style.cssText = 'padding:8px 20px 4px';
    card.appendChild(body);

    var inputs = {};

    var overridesField = null;
    var masters = [];

    function row(key, control, note, container) {
      var wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;gap:12px;align-items:flex-start;padding:8px 0;' +
        'border-bottom:1px solid ' + skin.line + ';';
      var left = document.createElement('div');
      left.style.cssText = 'flex:1;min-width:0';
      left.innerHTML = '<div style="font-weight:550">' + key + '</div>' +
        (note ? '<div style="color:' + skin.muted + ';font-size:12px;margin-top:1px">' + note + '</div>' : '');
      wrap.appendChild(left);
      var right = document.createElement('div');
      right.style.cssText = 'flex:0 0 auto;padding-top:1px';
      right.appendChild(control);
      wrap.appendChild(right);
      container.appendChild(wrap);
    }

    function field(key, container) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
      var note = FIELD_NOTES[key] || '';
      if (RELOAD_KEYS.indexOf(key) !== -1) note += (note ? ' ' : '') + 'Needs a reload.';

      if (key === 'labelOverrides') {
        var label = document.createElement('div');
        label.style.cssText = 'padding:8px 0 0;font-weight:550';
        label.innerHTML = 'labelOverrides<div style="font-weight:400;color:#666;font-size:12px;' +
          'margin-top:1px">One per line, <code>Full label = Short label</code></div>';
        container.appendChild(label);

        overridesField = document.createElement('textarea');
        overridesField.value = overridesToText(CONFIG.labelOverrides || {});
        overridesField.rows = 6;
        overridesField.style.cssText = 'width:100%;box-sizing:border-box;margin:6px 0 4px;padding:8px;' +
          'border:1px solid ' + skin.fieldLine + ';border-radius:4px;background:' + skin.field +
          ';color:' + skin.text + ';font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace';
        container.appendChild(overridesField);
        return;
      }

      var val = CONFIG[key];
      var el = document.createElement('input');
      if (typeof val === 'boolean') {
        el.type = 'checkbox';
        el.checked = val;
        el.style.cssText = 'width:16px;height:16px';
      } else if (typeof val === 'number') {
        el.type = 'number';
        el.value = val;
        el.step = 'any';
        el.style.cssText = 'width:88px;padding:3px 6px;border:1px solid ' + skin.fieldLine +
          ';border-radius:4px;font:inherit;background:' + skin.field + ';color:' + skin.text;
      } else {
        el.type = 'text';
        el.value = val;
        el.style.cssText = 'width:150px;padding:3px 6px;border:1px solid ' + skin.fieldLine +
          ';border-radius:4px;font:inherit;background:' + skin.field + ';color:' + skin.text;
      }
      inputs[key] = el;
      row(key, el, note, container);
    }

    var placed = {};

    SETTING_GROUPS.forEach(function (group) {
      // header row: the feature's name, and the switch that turns it off
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:12px;margin:20px 0 0;' +
        'padding-bottom:6px;border-bottom:1px solid ' + skin.line + ';';

      var heading = document.createElement('div');
      heading.textContent = group.title;
      heading.style.cssText = 'flex:1;font-size:12px;font-weight:700;letter-spacing:.05em;' +
        'text-transform:uppercase;color:' + skin.muted + ';';
      header.appendChild(heading);

      var master = document.createElement('input');
      master.type = 'checkbox';
      master.style.cssText = 'width:16px;height:16px;margin:0;flex:0 0 auto';
      if (group.masterKind === 'factor') {
        master.checked = Number(CONFIG[group.master]) > 1;
      } else if (group.masterKind === 'any') {
        master.checked = group.masterKeys.some(function (key) { return !!CONFIG[key]; });
      } else {
        master.checked = !!CONFIG[group.master];
      }
      header.appendChild(master);
      masters.push({ group: group, input: master });
      if (group.master) placed[group.master] = true;
      body.appendChild(header);

      var blurb = document.createElement('div');
      blurb.textContent = group.blurb;
      blurb.style.cssText = 'color:' + skin.muted + ';font-size:12px;line-height:1.45;margin:7px 0 2px';
      body.appendChild(blurb);

      (group.always || []).forEach(function (key) {
        placed[key] = true;
        field(key, body);
      });

      var advanced = (group.advanced || []).filter(function (key) {
        return Object.prototype.hasOwnProperty.call(DEFAULTS, key);
      });
      if (!advanced.length) return;

      var details = document.createElement('details');
      details.style.cssText = 'margin:2px 0 0';
      var summary = document.createElement('summary');
      summary.textContent = 'Advanced';
      summary.style.cssText = 'cursor:pointer;font-size:12px;color:#1a6cff;padding:6px 0;' +
        '-webkit-user-select:none;user-select:none';
      details.appendChild(summary);
      var inner = document.createElement('div');
      details.appendChild(inner);
      body.appendChild(details);

      advanced.forEach(function (key) {
        placed[key] = true;
        field(key, inner);
      });
    });

    // Anything not placed still renders, so a new setting cannot go missing.
    var leftovers = Object.keys(DEFAULTS).filter(function (key) { return !placed[key]; });
    if (leftovers.length) {
      var otherHead = document.createElement('div');
      otherHead.textContent = 'Other';
      otherHead.style.cssText = 'margin:20px 0 0;padding-bottom:6px;border-bottom:1px solid ' +
        skin.line + ';font-size:12px;font-weight:700;letter-spacing:.05em;' +
        'text-transform:uppercase;color:' + skin.muted + ';';
      body.appendChild(otherHead);
      leftovers.forEach(function (key) { field(key, body); });
    }

    var foot = document.createElement('div');
    foot.style.cssText = 'padding:14px 20px;border-top:1px solid ' + skin.line + ';display:flex;' +
      'gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:' + skin.card + ';';

    function button(text, primary) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = 'padding:7px 14px;border-radius:5px;font:inherit;cursor:pointer;' +
        (primary ? 'background:#1a6cff;color:#fff;border:1px solid #1a6cff;'
                 : 'background:' + skin.button + ';color:' + skin.text +
                   ';border:1px solid ' + skin.buttonLine + ';');
      return b;
    }

    var reset = button('Reset to defaults');
    var cancel = button('Cancel');
    var save = button('Save', true);

    reset.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { CONFIG[k] = DEFAULTS[k]; });
      if (CONFIG.darkMode !== darkOn) setDark(CONFIG.darkMode);
      saveConfig();
      closeSettings();
      applyAll();
      openSettings();
    });
    cancel.addEventListener('click', closeSettings);
    save.addEventListener('click', function () {
      Object.keys(inputs).forEach(function (key) {
        var el = inputs[key];
        if (el.type === 'checkbox') CONFIG[key] = el.checked;
        else if (el.type === 'number') {
          var n = parseFloat(el.value);
          if (isFinite(n)) CONFIG[key] = n;
        } else CONFIG[key] = el.value;
      });
      // Masters win over the advanced field they govern, so switching a feature
      // off cannot be undone by a stale number left in the expander.
      masters.forEach(function (entry) {
        if (entry.group.masterKind === 'factor') {
          if (!entry.input.checked) CONFIG[entry.group.master] = 1;
          else if (Number(CONFIG[entry.group.master]) <= 1) {
            CONFIG[entry.group.master] = DEFAULTS[entry.group.master];
          }
        } else if (entry.group.masterKind === 'any') {
          var on = entry.input.checked;
          var anySet = entry.group.masterKeys.some(function (key) { return !!CONFIG[key]; });
          entry.group.masterKeys.forEach(function (key) {
            if (!on) CONFIG[key] = false;
            else if (!anySet) CONFIG[key] = DEFAULTS[key];
          });
        } else {
          CONFIG[entry.group.master] = entry.input.checked;
        }
      });
      if (overridesField) CONFIG.labelOverrides = textToOverrides(overridesField.value);
      if (CONFIG.darkMode !== darkOn) setDark(CONFIG.darkMode);
      saveConfig();
      closeSettings();
      applyAll();
    });

    foot.appendChild(reset);
    foot.appendChild(cancel);
    foot.appendChild(save);
    card.appendChild(foot);
    panel.appendChild(card);

    panel.addEventListener('click', function (e) { if (e.target === panel) closeSettings(); });
    document.body.appendChild(panel);
  }

  // Re-applies everything that can change without a reload.
  function applyAll() {
    if (styleEl) styleEl.textContent = '';
    applyCssScaling();
    if (pinnedEl && pinnedEl.parentNode) pinnedEl.parentNode.removeChild(pinnedEl);
    pinnedEl = null;
    // Drop the marker class so labels are recomputed from scratch.
    var items = document.querySelectorAll(PINNED_ITEM);
    for (var i = 0; i < items.length; i++) items[i].classList.remove('cm-helper-has-label');
    // Let the placeholder hint pick up a changed hotkey.
    var box = document.querySelector('[data-cm-placeholder]');
    if (box) {
      box.setAttribute('placeholder', box.getAttribute('data-cm-placeholder'));
      box.removeAttribute('data-cm-placeholder');
    }
    darkBuiltAt = -1;
    sweep();
    remeasureUserMenuItem();
  }

  // -------------------------------------------------------------- hotkeys

  function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  // "/" on its own, or a combination such as "cmd+k", "ctrl+k", "alt+s".
  function parseHotkey(spec) {
    var parts = String(spec || '').split('+');
    var out = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
    for (var i = 0; i < parts.length; i++) {
      var token = parts[i].trim().toLowerCase();
      if (!token) continue;
      if (token === 'ctrl' || token === 'control') out.ctrl = true;
      else if (token === 'alt' || token === 'option' || token === 'opt') out.alt = true;
      else if (token === 'shift') out.shift = true;
      else if (token === 'cmd' || token === 'command' || token === 'meta' || token === 'win') out.meta = true;
      else out.key = token;
    }
    return out.key ? out : null;
  }

  function hasModifier(hotkey) {
    return !!(hotkey && (hotkey.ctrl || hotkey.alt || hotkey.meta));
  }

  function matchesHotkey(e, hotkey) {
    if (!hotkey) return false;
    if (!!e.ctrlKey !== hotkey.ctrl) return false;
    if (!!e.altKey !== hotkey.alt) return false;
    if (!!e.metaKey !== hotkey.meta) return false;
    // Shift is only enforced when asked for. Plenty of keys, "/" and "?" among
    // them, need shift on some layouts and not on others.
    if (hotkey.shift && !e.shiftKey) return false;
    return (e.key || '').toLowerCase() === hotkey.key;
  }

  function isMac() {
    return /Mac|iPhone|iPad|iPod/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
  }

  // "/" stays "/". "cmd+k" reads as the Mac glyphs, "ctrl+k" as Ctrl+K.
  function hotkeyLabel(spec) {
    var hotkey = parseHotkey(spec);
    if (!hotkey) return '';
    var mac = isMac();
    var parts = [];
    if (hotkey.ctrl) parts.push(mac ? '\u2303' : 'Ctrl');
    if (hotkey.alt) parts.push(mac ? '\u2325' : 'Alt');
    if (hotkey.shift) parts.push(mac ? '\u21e7' : 'Shift');
    if (hotkey.meta) parts.push(mac ? '\u2318' : 'Win');
    parts.push(hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
    return mac ? parts.join('') : parts.join('+');
  }

  // The box the hotkey would reach: the first visible, usable one.
  function searchTarget() {
    var list = document.querySelectorAll(SEARCH_SELECTOR);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!isVisible(el) || el.disabled || el.readOnly) continue;
      return el;
    }
    return null;
  }

  function focusSearch() {
    var el = searchTarget();
    if (!el) return false;
    el.focus();
    try {
      el.select();
    } catch (e) { /* not selectable */ }
    log('focused search box');
    return true;
  }

  // Advertise the shortcut in the box itself, so it can be discovered.
  function decorateSearchBox() {
    if (!CONFIG.focusSearch) return;
    var label = hotkeyLabel(CONFIG.searchHotkey);
    if (!label) return;
    var el = searchTarget();
    if (!el) return;
    var base = el.getAttribute('data-cm-placeholder');
    if (base === null) {
      base = el.getAttribute('placeholder') || 'Search';
      el.setAttribute('data-cm-placeholder', base);
    }
    var wanted = base + ' (' + label + ' to focus)';
    if (el.getAttribute('placeholder') !== wanted) el.setAttribute('placeholder', wanted);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && panel) {
      closeSettings();
      return;
    }
    if (e.defaultPrevented || panel) return;
    if (!CONFIG.focusSearch || !CONFIG.searchHotkey) return;

    var hotkey = parseHotkey(CONFIG.searchHotkey);
    if (!matchesHotkey(e, hotkey)) return;
    // A bare key must not steal what you are typing. A combination may.
    if (!hasModifier(hotkey) && isTypingTarget(e.target)) return;
    if (focusSearch()) e.preventDefault();
  }

  // ------------------------------------------------------------------ wire

  var sweepQueued = false;

  function sweep() {
    sweepQueued = false;
    if (CONFIG.scaleCss) applyCssScaling();
    applyPinnedMenu();
    installUserMenuItem();
    watchFonts();
    decorateSearchBox();
    refreshDark();
    var present = !!document.querySelector(SIGNIN_BUTTON);
    if (CONFIG.fixSignIn) updateSignInWatch(present);
    watchTitle();
    applyHostTitle();
    updateHostBadge(present);
  }

  function queueSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    nativeSetTimeout(sweep, 100);
  }

  function observe() {
    var root = document.documentElement;
    if (!root) {
      nativeSetTimeout(observe, 0);
      return;
    }
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var k = 0; k < added.length; k++) {
          // Ignore the helper's own nodes so the sweep cannot re-trigger itself.
          var n = added[k];
          if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-cm-helper')) continue;
          queueSweep();
          return;
        }
        if (records[i].removedNodes.length) {
          queueSweep();
          return;
        }
      }
    }).observe(root, { childList: true, subtree: true });
  }

  loadConfig();

  if (CONFIG.scaleJquery) {
    trapGlobal('jQuery', patchJquery);
    trapGlobal('$', patchJquery);
  }
  if (CONFIG.scaleWebAnimations) patchWebAnimations();
  if (CONFIG.scaleTimeouts) patchTimeouts();

  if (CONFIG.fixSignIn) {
    document.addEventListener('input', onValueEvent, true);
    document.addEventListener('change', onValueEvent, true);
  }
  document.addEventListener('keydown', onKeyDown, true);

  darkOn = !!CONFIG.darkMode;

  observe();
  document.addEventListener('DOMContentLoaded', function () {
    if (darkOn) setDark(true, false);
    sweep();
  });
  window.addEventListener('load', sweep);
  // The @import'ed sheet is not always parsed by DOMContentLoaded.
  [300, 1000, 3000].forEach(function (ms) {
    nativeSetTimeout(sweep, ms);
  });

  // Diagnostics. In the page console: copy(streamliner.dumpMenus())
  window.streamliner = window.cmHelper = {
    version: VERSION,
    config: CONFIG,
    openSettings: openSettings,
    save: saveConfig,
    // Re-applies everything that does not need a reload. The settings panel
    // calls this on save; it is exposed for changing config from the console.
    refresh: applyAll,
    setDark: setDark,
    isDark: function () { return darkOn; },
    // In the page console on a screen that still looks wrong:
    //   copy(streamliner.auditDark())
    auditDark: function () {
      var out = ['streamliner ' + VERSION + ' dark audit on ' + location.host + location.hash];
      out.push('dark on: ' + darkOn + ', override sheet: ' +
               (darkEl ? darkEl.textContent.length + ' chars, disabled=' + darkEl.disabled : 'none'));
      out.push('stylesheets: ' + document.styleSheets.length + ', built at count ' + darkBuiltAt);

      function toRgb(v) {
        var m = /rgba?\(([^)]+)\)/.exec(v || '');
        if (!m) return null;
        var p = m[1].split(/[\s,\/]+/).map(parseFloat);
        return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
      }
      function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
      function describe(el) {
        var bits = el.tagName.toLowerCase();
        if (el.id) bits += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          bits += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
        }
        return bits;
      }

      var surfaces = [], texts = [], images = [];
      var all = document.querySelectorAll('body *');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.closest('[data-cm-helper]')) continue;
        var cs = window.getComputedStyle(el);
        var box = el.getBoundingClientRect();

        var bg = toRgb(cs.backgroundColor);
        if (box.width * box.height > 1500 && bg && bg[3] > 0.5 && lum(bg) > 0.45) {
          surfaces.push({
            area: Math.round(box.width * box.height),
            what: describe(el),
            bg: cs.backgroundColor,
            inline: /background/.test(el.getAttribute('style') || '') ? ' INLINE' : '',
            image: cs.backgroundImage && cs.backgroundImage !== 'none' ? ' +bg-image' : ''
          });
        }
        if (!el.children.length && el.textContent && el.textContent.trim() && box.width > 12) {
          var fc = toRgb(cs.color);
          if (fc && lum(fc) < 0.42) {
            texts.push({ what: describe(el), col: cs.color,
              inline: /(^|;)\s*color\s*:/.test(el.getAttribute('style') || '') ? ' INLINE' : '' });
          }
        }
        if (cs.backgroundImage && cs.backgroundImage.indexOf('url(') !== -1 &&
            box.width * box.height > 200 && images.length < 12) {
          images.push(describe(el) + '  ' +
            (cs.backgroundImage.match(/url\(["\']?([^"\')]+)/) || [, ''])[1].split('/').pop().slice(0, 40));
        }
      }
      surfaces.sort(function (a, b) { return b.area - a.area; });

      out.push('--- surfaces still light: ' + surfaces.length + ' ---');
      surfaces.slice(0, 15).forEach(function (o) {
        out.push('  ' + o.what + '  area=' + o.area + '  bg=' + o.bg + o.inline + o.image);
      });
      out.push('--- dark text remaining: ' + texts.length + ' ---');
      texts.slice(0, 15).forEach(function (o) { out.push('  ' + o.what + '  color=' + o.col + o.inline); });
      out.push('--- background images on screen: ' + images.length + ' ---');
      images.forEach(function (x) { out.push('  ' + x); });

      // A threshold only says pass or fail. Printing the real palette shows
      // what the page is actually painted with, which is the useful thing when
      // the two disagree.
      var biggest = [];
      for (var b = 0; b < all.length; b++) {
        var e2 = all[b];
        if (e2.closest('[data-cm-helper]')) continue;
        var r2 = e2.getBoundingClientRect();
        if (r2.width * r2.height < 4000) continue;
        var c2 = window.getComputedStyle(e2);
        var bg2 = toRgb(c2.backgroundColor);
        biggest.push({
          area: Math.round(r2.width * r2.height),
          what: describe(e2),
          bg: bg2 && bg2[3] > 0.02 ? c2.backgroundColor + ' L=' + lum(bg2).toFixed(2) : 'transparent',
          fg: c2.color
        });
      }
      biggest.sort(function (a, b2) { return b2.area - a.area; });
      out.push('--- largest elements and what they are painted ---');
      biggest.slice(0, 14).forEach(function (o) {
        out.push('  ' + o.what + '  area=' + o.area + '  bg=' + o.bg + '  fg=' + o.fg);
      });

      // Pseudo-elements and shadows are painted without an element of their
      // own, so the scan above cannot see them.
      var pseudo = 0, shadows = 0;
      for (var q = 0; q < all.length && q < 4000; q++) {
        var e3 = all[q];
        if (e3.closest('[data-cm-helper]')) continue;
        ['::before', '::after'].forEach(function (which) {
          var pc = window.getComputedStyle(e3, which);
          if (!pc || pc.content === 'none') return;
          var pbg = toRgb(pc.backgroundColor);
          if (pbg && pbg[3] > 0.5 && lum(pbg) > 0.45) {
            pseudo++;
            if (pseudo <= 6) out.push('  LIGHT ' + which + ' on ' + describe(e3) + ' bg=' + pc.backgroundColor);
          }
        });
        var sh = window.getComputedStyle(e3).boxShadow;
        if (sh && sh !== 'none') {
          var scol = toRgb(sh);
          if (scol && lum(scol) > 0.5) shadows++;
        }
      }
      out.push('--- light pseudo-element backgrounds: ' + pseudo + ' ---');
      out.push('--- light box-shadows: ' + shadows + ' ---');

      // A gradient reports background-color 'transparent', so the scan above
      // calls it dark. This is what hid the white panels twice.
      var lightGradients = [];
      for (var g = 0; g < all.length; g++) {
        var eg = all[g];
        if (eg.closest('[data-cm-helper]')) continue;
        var rg2 = eg.getBoundingClientRect();
        if (rg2.width * rg2.height < 1500) continue;
        var bi = window.getComputedStyle(eg).backgroundImage;
        if (!bi || !/gradient/i.test(bi)) continue;
        var stops = (bi.match(/rgba?\([^)]*\)/g) || []).map(function (t) {
          var c = toRgb(t);
          return c ? lum(c) : 0;
        });
        if (stops.length && Math.max.apply(null, stops) > 0.45) {
          lightGradients.push(describe(eg) + '  area=' + Math.round(rg2.width * rg2.height) +
            '  ' + bi.slice(0, 70));
        }
      }
      out.push('--- gradients still holding a light stop: ' + lightGradients.length + ' ---');
      lightGradients.slice(0, 10).forEach(function (x) { out.push('  ' + x); });

      // Content images are deliberately never recoloured. On a media list full
      // of white artwork that alone can read as "lots of white", so say how
      // much of the screen they cover rather than leaving it a mystery.
      var lightImages = 0, lightImageArea = 0, sampled = 0;
      var canvas = null, ctx = null;
      try {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        ctx = canvas.getContext('2d');
      } catch (e) { ctx = null; }
      var pics = document.querySelectorAll('img');
      for (var q2 = 0; q2 < pics.length && ctx; q2++) {
        var pic = pics[q2];
        if (pic.closest('[data-cm-helper]')) continue;
        var pr = pic.getBoundingClientRect();
        if (pr.width * pr.height < 400 || !pic.complete || !pic.naturalWidth) continue;
        try {
          ctx.clearRect(0, 0, 1, 1);
          ctx.drawImage(pic, 0, 0, 1, 1);
          var px = ctx.getImageData(0, 0, 1, 1).data;
          sampled++;
          if ((0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255 > 0.6) {
            lightImages++;
            lightImageArea += pr.width * pr.height;
          }
        } catch (e) { /* cross-origin, cannot sample */ }
      }
      out.push('--- content images: ' + sampled + ' sampled, ' + lightImages +
               ' are light, covering ' + Math.round(lightImageArea) + 'px2 ---');
      return out.join('\n');
    },

    // Arms a one-shot click. Click the part that looks wrong and it reports
    // exactly what paints there, all the way up the tree. Use this when the
    // audit says everything is fine but the screen disagrees.
    //   streamliner.probe()
    probe: function () {
      function tidy(v) {
        return String(v || '').replace(/url\([^)]*\)/g, 'url(IMG)').slice(0, 70);
      }
      function name(el) {
        if (el === document.documentElement) return 'html';
        if (el === document.body) return 'body';
        var bits = el.tagName.toLowerCase();
        if (el.id) bits += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          bits += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
        }
        return bits;
      }
      function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('click', onClick, true);

        var lines = ['streamliner ' + VERSION + ' probe at ' +
                     Math.round(e.clientX) + ',' + Math.round(e.clientY) +
                     ' on ' + window.location.host + window.location.hash];
        var el = document.elementFromPoint(e.clientX, e.clientY);
        for (var i = 0; i < 9 && el; i++, el = el.parentElement) {
          var cs = window.getComputedStyle(el);
          var bits = name(el) + '  bg=' + cs.backgroundColor;
          if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            bits += '  img=' + tidy(cs.backgroundImage);
          }
          if (cs.boxShadow && cs.boxShadow !== 'none') bits += '  shadow=' + tidy(cs.boxShadow);
          if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
            bits += '  outline=' + cs.outlineWidth + ' ' + cs.outlineColor;
          }
          if (parseFloat(cs.borderTopWidth) > 0) bits += '  bTop=' + cs.borderTopColor;
          if (parseFloat(cs.borderLeftWidth) > 0) bits += '  bLeft=' + cs.borderLeftColor;
          if (cs.opacity !== '1') bits += '  opacity=' + cs.opacity;
          if (cs.filter && cs.filter !== 'none') bits += '  filter=' + tidy(cs.filter);
          lines.push('  ' + bits);
        }
        var text = lines.join('\n');
        console.log(text);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        } catch (err) { /* clipboard needs focus */ }
      }
      document.addEventListener('click', onClick, true);
      return 'Click the part that looks wrong. That click is swallowed, and the ' +
             'report goes to the console and, if the page has focus, the clipboard.';
    },

    dumpMenus: function () {
      var out = [];
      var roots = document.querySelectorAll(
        '.leftPinnedMenu, .rightPinnedMenu, .navbar-sidebar-menu, [class*="PinnedMenu"]');
      out.push('streamliner ' + VERSION + ' on ' + location.host + location.pathname);
      out.push('menu roots found: ' + roots.length);
      for (var i = 0; i < roots.length && i < 4; i++) {
        var r = roots[i];
        out.push('--- root ' + i + ': ' + r.className + ' (' +
                 Math.round(r.getBoundingClientRect().width) + 'px wide) ---');
        out.push(r.outerHTML.slice(0, 4000));
      }
      var items = document.querySelectorAll(PINNED_ITEM);
      out.push('--- ' + items.length + ' menu items matched by "' + PINNED_ITEM + '" ---');
      for (var k = 0; k < items.length && k < 12; k++) {
        var a = items[k];
        var lbl = a.querySelector('.nav-label, .cm-helper-label, span');
        out.push(k + ': href=' + a.getAttribute('href') +
                 ' title=' + JSON.stringify(a.getAttribute('title')) +
                 ' aria=' + JSON.stringify(a.getAttribute('aria-label')) +
                 ' labelled=' + a.classList.contains('cm-helper-has-label') +
                 ' text=' + JSON.stringify(lbl ? lbl.textContent.trim() : null));
      }
      return out.join('\n');
    }
  };

  log('loaded, speedFactor ' + CONFIG.speedFactor);
})();
