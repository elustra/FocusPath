// ============================================================
// FocusPath — Accessibility Authoring Plugin for Figma
// code.js  — Main Plugin Thread
// Elustra 2026 | Mithil Mogare
// ============================================================
// FIX: documentAccess:"dynamic-page" requires getNodeByIdAsync
// everywhere. All node resolution is now async/await.
// ============================================================

figma.showUI(__html__, { width: 560, height: 640, themeColors: false });

var PLUGIN_KEY     = 'focuspath';
var THREAD_COLOR   = { r: 0.18, g: 0.43, b: 0.98 };
var WCAG_AA_NORMAL = 4.5;
var WCAG_AA_LARGE  = 3.0;

// ── INIT ──────────────────────────────────────────────────────────────────────
sendSelectionInfo();
figma.on('selectionchange', sendSelectionInfo);

// ── MESSAGE ROUTER ────────────────────────────────────────────────────────────
figma.ui.onmessage = function (msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'get-selection':
      sendSelectionInfo();
      break;
    case 'draw-focus-thread':
      drawFocusThread(msg.nodeIds, msg.options);
      break;
    case 'clear-focus-thread':
      clearTagged('focus-thread');
      figma.ui.postMessage({ type: 'success', text: 'Focus thread cleared.' });
      break;
    case 'collect-narrator-text':
      collectNarratorText(msg.nodeIds);
      break;
    case 'check-contrast':
      checkContrast(msg.nodeIds);
      break;
    case 'heal-contrast':
      healContrast(msg.nodeId, msg.targetRatio);
      break;
    case 'save-aria':
      saveAriaLabel(msg.nodeId, msg.ariaData);
      break;
    case 'get-aria':
      getAriaLabel(msg.nodeId);
      break;
    case 'export-aria-json':
      exportAriaJson();
      break;
    case 'clear-all-aria':
      clearAllAria();
      break;
    case 'close':
      figma.closePlugin();
      break;
  }
};

// ── SAFE PLUGIN DATA ──────────────────────────────────────────────────────────
function safeGet(node, suffix) {
  try { return node.getPluginData(PLUGIN_KEY + suffix) || ''; } catch (e) { return ''; }
}
function safeSet(node, suffix, val) {
  try { node.setPluginData(PLUGIN_KEY + suffix, val); } catch (e) {}
}
function tagNode(node, tag) { safeSet(node, ':tag', tag); }

function clearTagged(tag) {
  var all = figma.currentPage.findAll(function (n) {
    return safeGet(n, ':tag') === tag;
  });
  for (var i = 0; i < all.length; i++) {
    try { all[i].remove(); } catch (e) {}
  }
}

// ── SELECTION ─────────────────────────────────────────────────────────────────
function sendSelectionInfo() {
  var sel   = figma.currentPage.selection;
  var items = sel.map(function (n) {
    var bb = n.absoluteBoundingBox;
    return {
      id:        n.id,
      name:      n.name,
      type:      n.type,
      ariaLabel: safeGet(n, ':aria'),
      ariaRole:  safeGet(n, ':role'),
      width:     bb ? Math.round(bb.width)  : 0,
      height:    bb ? Math.round(bb.height) : 0
    };
  });
  figma.ui.postMessage({ type: 'selection-update', count: sel.length, items: items });
}

// ── FONTS ─────────────────────────────────────────────────────────────────────
function loadInter() {
  return Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  ]);
}

