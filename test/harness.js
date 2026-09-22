'use strict';

// Loads streamliner.user.js into a bare stand-in for a browser window, so the
// pure helpers and the startup path can be exercised from Node with nothing
// installed. The stand-in answers every DOM query with "nothing there": no
// rows, no sheets, no sign-in form. Anything that needs real layout or real
// stylesheets stays a live test in Chrome.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.join(__dirname, '..', 'streamliner.user.js');

function element(tag) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    attributes: {},
    textContent: '',
    className: '',
    id: '',
    disabled: false,
    isConnected: true,
    parentNode: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) {
      this.children = this.children.filter((x) => x !== c);
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    getContext() { return null; },
    closest() { return null; }
  };
}

// opts.storage: what localStorage holds before the script runs.
// opts.hash, opts.host, opts.platform: what location and navigator report.
function load(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const timers = [];
  const warnings = [];

  const documentElement = element('html');
  const head = element('head');
  const body = element('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const document = {
    documentElement,
    head,
    body,
    baseURI: 'https://' + (opts.host || 'cm.example') + '/ContentManager/',
    readyState: 'complete',
    title: '',
    styleSheets: [],
    createElement: element,
    createTextNode(text) { return { nodeType: 3, textContent: text }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
  };

  const window = {
    document,
    location: {
      host: opts.host || 'cm.example',
      pathname: '/ContentManager/',
      hash: opts.hash || '#dashboard'
    },
    navigator: { platform: opts.platform || 'MacIntel', userAgent: '' },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    // Recorded, never run. The script's own delayed sweeps would otherwise
    // keep the process alive for three seconds after every load.
    setTimeout(fn, ms) {
      timers.push({ fn, ms, args: Array.prototype.slice.call(arguments, 2) });
      return timers.length;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} },
    // A web API, not a JS builtin, so a vm context does not get it for free.
    URL,
    CSSRule: { STYLE_RULE: 1, IMPORT_RULE: 3, MEDIA_RULE: 4, SUPPORTS_RULE: 12 },
    console: {
      log() {},
      warn() { warnings.push(Array.prototype.slice.call(arguments)); },
      error() {}
    }
  };
  window.window = window;
  window.self = window;

  const context = vm.createContext(window);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), context, { filename: 'streamliner.user.js' });

  return {
    window,
    document,
    store,
    timers,
    warnings,
    streamliner: window.streamliner,
    internals: window.streamliner._internals
  };
}

module.exports = { load, SOURCE };
