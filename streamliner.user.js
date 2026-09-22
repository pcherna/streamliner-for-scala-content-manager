// ==UserScript==
// @name         Streamliner for Scala Content Manager
// @namespace    https://github.com/pcherna/streamliner-for-scala-content-manager
// @version      1.41.0
// @description  Conveniences and fixes for Scala Content Manager: dark mode, speedup, text-only menus, search hotkey, host badge, login fix.
// @match        *://*/ContentManager/*
// @match        *://*/ContentManager
// @run-at       document-start
// @noframes
// @grant        none
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/pcherna/streamliner-for-scala-content-manager
// @supportURL   https://github.com/pcherna/streamliner-for-scala-content-manager/issues
// @downloadURL  https://raw.githubusercontent.com/pcherna/streamliner-for-scala-content-manager/main/streamliner.user.js
// @updateURL    https://raw.githubusercontent.com/pcherna/streamliner-for-scala-content-manager/main/streamliner.user.js
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
    // The app only enables Sign In from a keyup, which a fill does not produce.
    // The fields themselves are never touched: a server that renders them
    // readonly to block autofill (disableLoginAutocomplete) keeps that choice.
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
    // Shows a long filter list in full, in a box that scrolls.
    scrollListFilters: true,
    listFilterHeight: '220px',

    // Adds the "Used:" line the template list is missing. Costs one request
    // per list page, plus one per template that actually has messages.
    templateUsage: true,
    templateUsageConcurrency: 5,

    // Spells the Used: breakdown out in the row and links each part, instead of
    // going through Content Manager's dialog to reach the same links.
    bypassUsageDialog: true,

    // The Install File task's file picker: every file on one page, sorted
    // without regard to case, no warning icons, the file chooser opened by
    // Upload, and a fresh upload selected as soon as it appears.
    maintenanceFilesFixes: true,

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
  // Set once the settings have been shown unasked, so that happens only once.
  var WELCOME_KEY = 'streamlinerWelcomed';

  // Settings live in localStorage on the Content Manager origin. That works the
  // same in the extension and the userscript: the content script runs in the
  // MAIN world where chrome.storage does not exist, and the userscript uses
  // @grant none. The cost is that settings are per server, which is wanted here
  // because 11.x and 13.x need different ones.
  // A saved value has to be the same kind of thing as the default. A string
  // where a number belongs would otherwise stick: the panel renders a text box
  // for whatever type it finds, so every save after that keeps the string.
  function sameShape(value, model) {
    if (value === null || model === null) return value === model;
    if (Array.isArray(model)) return Array.isArray(value);
    if (typeof model === 'object') return typeof value === 'object' && !Array.isArray(value);
    if (typeof model === 'number') return typeof value === 'number' && isFinite(value);
    return typeof value === typeof model;
  }

  function loadConfig() {
    try {
      var raw = window.localStorage.getItem(CONFIG_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      for (var k in saved) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
        if (!sameShape(saved[k], DEFAULTS[k])) continue;
        CONFIG[k] = saved[k];
      }
    } catch (e) { /* private mode, or corrupt json */ }
  }

  // A CSS-valued setting is typed by hand and lands in a stylesheet. The
  // browser drops a value it cannot parse, but a stray brace ends the rule
  // early and takes the rest of the sheet with it. So a value the browser will
  // not accept for that property falls back to the shipped default.
  function cssValue(key, prop) {
    var value = String(CONFIG[key]);
    var ok = true;
    try {
      if (window.CSS && typeof window.CSS.supports === 'function') ok = window.CSS.supports(prop, value);
    } catch (e) {
      ok = false;
    }
    if (ok) return value;
    log('invalid ' + key + ' "' + value + '", using the default');
    return String(DEFAULTS[key]);
  }

  // The defaults must never be handed out by reference. An in-place edit of a
  // copy that is really DEFAULTS.labelOverrides would change the defaults too,
  // and the save below would then see no difference and write nothing.
  function cloneValue(v) {
    return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
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

  var VERSION = '1.41.0';
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
      // Checked on every call, not once at install time. A patch cannot be
      // taken back out, so switching the feature off has to stop here.
      if (CONFIG.scaleJquery && opt && typeof opt.duration === 'number') {
        opt.duration = scale(opt.duration);
      }
      return opt;
    };

    var origDelay = $.fn.delay;
    if (typeof origDelay === 'function') {
      $.fn.delay = function (time, type) {
        var named = $.fx && $.fx.speeds ? $.fx.speeds[time] : undefined;
        var ms = typeof named === 'number' ? named : time;
        var wanted = CONFIG.scaleJquery && typeof ms === 'number' ? scale(ms) : ms;
        return origDelay.call(this, wanted, type);
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

  // One install point, so the traps can also go in later: that is what lets the
  // speed switches take effect without a reload.
  var jqueryTrapped = false;

  function installJqueryPatch() {
    if (jqueryTrapped) return;
    jqueryTrapped = true;
    trapGlobal('jQuery', patchJquery);
    trapGlobal('$', patchJquery);
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

  // Both walkers cost real time: light.css on 13.x is half a megabyte, and
  // walking it takes about 10ms. The sweep runs on every batch of DOM changes,
  // so the walk has to be skipped when nothing it reads has changed.
  //
  // A count of stylesheets is not enough on its own. Content Manager pulls its
  // stylesheet in with @import from an inline <style>, so document.styleSheets
  // holds one sheet from the first moment and still holds one sheet after the
  // real rules arrive. The fingerprint therefore counts rules, and looks inside
  // an @import to see whether it has resolved yet.
  function sheetSignature() {
    var sheets = document.styleSheets;
    if (!sheets) return '0';
    var bits = [];
    for (var i = 0; i < sheets.length; i++) {
      // The helper's own sheets are not input to anything, and counting them
      // made every sheet the helper added cost one more rebuild.
      var node = sheets[i].ownerNode;
      if (node && node.getAttribute && node.getAttribute('data-cm-helper')) continue;
      var rules = null;
      try {
        rules = sheets[i].cssRules;
      } catch (e) {
        rules = null; // cross-origin
      }
      if (!rules) {
        bits.push('x');
        continue;
      }
      var imported = 0;
      for (var k = 0; k < rules.length; k++) {
        if (rules[k].type !== CSSRule.IMPORT_RULE) continue;
        var sub = null;
        try {
          sub = rules[k].styleSheet ? rules[k].styleSheet.cssRules : null;
        } catch (e) {
          sub = null;
        }
        imported += sub ? sub.length : 0;
      }
      bits.push(imported ? rules.length + '+' + imported : rules.length);
    }
    return bits.length + ':' + bits.join(',');
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
  var cssBuiltAt = null;

  function applyCssScaling() {
    if (!CONFIG.scaleCss) return;
    var signature = sheetSignature();
    if (signature === cssBuiltAt) return;
    cssBuiltAt = signature;

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
      if (!CONFIG.scaleWebAnimations) {
        return orig.call(this, keyframes, options);
      }
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
      // Coerced the way the native call does it: "500" is 500ms, and anything
      // that is not a number is 0. Treating a string as 0 made it fire at once.
      var d = Number(delay);
      if (!isFinite(d)) d = 0;
      if (CONFIG.scaleTimeouts && d > 0 && d <= CONFIG.timeoutCeilingMs) d = scale(d);
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

    // updateFormStatus only reads keyCode to short-circuit on Enter, so a
    // synthetic event with no keyCode takes the safe branch.
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'a' }));
    log('dispatched keyup on', el.className || el.name || el.type, 'via', why);
  }

  function onValueEvent(e) {
    if (!CONFIG.fixSignIn) return;
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
    // An empty title gets the host alone, not the host and a dangling dot.
    document.title = current ? host + ' \u00b7 ' + current : host;
  }

  function removeHostTitle() {
    var host = window.location.host;
    var lead = host + ' \u00b7 ';
    var current = document.title || '';
    if (current.indexOf(lead) === 0) document.title = current.slice(lead.length);
    else if (current === host) document.title = '';
  }

  // Both directions, so turning the feature off does not leave the prefix
  // sitting there until the app happens to rewrite the title.
  function syncHostTitle() {
    if (CONFIG.hostInTitle) applyHostTitle();
    else removeHostTitle();
  }

  function watchTitle() {
    if (titleWatched) return;
    var node = document.querySelector('title');
    if (!node) return;
    titleWatched = true;
    new MutationObserver(function () {
      syncHostTitle();
    }).observe(node, { childList: true, characterData: true, subtree: true });
    syncHostTitle();
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
    badge.style.cssText = 'text-align:center;margin:14px 0 0;font-size:' + cssValue('hostBadgeSize', 'font-size') + ';';

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

  // The element that carries an item's label: the app's own .nav-label, ours
  // from an earlier pass, or a span with text in it. A span with no text is an
  // icon wrapper. Writing the label into one of those put the text where the
  // icon rules apply, and left it there on teardown.
  function labelElementFor(a) {
    var known = a.querySelector('.nav-label, .cm-helper-label');
    if (known) return known;
    var spans = a.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent.trim()) return spans[i];
    }
    return null;
  }

  function labelTextFor(a, index) {
    var existing = labelElementFor(a);
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
    if ((!pinnedEl || !pinnedEl.isConnected) && (document.head || document.documentElement)) {
      pinnedEl = makeStyle('cm-helper-pinned');
      pinnedEl.textContent = PINNED_TEXT_CSS
        .split('%W%').join(cssValue('pinnedMenuWidth', 'min-width'))
        .split('%H%').join(cssValue('pinnedHoverColor', 'background-color'));
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

  // Turning the feature off has to undo what it did. Dropping the sheet alone
  // left the injected label in the DOM with no rule to hide it, so a compact
  // menu showed the icon and a bare label at the same time. A shortened label
  // also has to get its full text back.
  function removePinnedMenu() {
    if (pinnedEl && pinnedEl.parentNode) pinnedEl.parentNode.removeChild(pinnedEl);
    pinnedEl = null;
    var items = document.querySelectorAll(PINNED_ITEM);
    for (var i = 0; i < items.length; i++) {
      var a = items[i];
      a.classList.remove('cm-helper-has-label');
      var mine = a.querySelector('.cm-helper-label');
      if (mine && mine.parentNode) mine.parentNode.removeChild(mine);
      var full = a.getAttribute('data-cm-full');
      if (!full) continue;
      var existing = labelElementFor(a);
      if (existing && existing.textContent.trim() !== full) existing.textContent = full;
      a.removeAttribute('data-cm-full');
    }
  }

  // ---------------------------------------------------------- list filters

  // 12.00 and earlier cap a filter list at ten choices. The view adds
  //   .choices.has-overflow .options { max-height: 165px; overflow-y: hidden }
  // and hangs the rest behind a Show More link that sets max-height to none.
  // That is a choice between a truncated list and a filter panel taller than
  // the screen. A fixed box that scrolls beats both, so the cap becomes a
  // scroll and the link goes.
  //
  // Only CSS is needed: every choice is already in the DOM, and the link only
  // ever toggled a class. 13.50 dropped the whole mechanism, so these selectors
  // match nothing there.
  // The app's own rule is !important at the same specificity, so whichever
  // sheet comes later in the document wins. That is not something to rely on:
  // this sheet is written when the first sweep runs, and a stylesheet the app
  // adds after that would beat it, leaving the list capped and unscrollable
  // exactly as before. The leading `html body` buys two extra ids' worth of
  // specificity, so the override wins wherever the sheet ends up sitting.
  var FILTER_CSS = [
    'html body .filters .inlineEdit .choices.has-overflow .options,',
    'html body .filters .inlineEdit .choices.show-overflow .options {',
    '  max-height: %H% !important; overflow-y: auto !important; }',
    'html body .filters .inlineEdit a.toggle-filter-list { display: none !important; }'
  ].join('\n');

  var filtersEl = null;

  function applyListFilters() {
    if (!CONFIG.scrollListFilters) return;
    // isConnected, not merely "we made one": a sheet that has been taken out of
    // the document still answers to the variable, and the feature would then be
    // silently off for the rest of the session.
    if (filtersEl && filtersEl.isConnected) return;
    if (!(document.head || document.documentElement)) return;
    filtersEl = makeStyle('cm-helper-filters');
    var height = cssValue('listFilterHeight', 'max-height');
    filtersEl.textContent = FILTER_CSS.split('%H%').join(height);
    log('list filters set to scroll at ' + height);
  }

  function removeListFilters() {
    if (filtersEl && filtersEl.parentNode) filtersEl.parentNode.removeChild(filtersEl);
    filtersEl = null;
  }

  // --------------------------------------------------------- template usage

  // Content Manager puts "Used: n times" on media list rows and nothing on the
  // template list, although the relationship exists and the filtered view the
  // link would point at already works.
  //
  // Two calls cover a page. templates/inuse returns every template that has
  // messages created from it, so one request settles used-or-not for every row
  // at once. Only the used rows then need a number, which is the resultCount of
  // a media search filtered to that template.
  //
  // The counts the API already carries look like the answer and are not.
  // usingMessagesCount is accepted by both templates/search and templates/inuse
  // and comes back 0 for every template on 11.07, 12.x and 13.50 alike,
  // including templates with dozens of messages. It is wrong, not empty.

  var USAGE_MARK = 'data-streamliner-usage';
  var USAGE_ROWS = 'ul.basic > li.columns.item';
  // Scoped to a row on purpose. A li.usage also sits in the filter sidebar on
  // every version, and a bare li.usage selector finds that one first.
  var USAGE_LIST = 'div.column.col3 > ul';
  var USAGE_TTL_MS = 60000;
  var USAGE_TIMEOUT_MS = 30000;
  // How many times a count request may fail before the row is given up on.
  var USAGE_RETRIES = 2;

  var usageCounts = {};       // template id -> number, or null while in flight
  var usageFailures = {};     // template id -> failed count requests so far
  var usageInuse = null;      // template id -> true
  var usageInuseAt = 0;
  var usageInuseWaiters = null;
  var usageQueue = [];
  var usageActive = 0;
  // Bumped on teardown, so a reply from a request started before the feature
  // was switched off cannot write into the caches it just cleared.
  var usageGeneration = 0;
  var usageDialog = null;

  // The match pattern puts the wildcard in the host position, so the path is
  // all that identifies the app. Read it rather than assuming /ContentManager/
  // sits at the root.
  function usageApiBase() {
    var m = location.pathname.match(/^(.*\/ContentManager)(?:\/|$)/);
    return m ? m[1] + '/api/rest/' : null;
  }

  // XMLHttpRequest rather than fetch, to stay with the rest of the file.
  // Nothing else here uses a Promise.
  function usageGet(path, done) {
    var base = usageApiBase();
    if (!base) { done(null); return; }
    var xhr = new XMLHttpRequest();
    // Called at most once, whichever of the handlers below gets there first.
    var finished = false;
    function finish(data) {
      if (finished) return;
      finished = true;
      done(data);
    }
    try { xhr.open('GET', base + path, true); } catch (e) { finish(null); return; }
    // A request that never answers must not hold a concurrency slot, or the
    // bypass's one in-flight flag, for the rest of the session.
    xhr.timeout = USAGE_TIMEOUT_MS;
    xhr.ontimeout = function () { finish(null); };
    xhr.onerror = function () { finish(null); };
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) { finish(null); return; }
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not json */ }
      finish(data);
    };
    try { xhr.send(); } catch (e) { finish(null); }
  }

  // The default page size is 10, so the limit is not optional.
  function usageInusePath() {
    return 'templates/inuse?offset=0&limit=5000&fields=id';
  }

  // limit=1, never 0: limit=0 means unlimited here and returns every row.
  // Only resultCount is wanted, so ask for the smallest page and one field.
  function usageCountPath(id) {
    var filters = JSON.stringify({ templates: { values: [String(id)] }, workgroups: null });
    return 'media/search?offset=0&limit=1&search=&sort=&count=0'
      + '&filters=' + encodeURIComponent(filters)
      + '&facets=&listOnly=true&fields=id';
  }

  // Modelled on Content Manager's own media Used link, which is
  //   #playlists/?*filters={"media":{"values":["1780674"]}}
  // One parameter, with the leading * the route parser wants. Dropping the *
  // and passing filters= alone is ignored: you get the whole unfiltered list,
  // with no error anywhere, which looks like a working page.
  function usageMediaHash(id) {
    var filters = JSON.stringify({ templates: { values: [String(id)] } });
    return '#media/?*filters=' + encodeURIComponent(filters);
  }

  // No router to ask, and the hash can carry list state after the route name.
  function onTemplateList() {
    return /^#\/?templates?(?:[\/?]|$)/.test(location.hash);
  }

  function usageConcurrency() {
    var n = parseInt(CONFIG.templateUsageConcurrency, 10);
    return n > 0 ? n : 5;
  }

  function usagePump() {
    while (usageActive < usageConcurrency() && usageQueue.length) {
      (function (id, gen) {
        usageActive++;
        usageGet(usageCountPath(id), function (data) {
          // Generation first. Teardown has already zeroed the counter, so
          // decrementing here would drive it negative and let the next run
          // exceed the concurrency cap.
          if (gen !== usageGeneration) return;
          usageActive--;
          if (data && typeof data.resultCount === 'number') {
            usageCounts[id] = data.resultCount;
            usagePaint(id);
          } else {
            // Not recorded as 0: the inuse call said this template has
            // messages, so drawing nothing would be wrong. Forgotten instead,
            // so the next sweep asks again, up to a cap so a server that is
            // down is not asked forever.
            usageFailures[id] = (usageFailures[id] || 0) + 1;
            if (usageFailures[id] > USAGE_RETRIES) usageCounts[id] = 0;
            else delete usageCounts[id];
          }
          usagePump();
        });
      }(usageQueue.shift(), usageGeneration));
    }
  }

  function withUsageInuse(done) {
    if (usageInuse && Date.now() - usageInuseAt < USAGE_TTL_MS) { done(usageInuse); return; }
    if (usageInuseWaiters) { usageInuseWaiters.push(done); return; }
    usageInuseWaiters = [done];
    var gen = usageGeneration;
    usageGet(usageInusePath(), function (data) {
      var waiters = usageInuseWaiters;
      usageInuseWaiters = null;
      if (gen !== usageGeneration) return;
      var map = null;
      if (data && data.list) {
        map = {};
        for (var i = 0; i < data.list.length; i++) map[String(data.list[i].id)] = true;
        usageInuse = map;
        usageInuseAt = Date.now();
      }
      // A null map means the call failed. Every row then falls through to its
      // own count request, which is slower but still right.
      for (var k = 0; k < waiters.length; k++) waiters[k](map);
    });
  }

  // Content Manager's markup, class for class, so the app's own stylesheet
  // draws it and the line matches the media list on every version.
  function usageLine(id, count) {
    var li = document.createElement('li');
    li.className = 'usage';
    // Without data-cm-helper the global observer reads this as an app change
    // and sweeps forever.
    li.setAttribute('data-cm-helper', 'true');
    li.setAttribute(USAGE_MARK, String(id));

    // With the bypass on there is no dialog to open, so the line says what the
    // dialog would have said and links where it would have linked.
    var clauses = CONFIG.bypassUsageDialog
      ? usageClauses(TEMPLATE_KIND, { messagesCount: count }, id) : null;

    var label = document.createElement('label');
    label.textContent = clauses ? BYPASS_LABEL : 'Used:';
    li.appendChild(label);

    if (clauses) {
      for (var c = 0; c < clauses.length; c++) {
        if (c) li.appendChild(document.createTextNode(', '));
        li.appendChild(clauseLink(clauses[c]));
      }
      return li;
    }

    var a = document.createElement('a');
    a.className = 'usageCountValue';
    // The app uses a bare href="usage" and handles the click itself. Kept for
    // the styling that hangs off it; the click is ours.
    a.setAttribute('href', 'usage');
    a.textContent = count === 1 ? '1\u00a0time' : count + '\u00a0times';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      // The row behind the link has its own click handler. Without this the
      // count both opens the dialog and selects the template, which puts a
      // selectedIds in the URL and arms the Delete button.
      e.stopPropagation();
      openUsageDialog(id, count);
    });
    li.appendChild(a);
    return li;
  }

  function usagePaint(id) {
    var count = usageCounts[id];
    if (count === null || count === undefined) return;
    // Zero draws nothing at all, the same as a media row with no usage.
    if (!count) return;
    var rows = document.querySelectorAll(USAGE_ROWS);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-id') !== String(id)) continue;
      if (rows[i].querySelector('[' + USAGE_MARK + ']')) continue;
      var list = rows[i].querySelector(USAGE_LIST);
      if (list) list.appendChild(usageLine(id, count));
    }
  }

  function applyTemplateUsage() {
    if (!CONFIG.templateUsage) return;
    if (!onTemplateList()) return;
    var rows = document.querySelectorAll(USAGE_ROWS);
    if (!rows.length) return;

    var pending = [];
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute('data-id');
      if (!id) continue;
      if (rows[i].querySelector('[' + USAGE_MARK + ']')) continue;
      // Known already. Re-render after a sort or a page turn costs no request.
      if (Object.prototype.hasOwnProperty.call(usageCounts, id)) { usagePaint(id); continue; }
      pending.push(id);
    }
    if (!pending.length) return;

    withUsageInuse(function (inuse) {
      for (var k = 0; k < pending.length; k++) {
        var id = pending[k];
        if (Object.prototype.hasOwnProperty.call(usageCounts, id)) continue;
        if (inuse && !inuse[id]) {
          // Not in use, so there is nothing to ask and nothing to draw.
          // Recorded so the row is not queued again on the next sweep.
          usageCounts[id] = 0;
          continue;
        }
        usageCounts[id] = null;
        usageQueue.push(id);
      }
      usagePump();
    });
  }

  function closeUsageDialog() {
    if (usageDialog && usageDialog.parentNode) usageDialog.parentNode.removeChild(usageDialog);
    usageDialog = null;
    if (document.body) document.body.classList.remove('scrollKiller');
    document.removeEventListener('keydown', onUsageDialogKey, true);
  }

  function onUsageDialogKey(e) {
    if (e.key === 'Escape' || e.keyCode === 27) closeUsageDialog();
  }

  function usageEl(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  // Rebuilt rather than borrowed. There is no templates/usage endpoint to call
  // and no app entry point to reach, so this copies the media dialog exactly:
  // same tags, same classes, and the same inline styles the app writes.
  //
  // The inline styles are not decoration. The stylesheet leaves .modal and
  // .screen at display:none, and the app reveals and positions them by hand, so
  // a dialog built without them lands in the DOM and never appears. That is how
  // the first version of this failed.
  function openUsageDialog(id, count) {
    closeUsageDialog();

    var root = usageEl('div', 'usage');
    root.setAttribute('data-cm-helper', 'true');
    var container = usageEl('div', 'modalContainer');
    root.appendChild(container);

    // The backdrop covers the whole document, not just the viewport.
    var screen = usageEl('div', 'screen');
    var doc = document.documentElement;
    screen.style.width = doc.scrollWidth + 'px';
    screen.style.height = doc.scrollHeight + 'px';
    screen.style.display = 'block';
    screen.addEventListener('click', closeUsageDialog);
    container.appendChild(screen);

    var modal = usageEl('div', 'modal');
    // The app sizes this as the viewport less a margin. On a 1280 wide window
    // it writes 1200px, which is where the 80 comes from.
    var width = Math.max(320, window.innerWidth - 80);
    modal.style.width = width + 'px';
    modal.style.display = 'block';
    container.appendChild(modal);

    var header = usageEl('div', 'header');
    var h4 = document.createElement('h4');
    h4.textContent = 'Usage';
    header.appendChild(h4);
    var close = usageEl('a', 'close');
    close.setAttribute('href', '#');
    close.textContent = '[ x ]';
    close.addEventListener('click', function (e) { e.preventDefault(); closeUsageDialog(); });
    header.appendChild(close);
    modal.appendChild(header);

    // Empty placeholders the app's own dialog carries. 13.50 adds warning and
    // the older two do not, and an empty div costs nothing on either.
    modal.appendChild(usageEl('div', 'error'));
    modal.appendChild(usageEl('div', 'info'));
    modal.appendChild(usageEl('div', 'warning'));

    var content = usageEl('section', 'content');
    content.style.overflow = 'auto';
    var inner = usageEl('div', null);
    var p = document.createElement('p');
    p.textContent = 'This item is in use in the following:';
    inner.appendChild(p);
    var ul = document.createElement('ul');
    var li = document.createElement('li');
    var link = document.createElement('a');
    link.setAttribute('href', usageMediaHash(id));
    link.textContent = count === 1 ? '1 Message' : count + ' Messages';
    link.addEventListener('click', closeUsageDialog);
    li.appendChild(link);
    ul.appendChild(li);
    inner.appendChild(ul);
    content.appendChild(inner);
    modal.appendChild(content);

    var footer = document.createElement('footer');
    var actions = usageEl('div', 'actions');
    // The app also carries an a.cancel here and hides it. Leaving it out is the
    // same thing on screen, without depending on whatever does the hiding.
    var ok = usageEl('button', 'button-primary save');
    ok.textContent = 'OK';
    ok.addEventListener('click', function (e) { e.preventDefault(); closeUsageDialog(); });
    actions.appendChild(ok);
    footer.appendChild(actions);
    modal.appendChild(footer);

    document.body.appendChild(root);
    // Both measured, never assumed, and only once it is in the document and
    // displayed. The width set above is a request the stylesheet can overrule:
    // 13.50 caps it, so centring on the number we asked for rather than the
    // number we got left the dialog sitting against the left edge.
    modal.style.left = (window.pageXOffset +
      Math.max(0, (window.innerWidth - modal.offsetWidth) / 2)) + 'px';
    modal.style.top = (window.pageYOffset +
      Math.max(0, (window.innerHeight - modal.offsetHeight) / 2)) + 'px';
    document.body.classList.add('scrollKiller');
    document.addEventListener('keydown', onUsageDialogKey, true);
    usageDialog = root;
  }

  // Just the injected lines. The counts behind them survive, so a redraw after
  // a settings change costs nothing.
  function dropUsageLines() {
    var marks = document.querySelectorAll('[' + USAGE_MARK + ']');
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
  }

  function removeTemplateUsage() {
    closeUsageDialog();
    dropUsageLines();
    // Replies already on the wire must not land in the cleared caches.
    usageGeneration++;
    usageCounts = {};
    usageFailures = {};
    usageInuse = null;
    usageInuseAt = 0;
    usageInuseWaiters = null;
    usageQueue.length = 0;
    usageActive = 0;
  }

  // --------------------------------------------- bypass the usage dialog

  // Content Manager's "Used: 4 times" opens a dialog that does nothing but name
  // the object types the item appears in, each one a link onward. It is a step
  // with nothing in it, because those counts are already in the list payload
  // before anyone clicks. This spells them out in the row instead:
  //
  //   Used: 3 messages
  //   Used: 2 playlists, 3 channels, 1 message
  //
  // Each clause links where the dialog's own entry pointed, so the dialog is
  // never needed. No extra round trip per row either: one batched call covers a
  // whole page, the same call Content Manager already makes for itself.

  // The label changes with the feature, because the line stops meaning the same
  // thing. "Used: 3 times" is a tally. "Used By: 3 Messages" names what is using
  // it. Every list gets the same label, including the channel list, whose own
  // "Used in:" reads correctly but would be the odd one out.
  var BYPASS_LABEL = 'Used By:';

  var BYPASS_MARK = 'data-streamliner-bypass';
  var BYPASS_HID = 'data-streamliner-hid';

  function usageHash(route, filters) {
    // One parameter, with the leading * the route parser wants. Passing filters=
    // without it is ignored, and the page renders the whole unfiltered list with
    // no error anywhere, which looks like it worked.
    return route + '?*filters=' + encodeURIComponent(JSON.stringify(filters));
  }

  // Every route and key below was read off Content Manager's own dialog, one
  // relationship at a time, because there is no pattern to infer them from. The
  // naming disagrees with itself three ways: sub-playlist is "playlist" singular
  // while channel is "playlists" plural, the channel route is "#channel/" though
  // the list is "#channels", and media-to-messages carries a type discriminator
  // that nothing else needs.
  //
  // Order here is the order the clauses read in: channel, then playlist, then
  // message. Content Manager's own dialog lists them message, playlist, channel,
  // so this is deliberately not a copy of it.
  //
  // Type names are title-cased because that is how the app writes them, both in
  // the dialog and in the channel list's own "Used in: 1 Player".
  var USAGE_KINDS = [
    {
      name: 'template',
      match: /^#\/?templates?(?:[\/?]|$)/,
      // No list call: the template usage feature has already fetched these.
      cats: [
        { count: 'messagesCount', one: 'Message', many: 'Messages',
          link: function (id) {
            return usageHash('#media/', { templates: { values: [String(id)] } });
          } }
      ]
    },
    {
      name: 'media',
      match: /^#\/?media(?:[\/?]|$)/,
      endpoint: 'media/search',
      // Request names differ from response names here: usingMessagesCount comes
      // back as messagesCount. On the playlist search below they agree.
      fields: 'id,usingMessagesCount,usingPlaylistsCount',
      cats: [
        { count: 'playlistsCount', one: 'Playlist', many: 'Playlists',
          link: function (id) {
            return usageHash('#playlists/', { media: { values: [String(id)] } });
          } },
        { count: 'messagesCount', one: 'Message', many: 'Messages',
          link: function (id) {
            return usageHash('#media/', {
              type: { values: ['MESSAGE'] }, media: { values: [String(id)] }
            });
          } }
      ]
      // usingTemplatesCount exists on this search and is always 0. Content
      // Manager has no media-used-by-template relationship, so there is no
      // category for it here.
    },
    {
      name: 'playlist',
      match: /^#\/?playlists(?:[\/?]|$)/,
      endpoint: 'playlists/search',
      fields: 'id,channelsCount,asSubPlaylistsCount,messagesCount',
      cats: [
        { count: 'channelsCount', one: 'Channel', many: 'Channels',
          link: function (id) {
            return usageHash('#channel/', { playlists: { values: [String(id)] } });
          } },
        { count: 'asSubPlaylistsCount', one: 'Playlist', many: 'Playlists',
          link: function (id) {
            return usageHash('#playlists/', { playlist: { values: [String(id)] } });
          } },
        // Read off the dialog like the rest, once a playlist existed with a
        // message using it. Note what is absent: media-to-messages needs a
        // type discriminator and this does not, presumably because only a
        // message can hold a playlist, so there is nothing else to exclude.
        { count: 'messagesCount', one: 'Message', many: 'Messages',
          link: function (id) {
            return usageHash('#media/', { playlists: { values: [String(id)] } });
          } }
      ]
    }
  ];

  // The channel list is the odd one. It writes the count and the type straight
  // into the line as "Used in: 1 Player" rather than "3 times", so there is
  // nothing to fetch and nothing to reword: the text is copied as the app wrote
  // it and only the destination changes.
  //
  // Worth knowing that this is an improvement rather than a shortcut. The app's
  // own dialog links to a bare "#player" with no filter at all, so it names one
  // player and then hands you all of them. This links to that player.
  USAGE_KINDS.push({
    name: 'channel',
    match: /^#\/?channels?(?:[\/?]|$)/,
    copyText: true,
    link: function (id) {
      return usageHash('#player/', { channels: { values: [String(id)] } });
    }
  });

  var TEMPLATE_KIND = USAGE_KINDS[0];

  // Hover cannot be copied the way the resting look is: getComputedStyle only
  // reports the state an element is actually in, and Content Manager's own
  // sheets cannot be read from script because they arrive by @import from
  // another origin, so cssRules throws. So the rule is written out here.
  //
  // !important because the resting text-decoration is copied inline off the
  // app's anchor, and an inline value beats a plain rule.
  var BYPASS_CSS = '.streamliner-usage-link:hover { text-decoration: underline !important; }';

  var bypassEl = null;

  function applyBypassCss() {
    // isConnected, not merely "we made one": a sheet taken out of the document
    // still answers to the variable, and hover would be dead for the session.
    if (bypassEl && bypassEl.isConnected) return;
    if (!(document.head || document.documentElement)) return;
    bypassEl = makeStyle('cm-helper-bypass');
    bypassEl.textContent = BYPASS_CSS;
  }

  var bypassCounts = {};      // list name + row id -> the counts object from the list call
  var bypassPending = false;
  var bypassGeneration = 0;

  // Keyed by list as well as id. A reply can land after the user has moved on
  // to another list, and ids are not known to be distinct across object types,
  // so a media row's counts must never answer for a playlist row. Both carry a
  // messagesCount, and the link would have pointed at the wrong things.
  function bypassKey(kind, id) {
    return kind.name + ':' + id;
  }

  function usageKind() {
    if (!CONFIG.bypassUsageDialog) return null;
    for (var i = 0; i < USAGE_KINDS.length; i++) {
      if (USAGE_KINDS[i].match.test(location.hash)) return USAGE_KINDS[i];
    }
    return null;
  }

  // The clauses for one row, or null when any non-zero category has no link.
  // A clause that reads as a link and goes nowhere is worse than the dialog this
  // replaces, so an unmappable row is left alone and keeps its dialog.
  function usageClauses(kind, counts, id) {
    var out = [];
    for (var i = 0; i < kind.cats.length; i++) {
      var cat = kind.cats[i];
      var n = counts[cat.count];
      if (!n) continue;
      if (!cat.link) return null;
      out.push({
        // Non-breaking space, so a clause never wraps between the number and
        // the thing it counts. "2 playlists, 3 channels, 1 message" is three
        // pairs, and a line break inside one of them reads as a different list.
        text: n + '\u00a0' + (n === 1 ? cat.one : cat.many),
        href: cat.link(id)
      });
    }
    return out.length ? out : null;
  }

  // `model` is Content Manager's own anchor from the same row, when there is
  // one. Its class is deliberately not reused on a row the app owns: the list
  // view rewrites a.usageCountValue by selector whenever it re-renders a row,
  // and a row whose duration is still being calculated is re-rendered on a poll.
  // Our clause text was being replaced with the app's own "20 times" a second
  // or two after it was drawn. So the look is copied off its anchor instead of
  // borrowing the class that carries it.
  //
  // The template list has no app-owned line to collide with, and passes no
  // model, so it keeps the class and gets the styling for free.
  function clauseLink(clause, model) {
    var a = document.createElement('a');
    a.setAttribute('href', clause.href);
    a.textContent = clause.text;
    if (model) {
      a.className = 'streamliner-usage-link';
      var cs = window.getComputedStyle(model);
      a.style.color = cs.color;
      a.style.textDecoration = cs.textDecoration;
      a.style.cursor = cs.cursor === 'auto' ? 'pointer' : cs.cursor;
      a.style.fontWeight = cs.fontWeight;
    } else {
      a.className = 'usageCountValue';
    }
    // The row behind the link has its own click handler. Following a clause
    // should not also select the row and arm the toolbar buttons.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  function bypassPath(kind, ids) {
    // limit is the row count, never 0: 0 means unlimited on these endpoints.
    return kind.endpoint + '?offset=0&limit=' + ids.length +
      '&search=&sort=&count=0&filters=' +
      encodeURIComponent(JSON.stringify({ id: { values: ids, comparator: 'eq' } })) +
      '&facets=&listOnly=true&fields=' + kind.fields;
  }

  // Scoped to the row, and deliberately not to a column. The media and template
  // lists put this in div.column.col3; the playlist list has no col3 at all and
  // puts it in a col2. The row scope is what keeps the filter sidebar's own
  // li.usage out of reach.
  function rowUsageLi(row) {
    return row.querySelector('li.usage');
  }

  // Every anchor in the line, not a.usageCountValue: the channel list's anchor
  // carries no class at all. The line holds a label and the anchor and nothing
  // else, and this runs before our own holder is added, so a bare `a` is safe.
  function ownAnchors(li) {
    return li.querySelectorAll('a');
  }

  function paintClauses(li, clauses, own, labelText) {
    // Read the look off the app's anchor before hiding it, then hide rather
    // than remove, so switching the feature off puts its dialog back without a
    // reload.
    var model = own.length ? own[0] : null;
    var holder = document.createElement('span');
    holder.setAttribute('data-cm-helper', 'true');
    holder.setAttribute(BYPASS_MARK, 'clauses');

    // Our own label rather than an edit of the app's, for the same reason the
    // clauses do not reuse its class: the list view rewrites what it owns when
    // it re-renders a row, and our text would go with it. The app's is hidden
    // by the same mechanism as its anchor, so teardown restores both.
    if (labelText) {
      var labels = li.querySelectorAll('label');
      for (var n = 0; n < labels.length; n++) {
        labels[n].setAttribute(BYPASS_HID, labels[n].style.display || '');
        labels[n].style.display = 'none';
      }
      var lab = document.createElement('label');
      lab.textContent = labelText;
      holder.appendChild(lab);
      holder.appendChild(document.createTextNode(' '));
    }

    for (var k = 0; k < clauses.length; k++) {
      if (k) holder.appendChild(document.createTextNode(', '));
      holder.appendChild(clauseLink(clauses[k], model));
    }
    for (var i = 0; i < own.length; i++) {
      own[i].setAttribute(BYPASS_HID, own[i].style.display || '');
      own[i].style.display = 'none';
    }
    li.appendChild(holder);
    li.setAttribute(BYPASS_MARK, 'done');
  }

  function paintRowClauses(kind, row) {
    var id = row.getAttribute('data-id');
    var counts = bypassCounts[bypassKey(kind, id)];
    if (!counts) return;
    var li = rowUsageLi(row);
    if (!li || li.getAttribute(BYPASS_MARK)) return;
    var clauses = usageClauses(kind, counts, id);
    if (!clauses) return;
    paintClauses(li, clauses, ownAnchors(li), BYPASS_LABEL);
  }

  // The copy-text kinds already count and name correctly, so the app's own
  // wording for the clause is reused verbatim. Only the link and the label
  // change.
  function paintCopiedClause(kind, row) {
    var id = row.getAttribute('data-id');
    if (!id) return;
    var li = rowUsageLi(row);
    if (!li || li.getAttribute(BYPASS_MARK)) return;
    var own = ownAnchors(li);
    if (!own.length) return;
    var text = own[0].textContent.replace(/\s+/g, ' ').trim();
    if (!text) return;
    paintClauses(li, [{ text: text, href: kind.link(id) }], own, BYPASS_LABEL);
  }

  function applyBypassUsage() {
    var kind = usageKind();
    // The template list is handled where its line is built, not here. Its
    // clauses keep the app's own class, so they get its hover for free.
    if (!kind || (!kind.endpoint && !kind.copyText)) return;
    applyBypassCss();

    // Nothing to fetch: the count and the type are already in the line.
    if (kind.copyText) {
      var owned = document.querySelectorAll(USAGE_ROWS);
      for (var c = 0; c < owned.length; c++) paintCopiedClause(kind, owned[c]);
      return;
    }
    var rows = document.querySelectorAll(USAGE_ROWS);
    if (!rows.length) return;

    var pending = [];
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute('data-id');
      if (!id) continue;
      // No line at all means the item is unused, and there is nothing to say.
      var li = rowUsageLi(rows[i]);
      if (!li || li.getAttribute(BYPASS_MARK)) continue;
      if (Object.prototype.hasOwnProperty.call(bypassCounts, bypassKey(kind, id))) {
        paintRowClauses(kind, rows[i]);
        continue;
      }
      pending.push(id);
    }
    if (!pending.length || bypassPending) return;

    bypassPending = true;
    var gen = bypassGeneration;
    usageGet(bypassPath(kind, pending), function (data) {
      if (gen !== bypassGeneration) return;
      bypassPending = false;
      var list = (data && data.list) || [];
      // Stored under the list the request was for, whatever list is showing
      // by the time the reply arrives.
      for (var k = 0; k < list.length; k++) {
        bypassCounts[bypassKey(kind, String(list[k].id))] = list[k];
      }
      // Anything the call did not answer for is recorded empty, so the next
      // sweep does not queue it again and again.
      for (var m = 0; m < pending.length; m++) {
        var key = bypassKey(kind, pending[m]);
        if (!Object.prototype.hasOwnProperty.call(bypassCounts, key)) bypassCounts[key] = {};
      }
      applyBypassUsage();
    });
  }

  function removeBypassUsage() {
    var holders = document.querySelectorAll('[' + BYPASS_MARK + '="clauses"]');
    for (var i = 0; i < holders.length; i++) {
      if (holders[i].parentNode) holders[i].parentNode.removeChild(holders[i]);
    }
    var hidden = document.querySelectorAll('[' + BYPASS_HID + ']');
    for (var k = 0; k < hidden.length; k++) {
      hidden[k].style.display = hidden[k].getAttribute(BYPASS_HID);
      hidden[k].removeAttribute(BYPASS_HID);
    }
    var marked = document.querySelectorAll('[' + BYPASS_MARK + '="done"]');
    for (var m = 0; m < marked.length; m++) marked[m].removeAttribute(BYPASS_MARK);
    if (bypassEl && bypassEl.parentNode) bypassEl.parentNode.removeChild(bypassEl);
    bypassEl = null;
    bypassGeneration++;
    bypassCounts = {};
    bypassPending = false;
  }

  // ------------------------------------------------ maintenance file picker

  // The Install File task's picker is module/maintenancejob/fileSelector, the
  // same code on 11.07 and 12.00. It asks the server for ten files at a time
  // sorted by name, and the server sorts case-sensitively, so "agent10.exe"
  // lands after "Touchless.exe". There is no case-insensitive sort to ask for.
  // So the whole list is fetched in one go and sorted here. With one page the
  // app's pager draws nothing, and only the limit selector needs hiding.
  //
  // The hooks are prototype wrappers, reached through the app's own require.
  // They go in lazily from the sweep, because the modules only exist once
  // main.js has run, and they read the config on every call so Save applies
  // at once. A module that is missing, as it may be on 13.x, is left alone.
  var PICKER_MODULE = 'module/maintenancejob/fileSelector';
  var UPLOADER_MODULE = 'components/uploader/maintenanceJobUploader';
  var SELECT_MODULE = 'components/inlineEdit/select';
  var TALL_CLASS = 'streamliner-tall';
  var PICKER_ALL = 999999;          // what the app itself asks for to mean "all"
  var PICKER_POLL_MS = 1000;
  var PICKER_POLL_CAP_MS = 30000;

  // The warning icon marks every file in use, which is most of them, and the
  // Used: line under the name already says so.
  //
  // The task's Type list is capped at 156px, like every dropdown in the app,
  // and scrolls to show its eleven entries. The cap is lifted for that one list.
  // The list hangs off <body>, so the dialog's own height never mattered.
  var PICKER_CSS = [
    '.fileSelector li.usedCount img[src*="icon_warning"] { display: none !important; }',
    '.fileSelector .limitSelector { display: none !important; }',
    'html body ul.selectPopup.' + TALL_CLASS + ' { max-height: none !important; overflow-y: auto !important; }'
  ].join('\n');

  var pickerEl = null;
  var pickerPatched = false;
  var uploaderPatched = false;
  var selectPatched = false;
  var livePicker = null;            // the fileSelector view currently open
  var pickerBatch = [];             // names seen in the upload in progress
  var pickerTarget = null;          // name to select, until the user picks
  var pickerPoll = null;
  var pickerPollUntil = 0;
  var pickerEventsBound = false;

  function pickerOn() {
    return !!CONFIG.maintenanceFilesFixes;
  }

  function appRequire(name) {
    var req = window.require;
    if (typeof req !== 'function' || typeof req.defined !== 'function') return null;
    if (!req.defined(name)) return null;
    try {
      return req(name);
    } catch (e) {
      return null;
    }
  }

  function byName(a, b) {
    return String(a && a.name).localeCompare(String(b && b.name), undefined,
      { sensitivity: 'base', numeric: true });
  }

  // Every hook goes through these two, so an app version that differs in a
  // way this code cannot see loses the fix and keeps the feature. A missing
  // method is left alone. The original always runs, and the app gets its
  // result. Anything Streamliner's own code throws is caught and logged.
  //
  // wrapBefore's extra may return a replacement argument list. wrapAfter's
  // extra may return a replacement result. Returning nothing changes nothing.
  function wrapBefore(proto, name, extra) {
    var orig = proto && proto[name];
    if (typeof orig !== 'function') return false;
    proto[name] = function () {
      var args = arguments;
      try {
        var changed = extra.apply(this, args);
        if (changed) args = changed;
      } catch (e) {
        log(name + ' hook failed', e);
      }
      return orig.apply(this, args);
    };
    return true;
  }

  function wrapAfter(proto, name, extra) {
    var orig = proto && proto[name];
    if (typeof orig !== 'function') return false;
    proto[name] = function () {
      var out = orig.apply(this, arguments);
      try {
        var changed = extra.call(this, out);
        if (changed !== undefined) out = changed;
      } catch (e) {
        log(name + ' hook failed', e);
      }
      return out;
    };
    return true;
  }

  // The picker's list view, if it has everything the auto-selection uses.
  function pickerList(view) {
    var list = view && view.files && view.files.list;
    if (!list || !list.el || !list.$el || !list.collection) return null;
    if (typeof list.on !== 'function' || typeof list.update !== 'function') return null;
    if (typeof list.collection.find !== 'function') return null;
    return list;
  }

  // Only the picker uses MaintenanceFiles, so this touches nothing else.
  function patchMaintenanceFiles() {
    var models = appRequire('models/model');
    var Files = models && models.MaintenanceFiles;
    if (!Files || !Files.prototype) return false;
    if (Files.prototype.__streamlinerPatched) return true;
    Files.prototype.__streamlinerPatched = true;

    // The base fetch merges data into this.data, so the tally agrees too.
    wrapBefore(Files.prototype, 'fetch', function (options) {
      if (!pickerOn()) return;
      options = options || {};
      options.data = options.data || {};
      options.data.limit = PICKER_ALL;
      options.data.offset = 0;
      return [options];
    });

    wrapAfter(Files.prototype, 'parse', function (list) {
      if (pickerOn() && list && typeof list.slice === 'function') return list.slice().sort(byName);
    });
    return true;
  }

  function patchFilePicker() {
    if (pickerPatched) return;
    var Picker = appRequire(PICKER_MODULE);
    if (!Picker || !Picker.prototype || !patchMaintenanceFiles()) return;
    pickerPatched = true;

    wrapAfter(Picker.prototype, 'attachListeners', function () {
      var view = this;
      var list = pickerList(view);
      if (!list) return;
      livePicker = view;
      pickerTarget = null;
      pickerBatch = [];
      // Every render, not just the first: the app's own refreshes redraw the
      // list and drop the selection with it. The first render that holds the
      // file also ends the fast polling.
      list.on('listRenderComplete', function () {
        if (view === livePicker && selectPickerTarget()) stopPickerPoll();
      });
      // A click by a person ends the auto-selection. Ours are not trusted.
      // Capture phase, because the row's own handler stops propagation.
      list.el.addEventListener('click', function (e) {
        if (e.isTrusted) pickerTarget = null;
      }, true);
    });
    log('file picker patched');
  }

  // Upload opens a "File Upload" dialog whose only job is its Add button,
  // which opens the file chooser. Doing that straight away saves the click.
  // It runs inside the Upload click, so the browser still counts it as the
  // user's gesture. A drop arrives with its files already, and Add More after
  // a first pick stays a manual click.
  function patchUploader() {
    if (uploaderPatched) return;
    var Uploader = appRequire(UPLOADER_MODULE);
    if (!Uploader || !Uploader.prototype) return;
    uploaderPatched = true;

    wrapAfter(Uploader.prototype, 'renderModal', function () {
      var files = this.options && this.options.files;
      if (!pickerOn() || (files && files.length)) return;
      var content = this.modal && this.modal.contentView;
      var input = content && content.$el && content.$el.find('.browse')[0];
      if (input) input.click();
    });
  }

  // The popup carries no sign of which dropdown opened it, so it is marked as
  // it is built, when the dropdown is the task's command selector.
  function patchTaskTypeSelect() {
    if (selectPatched) return;
    var Select = appRequire(SELECT_MODULE);
    if (!Select || !Select.prototype) return;
    selectPatched = true;

    wrapAfter(Select.prototype, 'buildPopup', function () {
      if (!pickerOn() || !this.popup || !this.$el) return;
      if (this.$el.closest('.commandSelector').length) this.popup.addClass(TALL_CLASS);
    });
  }

  function pickerOpen() {
    return !!(livePicker && livePicker.el && livePicker.el.isConnected && isVisible(livePicker.el));
  }

  function matchesUpload(model, name) {
    var have = String((model && typeof model.get === 'function' && model.get('name')) || '');
    return have === name || have.slice(-(name.length + 1)) === '/' + name;
  }

  // Leaves exactly one row active, the one just uploaded. Rows are clicked
  // rather than styled, because the app keeps its selection on the item views
  // and only its own click handler updates them and enables Select.
  function selectPickerTarget() {
    if (!pickerOn() || !pickerTarget || !pickerOpen()) return false;
    var list = pickerList(livePicker);
    var $ = window.jQuery;
    if (!list || !$) return false;
    try {
      var model = list.collection.find(function (m) { return matchesUpload(m, pickerTarget); });
      if (!model) return false;
      var row = list.$el.find('li[data-id="' + model.id + '"]')[0];
      if (!row) return false;
      list.$el.find('li.active:not(.header)').each(function () {
        if (this !== row) this.click();
      });
      if (!$(row).hasClass('active')) row.click();
      if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      return true;
    } catch (e) {
      log('auto-select failed', e);
      return false;
    }
  }

  function stopPickerPoll() {
    if (pickerPoll) nativeClearInterval(pickerPoll);
    pickerPoll = null;
  }

  // The app waits five seconds before its first look and then looks every five.
  // This looks every second and stops at the first sight of the file.
  function startPickerPoll() {
    stopPickerPoll();
    pickerPollUntil = Date.now() + PICKER_POLL_CAP_MS;
    pickerPoll = nativeSetInterval(function () {
      var list = pickerList(livePicker);
      if (!list || !pickerOn() || !pickerTarget || !pickerOpen() || Date.now() > pickerPollUntil) {
        stopPickerPoll();
        return;
      }
      try {
        list.update();
      } catch (e) {
        log('picker refresh failed', e);
        stopPickerPoll();
      }
    }, PICKER_POLL_MS);
  }

  // The upload events are jQuery events on the app's root view, which a native
  // listener would never see.
  function bindPickerEvents() {
    if (pickerEventsBound) return;
    var app = window.App;
    if (!app || !app.view || !app.view.$el) return;
    pickerEventsBound = true;
    app.view.$el.on('fileUploadStarted', function (e, data) {
      if (data && data.filename && pickerOpen()) pickerBatch.push(String(data.filename));
    });
    app.view.$el.on('filesUploaded', function () {
      if (!pickerBatch.length) return;
      pickerTarget = pickerBatch[pickerBatch.length - 1];
      pickerBatch = [];
      if (!pickerOn() || !pickerOpen() || !pickerList(livePicker)) return;
      startPickerPoll();
      try {
        pickerList(livePicker).update();
      } catch (e) {
        log('picker refresh failed', e);
      }
    });
  }

  function applyFilePicker() {
    patchFilePicker();
    patchUploader();
    patchTaskTypeSelect();
    bindPickerEvents();
    if (!pickerOn()) return;
    if (pickerEl && pickerEl.isConnected) return;
    if (!(document.head || document.documentElement)) return;
    pickerEl = makeStyle('cm-helper-picker');
    pickerEl.textContent = PICKER_CSS;
  }

  function removeFilePicker() {
    if (pickerEl && pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl);
    pickerEl = null;
    stopPickerPoll();
    pickerTarget = null;
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
    // The fallback is often rgb() already, and that needs no canvas.
    var fallback = parseRgb(raw);
    if (fallback) return fallback;

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
  var darkBuiltAt = null;

  function refreshDark() {
    if (!darkOn || !darkEl) return;
    var signature = sheetSignature();
    if (signature === darkBuiltAt) return;
    darkBuiltAt = signature;
    darkEl.textContent = buildDarkCss();
  }

  function setDark(on, remember) {
    darkOn = !!on;
    if (darkOn) {
      if (!darkEl) darkEl = makeStyle(DARK_ID);
      darkBuiltAt = null;
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
  // Measures what the entry wants on one line. The sweep runs while the dropdown
  // is shut, where the entries have no box at all and a measurement comes back
  // zero, so the element is laid out with visibility hidden just long enough to
  // read it. Nothing is painted: the styles go back in the same synchronous
  // block. Any pinned width is cleared first, or the previous measurement would
  // be measured again.
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
      // Both calls: stopPropagation keeps the event from delegated handlers up
      // the tree, which is how 11.07 and 12.00 bind logout. It does nothing to
      // a handler bound to this very element, and the immediate form does.
      e.stopPropagation();
      e.stopImmediatePropagation();
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

  // A setting shown without opening anything gets a proper name. The advanced
  // fields keep their config key, because that is what you would type in the
  // file or from the console.
  var FIELD_LABELS = {
    searchHotkey: 'Search Hotkey'
  };

  var FIELD_NOTES = {
    speedFactor: 'Higher is faster. 1 turns animation scaling off.',
    scaleTimeouts: 'Also speeds up dialogs and menus on 13.x. Affects app timers, so try it before leaving it on.',
    fixSignIn: 'Only 11.x needs it. 13.x ships the button enabled.',
    pinnedMenuWidth: 'Wider menus take width from the page content.',
    listFilterHeight: 'How tall a filter list may get before it scrolls.',
    templateUsageConcurrency: 'How many usage counts to fetch at once. Higher is faster and leans harder on the server.',
    searchHotkey: 'A key on its own, or with modifiers: "/", "cmd+k", "ctrl+k", "alt+s".',
    darkMode: 'Applies as soon as you save.',
    showHostBadge: 'Adds the host badge to the login page.',
    hostInTitle: 'Puts the host in the tab title, in front of the page name.',
    darkModeInvertLogos: 'Keeps logos legible on a dark page. A saturated mark comes back lighter.'
  };

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
      blurb: 'Renders Content Manager using a dark mode theme. (Some images and other ' +
             'areas still need to be refined.)',
      advanced: ['darkModeInvertLogos']
    },
    {
      title: 'UI Transition Speed',
      master: 'speedFactor',
      masterKind: 'factor',
      blurb: 'Reduces or eliminates the delays introduced by Content Manager\'s UX ' +
             'transition animations.',
      advanced: ['speedFactor', 'scaleJquery', 'scaleCss', 'scaleWebAnimations',
                 'scaleTimeouts', 'timeoutCeilingMs']
    },
    {
      title: 'Text Only Compact Menus',
      master: 'textOnlyPinnedMenu',
      blurb: '(Content Manager 12.50 and up) Lays out Content Manager\'s compact side ' +
             'menus using text-only, which is easier to identify than the original ' +
             'icons-only.',
      advanced: ['pinnedMenuWidth', 'pinnedHoverColor', 'labelOverrides']
    },
    {
      title: 'List Filters',
      master: 'scrollListFilters',
      blurb: 'The various list filters only show the first several entries, with the rest ' +
             'hidden behind Show More. Now all choices are shown initially, in a box that ' +
             'scrolls.',
      advanced: ['listFilterHeight']
    },
    {
      title: 'Template Usage',
      master: 'templateUsage',
      blurb: 'Adds a Used: count to items in the template list, that links to those ' +
             'messages.',
      advanced: ['templateUsageConcurrency']
    },
    {
      title: 'Bypass Usage Dialog',
      master: 'bypassUsageDialog',
      blurb: 'Breaks a Used: count into its parts in the list, such as 2 Channels and ' +
             '1 Message. Each part links straight to what it counts, instead of via the ' +
             'Usage Dialog.',
      advanced: []
    },
    {
      title: 'Maintenance Files Fixes',
      master: 'maintenanceFilesFixes',
      blurb: 'Improves the file selection for a maintenance job\'s Install File task. It ' +
             'lists every file on one page, sorted without regard to case, and drops the ' +
             'warning icon on files in use. Upload opens the file chooser straight away, ' +
             'and a new upload is selected as soon as it appears. A task\'s Type list ' +
             'shows every choice without scrolling.',
      advanced: []
    },
    {
      title: 'Focus Search',
      master: 'focusSearch',
      blurb: 'Adds a keyboard shortcut to focus each page\'s search box.',
      always: ['searchHotkey'],
      advanced: []
    },
    {
      title: 'Host Identification',
      // No single boolean owns this one, so the master is both sub-options at
      // once: off turns both off, on restores both.
      masterKind: 'any',
      masterKeys: ['showHostBadge', 'hostInTitle'],
      blurb: 'Shows the URL of this Content Manager on the login page and on the tab ' +
             'title. Useful if you\'re working with multiple instances.',
      advanced: ['showHostBadge', 'hostInTitle', 'hostBadgeSize']
    },
    {
      title: 'Login Button Fix',
      master: 'fixSignIn',
      blurb: 'Fix a problem where autofill (e.g. from a password manager) can\'t login ' +
             'because Content Manager doesn\'t re-enable the disabled Login button in ' +
             'all cases.',
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

  // The extension icon, inlined. A userscript has no extension URL to point at,
  // and the content script runs in the MAIN world where chrome.runtime does not
  // exist either, so the artwork has to travel inside this file.
  //
  // It goes in as a real <svg> element, not an <img> with a data: URI. 13.50
  // serves default-src 'self' with no data: in img-src, so a data: image is
  // refused and draws as a broken icon. 11.07 sends no such policy, which is why
  // this looked fine there. An inline <svg> is not an img-src fetch at all.
  //
  // This is icons/icon.svg with its formatting newlines collapsed to spaces,
  // which renders identically. The gradient ids are namespaced in the build
  // script because they land in Content Manager's own document here. Keep the
  // two in step: regenerate with icons/build-icons.py if the artwork changes.
  var ICON_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">',
    ' <defs>',
    '<linearGradient id="streamliner-icon-g0" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0" stop-color="#fff" stop-opacity="0"/>',
    '<stop offset="0.85" stop-color="#fff" stop-opacity="0.5"/>',
    '</linearGradient>',
    '<linearGradient id="streamliner-icon-g1" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0" stop-color="#fff" stop-opacity="0"/>',
    '<stop offset="0.85" stop-color="#fff" stop-opacity="0.7"/>',
    '</linearGradient>',
    '<linearGradient id="streamliner-icon-g2" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0" stop-color="#fff" stop-opacity="0"/>',
    '<stop offset="0.85" stop-color="#fff" stop-opacity="0.92"/>',
    '</linearGradient></defs> ',
    '<rect x="2" y="2" width="124" height="124" rx="28" fill="#3F454D"/> ',
    '<rect x="13" y="46.3" width="76.9" height="8" rx="4.0" fill="url(#streamliner-icon-g0)"/>',
    '<rect x="13" y="65.3" width="57.9" height="8" rx="4.0" fill="url(#streamliner-icon-g1)"/>',
    '<rect x="13" y="84.3" width="44.3" height="8" rx="4.0" fill="url(#streamliner-icon-g2)"/>',
    ' ',
    '<g transform="translate(76.35,69.65) rotate(45) scale(1.1)" fill="#fff" stroke="#3F454D" stroke-width="9" paint-order="stroke">',
    ' ',
    '<path d="M -11,-35 A 11,11 0 0 1 11,-35 L 6.5,1 A 6.5,6.5 0 0 1 -6.5,1 Z"/>',
    '<circle cx="0" cy="24" r="8.5"/> </g> </svg>'
  ].join('');

  // opts.welcome marks the one time the panel opens unasked, after the first
  // sign-in on a server. It then says how to get back to it.
  // opts.values is what the form starts from. Reset passes the defaults, so
  // the form shows them without anything being saved until Save.
  function openSettings(opts) {
    if (panel) return;
    if (!document.body) return;
    var welcome = !!(opts && opts.welcome === true);
    var values = (opts && opts.values) || CONFIG;

    panel = document.createElement('div');
    panel.setAttribute('data-cm-helper', 'true');
    // The panel is built from inline styles, and the dark sheet's !important
    // rules still reach any element here that one of the app's selectors
    // happens to match. So it picks a palette of its own for each mode rather
    // than relying on the sheet leaving it alone.
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
    // The right padding is the icon's room. Without it a long host name in the
    // scope line runs under the mark.
    head.style.cssText = 'padding:16px 72px 16px 20px;border-bottom:1px solid ' + skin.line + ';' +
      'position:sticky;top:0;background:' + skin.card + ';';
    var title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:650';
    title.textContent = 'Streamliner for Scala Content Manager Settings';
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

    if (welcome) {
      var hint = document.createElement('div');
      hint.style.cssText = 'font-size:12px;margin-top:8px';
      hint.textContent = 'To return to this settings dialog, click your username in Content ' +
        'Manager\'s upper-right, and select the ' + SETTINGS_LABEL + ' entry that is added ' +
        'to that drop-down.';
      head.appendChild(hint);
    }

    // Sticky counts as positioned, so this anchors to the header without the
    // header needing to be restructured. Decorative: the title already names it.
    var mark = document.createElement('span');
    mark.setAttribute('data-cm-helper', 'true');
    mark.setAttribute('aria-hidden', 'true');
    mark.style.cssText = 'position:absolute;top:14px;right:20px;width:40px;height:40px;';
    mark.innerHTML = ICON_SVG;
    // The file carries width and height of 128 for the PNG build. Inline, the
    // box is 40, so let the viewBox do the scaling.
    var markSvg = mark.firstChild;
    if (markSvg && markSvg.setAttribute) {
      markSvg.setAttribute('width', '40');
      markSvg.setAttribute('height', '40');
    }
    head.appendChild(mark);
    card.appendChild(head);

    var body = document.createElement('div');
    body.style.cssText = 'padding:8px 20px 4px';
    card.appendChild(body);

    var inputs = {};

    var overridesField = null;
    var masters = [];

    function row(label, control, note, container) {
      var wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;gap:12px;align-items:flex-start;padding:8px 0;' +
        'border-bottom:1px solid ' + skin.line + ';';
      var left = document.createElement('div');
      left.style.cssText = 'flex:1;min-width:0';
      left.innerHTML = '<div style="font-weight:550">' + label + '</div>' +
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

      if (key === 'labelOverrides') {
        var label = document.createElement('div');
        label.style.cssText = 'padding:8px 0 0;font-weight:550';
        label.innerHTML = 'labelOverrides<div style="font-weight:400;color:' + skin.muted +
          ';font-size:12px;margin-top:1px">One per line, ' +
          '<code>Full label = Short label</code></div>';
        container.appendChild(label);

        overridesField = document.createElement('textarea');
        overridesField.value = overridesToText(values.labelOverrides || {});
        overridesField.rows = 6;
        overridesField.style.cssText = 'width:100%;box-sizing:border-box;margin:6px 0 4px;padding:8px;' +
          'border:1px solid ' + skin.fieldLine + ';border-radius:4px;background:' + skin.field +
          ';color:' + skin.text + ';font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace';
        container.appendChild(overridesField);
        return;
      }

      var val = values[key];
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
      row(FIELD_LABELS[key] || key, el, note, container);
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
        master.checked = Number(values[group.master]) > 1;
      } else if (group.masterKind === 'any') {
        master.checked = group.masterKeys.some(function (key) { return !!values[key]; });
      } else {
        master.checked = !!values[group.master];
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
      // The native marker does not show here, so the triangle is drawn. Borders
      // rather than a glyph: no font can fail to have it, and it takes the
      // summary's own colour. display:flex also guarantees no second marker,
      // because only a list-item has one.
      summary.style.cssText = 'cursor:pointer;font-size:12px;color:#1a6cff;padding:6px 0;' +
        'display:flex;align-items:center;gap:7px;list-style:none;' +
        '-webkit-user-select:none;user-select:none';
      var arrow = document.createElement('span');
      arrow.style.cssText = 'flex:0 0 auto;width:0;height:0;border-left:5px solid currentColor;' +
        'border-top:4px solid transparent;border-bottom:4px solid transparent;' +
        'transition:transform 120ms ease-out';
      summary.appendChild(arrow);
      var caption = document.createElement('span');
      caption.textContent = 'Advanced';
      summary.appendChild(caption);
      details.appendChild(summary);
      details.addEventListener('toggle', function () {
        arrow.style.transform = details.open ? 'rotate(90deg)' : '';
      });
      var inner = document.createElement('div');
      // Inset, so the detail reads as belonging to the expander above it rather
      // than to the section.
      inner.style.cssText = 'padding-left:17px';
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
      // Only the form goes back to the defaults. Nothing is saved until Save,
      // so Cancel after a Reset still leaves the settings as they were. Every
      // setting is on the form, so Save then writes every default.
      closeSettings();
      openSettings({ welcome: welcome, values: cloneValue(DEFAULTS) });
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
    // A patch can be installed late, which is how a speed switch takes effect
    // without a reload. Taking one out is what cannot be done, so the wrappers
    // read the config on every call instead.
    if (CONFIG.scaleJquery) installJqueryPatch();
    if (CONFIG.scaleWebAnimations) patchWebAnimations();
    if (CONFIG.scaleTimeouts) patchTimeouts();
    // Always torn down: the sweep rebuilds it when the feature is still on, and
    // labels are then recomputed from scratch.
    removePinnedMenu();
    // Only a stylesheet, so taking it out is the whole teardown.
    removeListFilters();
    // Torn down only when it is off, unlike the two above. Those rebuild from
    // a stylesheet and cost nothing. This one would re-fetch every count, so
    // saving any setting at all would fire a request per used template. No
    // setting here changes a count, so the cache survives and the sweep
    // repaints from it.
    if (!CONFIG.templateUsage) removeTemplateUsage();
    // Dropped either way, because the bypass changes how the line reads. The
    // counts stay cached, so the sweep redraws both without a single request.
    else dropUsageLines();
    removeBypassUsage();
    // The prototype hooks stay and check the switch. Only the sheet goes.
    removeFilePicker();
    // Let the placeholder hint pick up a changed hotkey. Every box that carries
    // one, not just the first: a second box gets decorated as soon as it is the
    // visible one, and both can be in the DOM at once.
    var boxes = document.querySelectorAll('[data-cm-placeholder]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].setAttribute('placeholder', boxes[i].getAttribute('data-cm-placeholder'));
      boxes[i].removeAttribute('data-cm-placeholder');
    }
    cssBuiltAt = null;
    darkBuiltAt = null;
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
    if ((e.key || '').toLowerCase() === hotkey.key) return true;
    // A Mac Option combination reports the character the layout produces, not
    // the letter that was pressed: Alt+S arrives as an es-zed. The physical key
    // still names itself, so fall back to that.
    if (hotkey.key.length !== 1 || !/^[a-z0-9]$/.test(hotkey.key)) return false;
    return e.code === (/[0-9]/.test(hotkey.key) ? 'Digit' : 'Key') + hotkey.key.toUpperCase();
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

  // An open dialog, if there is one. The last in the document is the one on top.
  var DIALOG_SELECTOR = '.modalContainer .modal, .mdc-dialog--open';

  function openDialog() {
    var list = document.querySelectorAll(DIALOG_SELECTOR);
    for (var i = list.length - 1; i >= 0; i--) {
      if (isVisible(list[i])) return list[i];
    }
    return null;
  }

  // The box the hotkey would reach: the first visible, usable one. A dialog's
  // own box wins. The page behind it can have a visible box of its own, which
  // comes first in the document: the Players tab does, under Add Players.
  function searchTarget() {
    var dialog = openDialog();
    var list = dialog && dialog.querySelector(SEARCH_SELECTOR)
      ? dialog.querySelectorAll(SEARCH_SELECTOR)
      : document.querySelectorAll(SEARCH_SELECTOR);
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
      // Consumed here, or the app also sees it and closes whatever it has open
      // underneath the panel.
      e.preventDefault();
      e.stopPropagation();
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

  // Opens the settings once per server, right after the first sign-in. Anyone
  // who has saved settings already knows where they are, so that counts as
  // welcomed. Without working storage the flag could never stick, and the
  // panel would open on every load, so then it never opens at all.
  //
  // The user menu alone does not mean signed in. 12.00 renders it, Logout and
  // all, hidden inside the login page, so the settings entry is there too. The
  // sign-in button is what marks the login page on every version.
  var welcomeChecked = false;

  function signedIn() {
    if (document.querySelector(SIGNIN_BUTTON)) return false;
    if (/^#login\b/.test(location.hash)) return false;
    return !!document.querySelector('[data-streamliner-usermenu]');
  }

  function welcomeOnce() {
    if (welcomeChecked || panel || !signedIn()) return;
    welcomeChecked = true;
    try {
      var store = window.localStorage;
      if (store.getItem(WELCOME_KEY)) return;
      var known = store.getItem(CONFIG_KEY) !== null;
      store.setItem(WELCOME_KEY, '1');
      if (store.getItem(WELCOME_KEY) !== '1' || known) return;
    } catch (e) {
      return;
    }
    log('first visit: opening the settings');
    openSettings({ welcome: true });
  }

  // Every helper sheet is !important, and so are some of the app's own rules.
  // At equal specificity the later sheet wins, so a sheet the app adds after
  // ours would beat it, and the feature would look switched off for no reason.
  // Whenever the set of app sheets changes, ours move to the end of <head>.
  // A move re-parses the sheet, so nothing moves when they are already last.
  var sheetsSeenAt = null;

  function keepHelperSheetsLast() {
    var signature = sheetSignature();
    if (signature === sheetsSeenAt) return;
    sheetsSeenAt = signature;
    var head = document.head;
    if (!head) return;
    var mine = document.querySelectorAll('style[data-cm-helper]');
    if (!mine.length) return;
    // "Last" means after every app stylesheet in head, and in head at all: a
    // sheet made at document-start can be sitting on <html>. Scripts and the
    // title after ours are neither here nor there, and the app appends those
    // all the time, so they must not count as a reason to move.
    var kids = head.children;
    var inPlace = true;
    var seenMine = false;
    for (var i = 0; inPlace && i < kids.length; i++) {
      var kid = kids[i];
      if (kid.getAttribute('data-cm-helper')) { seenMine = true; continue; }
      var isSheet = kid.tagName === 'STYLE' ||
        (kid.tagName === 'LINK' && /stylesheet/i.test(kid.getAttribute('rel') || ''));
      if (seenMine && isSheet) inPlace = false;
    }
    for (var m = 0; inPlace && m < mine.length; m++) {
      if (mine[m].parentNode !== head) inPlace = false;
    }
    if (inPlace) return;
    for (var k = 0; k < mine.length; k++) head.appendChild(mine[k]);
    log('moved ' + mine.length + ' helper sheets to the end of head');
  }

  // Each feature runs on its own, so one that throws on a version this code
  // has never seen cannot take the rest of the sweep down with it. Before this
  // one throw early in the sweep silently switched off everything after it,
  // on every sweep. A feature that keeps throwing is given up on for this page
  // load, and the console says so without needing debug on.
  var FEATURE_FAILURE_CAP = 3;
  var featureFailures = {};

  function runFeature(name, fn) {
    var failed = featureFailures[name] || 0;
    if (failed >= FEATURE_FAILURE_CAP) return;
    try {
      fn();
      featureFailures[name] = 0;
    } catch (e) {
      failed++;
      featureFailures[name] = failed;
      console.warn(TAG, name + ' failed' +
        (failed >= FEATURE_FAILURE_CAP ? ', giving up on it for this page load' : ''), e);
    }
  }

  var sweepQueued = false;

  function sweep() {
    sweepQueued = false;
    // First, before any sheet is rebuilt: a move re-parses a sheet, and so
    // does a rebuild, so moving first means the dark sheet is parsed once. A
    // sheet made later in this sweep is appended at the end regardless.
    runFeature('sheetOrder', keepHelperSheetsLast);
    if (CONFIG.scaleCss) runFeature('scaleCss', applyCssScaling);
    runFeature('pinnedMenu', applyPinnedMenu);
    runFeature('listFilters', applyListFilters);
    runFeature('templateUsage', applyTemplateUsage);
    runFeature('bypassUsage', applyBypassUsage);
    runFeature('filePicker', applyFilePicker);
    runFeature('userMenu', installUserMenuItem);
    runFeature('welcome', welcomeOnce);
    runFeature('fonts', watchFonts);
    runFeature('searchBox', decorateSearchBox);
    runFeature('darkMode', refreshDark);
    runFeature('signIn', function () {
      // Off means off: the poll has to be stopped, not just left unstarted.
      updateSignInWatch(CONFIG.fixSignIn && !!document.querySelector(SIGNIN_BUTTON));
    });
    runFeature('hostTitle', function () {
      watchTitle();
      syncHostTitle();
    });
    runFeature('hostBadge', function () {
      updateHostBadge(!!document.querySelector(SIGNIN_BUTTON));
    });
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
    // Ignore the helper's own nodes, coming or going, so the sweep cannot
    // re-trigger itself. Teardown and the sheet re-ordering both remove them.
    function isHelperNode(n) {
      return n.nodeType === 1 && !!n.getAttribute && !!n.getAttribute('data-cm-helper');
    }
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var k = 0; k < added.length; k++) {
          if (isHelperNode(added[k])) continue;
          queueSweep();
          return;
        }
        var removed = records[i].removedNodes;
        for (var r = 0; r < removed.length; r++) {
          if (isHelperNode(removed[r])) continue;
          queueSweep();
          return;
        }
      }
    }).observe(root, { childList: true, subtree: true });
  }

  loadConfig();

  if (CONFIG.scaleJquery) installJqueryPatch();
  if (CONFIG.scaleWebAnimations) patchWebAnimations();
  if (CONFIG.scaleTimeouts) patchTimeouts();

  // Always listening, and gated inside. Installing these from the config would
  // mean the switch only took effect after a reload.
  document.addEventListener('input', onValueEvent, true);
  document.addEventListener('change', onValueEvent, true);
  document.addEventListener('keydown', onKeyDown, true);

  darkOn = !!CONFIG.darkMode;

  // The full dark sheet needs the app's stylesheets, which have not been
  // parsed at document-start. The base rules alone are enough to keep the
  // first paint dark instead of flashing white until DOMContentLoaded.
  if (darkOn && (document.head || document.documentElement)) {
    darkEl = makeStyle(DARK_ID);
    darkEl.textContent = darkBaseTop();
  }

  function start() {
    if (darkOn) setDark(true, false);
    sweep();
  }

  observe();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    // The script is meant to run at document-start, but a userscript manager can
    // be late and the extension can be installed into a page that is already
    // open. Waiting for an event that has been and gone left dark mode off.
    start();
  }
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
    // The pure helpers, reachable from test/ without a browser. Not an API:
    // anything here can change between versions.
    _internals: {
      scale: scale,
      scaleTimeList: scaleTimeList,
      sameShape: sameShape,
      cssValue: cssValue,
      parseHotkey: parseHotkey,
      matchesHotkey: matchesHotkey,
      hotkeyLabel: hotkeyLabel,
      normalizeLabel: normalizeLabel,
      textToOverrides: textToOverrides,
      overridesToText: overridesToText,
      parseRgb: parseRgb,
      hexToRgb: hexToRgb,
      hslToRgb: hslToRgb,
      recolour: recolour,
      recolourGradient: recolourGradient,
      recolourColourList: recolourColourList,
      colourFromValue: colourFromValue,
      byName: byName,
      usageClauses: usageClauses,
      usageCountPath: usageCountPath,
      bypassPath: bypassPath,
      bypassKey: bypassKey,
      USAGE_KINDS: USAGE_KINDS,
      onTemplateList: onTemplateList,
      usageKind: usageKind,
      syncHostTitle: syncHostTitle,
      runFeature: runFeature,
      sweep: sweep
    },
    // In the page console on a screen that still looks wrong:
    //   copy(streamliner.auditDark())
    auditDark: function () {
      var out = ['streamliner ' + VERSION + ' dark audit on ' + location.host + location.hash];
      out.push('dark on: ' + darkOn + ', override sheet: ' +
               (darkEl ? darkEl.textContent.length + ' chars, disabled=' + darkEl.disabled : 'none'));
      out.push('stylesheets: ' + document.styleSheets.length + ', built at ' + darkBuiltAt);

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