// ── GEOMETRY ──────────────────────────────────────────────────────────────────
function getCentre(node) {
  var b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — FOCUS MAPPER
// ══════════════════════════════════════════════════════════════════════════════
async function drawFocusThread(nodeIds, options) {
  if (!nodeIds || nodeIds.length === 0) {
    figma.ui.postMessage({ type: 'error', text: 'No layers provided.' });
    return;
  }

  // ✅ FIX: use getNodeByIdAsync (required with documentAccess: dynamic-page)
  var nodes = [];
  for (var i = 0; i < nodeIds.length; i++) {
    var n = await figma.getNodeByIdAsync(nodeIds[i]);
    if (n) nodes.push(n);
  }
  if (nodes.length === 0) {
    figma.ui.postMessage({ type: 'error', text: 'Could not resolve layers.' });
    return;
  }

  clearTagged('focus-thread');

  var color     = (options && options.color) ? hexToRgb(options.color) : THREAD_COLOR;
  var badgeSize = 22;
  var centres   = nodes.map(function (nd) { return getCentre(nd); });

  // Lines first (badges drawn on top after font load)
  for (var j = 0; j < nodes.length - 1; j++) {
    var c1 = centres[j], c2 = centres[j + 1];
    if (!c1 || !c2) continue;
    var dx = c2.x - c1.x, dy = c2.y - c1.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;
    var angle = Math.atan2(dy, dx) * (180 / Math.PI);

    var line = figma.createLine();
    line.x = c1.x; line.y = c1.y;
    line.rotation    = -angle;
    line.resize(len, 0);
    line.strokes      = [{ type: 'SOLID', color: color, opacity: 0.7 }];
    line.strokeWeight = 2;
    line.dashPattern  = [6, 4];
    line.strokeCap    = 'ROUND';
    line.name         = 'FocusPath · Thread Line';
    tagNode(line, 'focus-thread');
    figma.currentPage.appendChild(line);
  }

  try {
    await loadInter();
  } catch (err) {
    figma.ui.postMessage({ type: 'error', text: 'Font load failed: ' + String(err) });
    return;
  }

  for (var k = 0; k < nodes.length; k++) {
    var c = centres[k];
    if (!c) continue;

    var badge = figma.createEllipse();
    badge.resize(badgeSize, badgeSize);
    badge.x = c.x - badgeSize / 2;
    badge.y = c.y - badgeSize / 2;
    badge.fills        = [{ type: 'SOLID', color: color }];
    badge.strokes      = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    badge.strokeWeight = 2;
    badge.strokeAlign  = 'OUTSIDE';
    badge.name         = 'FocusPath · Badge ' + (k + 1);
    tagNode(badge, 'focus-thread');
    figma.currentPage.appendChild(badge);

    var txt = figma.createText();
    txt.fontName            = { family: 'Inter', style: 'Bold' };
    txt.characters          = String(k + 1);
    txt.fontSize            = 11;
    txt.fills               = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    txt.textAlignHorizontal = 'CENTER';
    txt.textAlignVertical   = 'CENTER';
    txt.resize(badgeSize, badgeSize);
    txt.x    = c.x - badgeSize / 2;
    txt.y    = c.y - badgeSize / 2;
    txt.name = 'FocusPath · Step ' + (k + 1);
    tagNode(txt, 'focus-thread');
    figma.currentPage.appendChild(txt);
  }

  for (var m = 0; m < nodes.length; m++) {
    safeSet(nodes[m], ':focus-order', String(m + 1));
  }

  figma.ui.postMessage({ type: 'success', text: 'Focus thread drawn for ' + nodes.length + ' layer(s).' });
  figma.ui.postMessage({ type: 'focus-thread-done', count: nodes.length });
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — AUDIO NARRATOR  (speech runs entirely in UI thread)
// ══════════════════════════════════════════════════════════════════════════════
async function collectNarratorText(nodeIds) {
  var ids = nodeIds;
  if (!ids || ids.length === 0) {
    ids = figma.currentPage.selection.map(function (n) { return n.id; });
  }
  if (ids.length === 0) {
    figma.ui.postMessage({ type: 'error', text: 'Select layers or a frame to narrate.' });
    return;
  }

  var entries = [];
  function walk(n) {
    var ariaLabel = safeGet(n, ':aria');
    var ariaRole  = safeGet(n, ':role');
    var order     = safeGet(n, ':focus-order');
    var text      = (n.type === 'TEXT') ? (n.characters || '') : '';
    var label     = ariaLabel || text || '';
    if (label.trim()) {
      entries.push({
        order: order ? parseInt(order, 10) : 9999,
        label: label.trim(),
        role:  ariaRole || inferRole(n),
        name:  n.name
      });
    }
    if ('children' in n) {
      for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
    }
  }

  // ✅ FIX: use getNodeByIdAsync
  for (var i = 0; i < ids.length; i++) {
    var node = await figma.getNodeByIdAsync(ids[i]);
    if (node) walk(node);
  }

  entries.sort(function (a, b) { return a.order - b.order; });
  figma.ui.postMessage({ type: 'narrator-text-ready', entries: entries });
}

function inferRole(node) {
  var nm = node.name.toLowerCase();
  if (nm.indexOf('button') > -1 || nm.indexOf('btn') > -1)       return 'button';
  if (nm.indexOf('input')  > -1 || nm.indexOf('field') > -1)     return 'input';
  if (nm.indexOf('heading') > -1 || nm.indexOf('title') > -1)    return 'heading';
  if (nm.indexOf('image')  > -1 || nm.indexOf('icon')  > -1)     return 'image';
  if (nm.indexOf('link')   > -1)                                  return 'link';
  if (nm.indexOf('checkbox') > -1)                                return 'checkbox';
  if (nm.indexOf('toggle')   > -1)                                return 'switch';
  return '';
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — CONTRAST HEALER
// ══════════════════════════════════════════════════════════════════════════════
async function checkContrast(nodeIds) {
  var ids = nodeIds;
  if (!ids || ids.length === 0) {
    ids = figma.currentPage.selection.map(function (n) { return n.id; });
  }
  if (ids.length === 0) {
    figma.ui.postMessage({ type: 'contrast-results', results: [], message: 'Select layers to scan.' });
    return;
  }

  var results = [];
  // ✅ FIX: use getNodeByIdAsync
  for (var i = 0; i < ids.length; i++) {
    var node = await figma.getNodeByIdAsync(ids[i]);
    if (node) scanNode(node, results);
  }
  figma.ui.postMessage({ type: 'contrast-results', results: results });
}

function scanNode(node, results) {
  if (node.type === 'TEXT') {
    var fg = getSolidFill(node.fills);
    var bg = findBgFill(node);
    if (fg && bg) {
      var ratio     = contrastRatio(fg, bg);
      var fontSize  = (typeof node.fontSize === 'number') ? node.fontSize : 16;
      var bold      = (typeof node.fontWeight === 'number') ? node.fontWeight >= 700 : false;
      var isLarge   = fontSize >= 18 || (bold && fontSize >= 14);
      var threshold = isLarge ? WCAG_AA_LARGE : WCAG_AA_NORMAL;
      results.push({
        id:        node.id,
        name:      node.name,
        ratio:     Math.round(ratio * 100) / 100,
        passes:    ratio >= threshold,
        threshold: threshold,
        isLarge:   isLarge,
        textColor: rgbToHex(fg),
        bgColor:   rgbToHex(bg),
        fontSize:  Math.round(fontSize)
      });
    }
  }
  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      scanNode(node.children[i], results);
    }
  }
}

async function healContrast(nodeId, targetRatio) {
  // ✅ FIX: use getNodeByIdAsync
  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== 'TEXT') {
    figma.ui.postMessage({ type: 'error', text: 'Text node not found.' });
    return;
  }
  var fg = getSolidFill(node.fills);
  var bg = findBgFill(node);
  if (!fg || !bg) {
    figma.ui.postMessage({ type: 'error', text: 'Cannot determine fill pair.' });
    return;
  }
  var target = targetRatio || WCAG_AA_NORMAL;
  var healed = findHealedColor(fg, bg, target);
  if (!healed) {
    figma.ui.postMessage({ type: 'error', text: 'Could not find a compliant colour.' });
    return;
  }
  var newFills = [];
  for (var i = 0; i < node.fills.length; i++) {
    var f = node.fills[i];
    newFills.push(f.type === 'SOLID'
      ? { type: 'SOLID', color: healed, opacity: (f.opacity !== undefined ? f.opacity : 1) }
      : f);
  }
  node.fills = newFills;
  var newRatio = contrastRatio(healed, bg);
  figma.ui.postMessage({
    type: 'heal-applied',
    nodeId: nodeId,
    newColor: rgbToHex(healed),
    ratio: Math.round(newRatio * 100) / 100
  });
  figma.ui.postMessage({
    type: 'success',
    text: 'Healed → ' + Math.round(newRatio * 100) / 100 + ':1 on "' + node.name + '"'
  });
}

function findBgFill(node) {
  var cur = node.parent;
  while (cur && cur.type !== 'PAGE') {
    if ('fills' in cur) {
      var f = getSolidFill(cur.fills);
      if (f) return f;
    }
    cur = cur.parent;
  }
  return { r: 1, g: 1, b: 1 };
}

function getSolidFill(fills) {
  if (!fills || typeof fills === 'symbol' || !fills.length) return null;
  for (var i = 0; i < fills.length; i++) {
    if (fills[i].type === 'SOLID' && fills[i].visible !== false) return fills[i].color;
  }
  return null;
}

function relativeLuminance(rgb) {
  function lin(c) {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

function contrastRatio(fg, bg) {
  var L1 = relativeLuminance(fg);
  var L2 = relativeLuminance(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

function findHealedColor(fg, bg, target) {
  // Try darkening text first
  for (var s = 0; s <= 200; s++) {
    var f = 1 - s * 0.005;
    var c = { r: fg.r * f, g: fg.g * f, b: fg.b * f };
    if (contrastRatio(c, bg) >= target) return c;
  }
  // Try lightening text
  for (var s2 = 0; s2 <= 200; s2++) {
    var f2 = s2 * 0.005;
    var c2 = {
      r: fg.r + (1 - fg.r) * f2,
      g: fg.g + (1 - fg.g) * f2,
      b: fg.b + (1 - fg.b) * f2
    };
    if (contrastRatio(c2, bg) >= target) return c2;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — ARIA STICKY NOTES
// ══════════════════════════════════════════════════════════════════════════════
async function saveAriaLabel(nodeId, ariaData) {
  // ✅ FIX: use getNodeByIdAsync
  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    figma.ui.postMessage({ type: 'error', text: 'Layer not found.' });
    return;
  }
  safeSet(node, ':aria',        ariaData.label       || '');
  safeSet(node, ':role',        ariaData.role        || '');
  safeSet(node, ':description', ariaData.description || '');
  safeSet(node, ':hidden',      ariaData.hidden ? '1' : '0');
  figma.ui.postMessage({ type: 'success',    text: 'ARIA saved to "' + node.name + '"' });
  figma.ui.postMessage({ type: 'aria-saved', nodeId: nodeId });
}

async function getAriaLabel(nodeId) {
  // ✅ FIX: use getNodeByIdAsync
  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    figma.ui.postMessage({ type: 'aria-data', nodeId: nodeId, data: null });
    return;
  }
  figma.ui.postMessage({
    type:   'aria-data',
    nodeId: nodeId,
    data: {
      label:       safeGet(node, ':aria'),
      role:        safeGet(node, ':role'),
      description: safeGet(node, ':description'),
      hidden:      safeGet(node, ':hidden') === '1'
    }
  });
}

function exportAriaJson() {
  // findAll is synchronous — no getNodeById needed here
  var all = figma.currentPage.findAll(function (n) {
    return safeGet(n, ':aria') !== '';
  });
  var out = {};
  for (var i = 0; i < all.length; i++) {
    var n   = all[i];
    var ord = safeGet(n, ':focus-order');
    out[n.name] = {
      'aria-label':       safeGet(n, ':aria'),
      'role':             safeGet(n, ':role'),
      'aria-description': safeGet(n, ':description'),
      'aria-hidden':      safeGet(n, ':hidden') === '1',
      'tabIndex':         ord ? parseInt(ord, 10) : undefined
    };
  }
  figma.ui.postMessage({
    type:  'aria-json-ready',
    json:  JSON.stringify(out, null, 2),
    count: all.length
  });
}

function clearAllAria() {
  var all = figma.currentPage.findAll(function (n) {
    return safeGet(n, ':aria') !== '' || safeGet(n, ':role') !== '';
  });
  for (var i = 0; i < all.length; i++) {
    safeSet(all[i], ':aria',        '');
    safeSet(all[i], ':role',        '');
    safeSet(all[i], ':description', '');
    safeSet(all[i], ':hidden',      '');
  }
  figma.ui.postMessage({ type: 'success', text: 'All ARIA data cleared.' });
}

// ── COLOUR UTILS ──────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  var h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
}

function rgbToHex(rgb) {
  function ch(v) {
    var x = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
    return x.length === 1 ? '0' + x : x;
  }
  return '#' + ch(rgb.r) + ch(rgb.g) + ch(rgb.b);
}
