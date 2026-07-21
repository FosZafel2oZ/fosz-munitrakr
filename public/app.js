"use strict";

/* ---------------- State ---------------- */
const PREFS_KEY = "fin_prefs";
const STORE_KEY = "fin_store"; // offline data lives here (this device only)
const APP_VERSION = "v76"; // keep in step with sw.js CACHE
// Label used as both the donut slice AND the list-filter key for records
// without a subcategory — single constant so the two can't drift apart.
const NO_SUB_LABEL = "No Sub-category";
let displayName = "Me";
let records = [];
let settings = { expense: [], investment: [] };
let currentView = "dashboard";
let activeType = "expense"; // dashboard active type
let range = { type: "month", offset: 0, start: null, end: null };
let drillCategory = null;
let selectedSlice = null; // first-tap selected category/sub on the donut
let lastDrillable = {}; // categories that have sub-categories (for 2nd-tap drill)
let chart = null;
let editingId = null;
let modalType = "expense";
let pendingNew = null; // [{kind, type, category, name}] awaiting colour pick
let selected = new Set();
let settingsDraft = null;
let catTypeTab = "expense";
const openCats = new Set(); // category ids whose sub-list is expanded

/* ---- DebtTrakr mode state ----
   Not persisted. Every fresh boot starts in MuniTrakr. */
let currentMode = "finance"; // "finance" | "debt"

/* ---- Recurring rules runtime state ---- */
let pendingConfirmations = []; // [{ ruleId, dueDate, rule }] — derived, not persisted
let recurringProcessedThisBoot = false;

const FALLBACK = [
  "#7c5cff","#00d2b4","#ff6b81","#ffb84d","#4dabff",
  "#b06bff","#3ddc97","#ff8fa3","#ffd166","#5cd0ff",
];

/* Curated vector icon set (white on the category colour) */
const ICONS = {
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  food: '<path d="M6 3v7a2 2 0 0 0 4 0V3M8 11v10M17 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9"/>',
  cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21.5 7H6"/>',
  car: '<path d="M5 13l1.6-4.7A2 2 0 0 1 8.5 7h7a2 2 0 0 1 1.9 1.3L19 13v5h-3v-2H8v2H5z"/><circle cx="7.5" cy="15.5" r="1.2"/><circle cx="16.5" cy="15.5" r="1.2"/>',
  home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  plane: '<path d="M21 3L3 10l7 3 3 7z"/>',
  book: '<path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H20V3H7.5A2.5 2.5 0 0 0 5 5.5z"/>',
  chart: '<path d="M3 17l6-6 4 4 8-8"/><path d="M16 7h5v5"/>',
  bitcoin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8h4a2 2 0 0 1 0 4h-4zM9.5 12h4.5a2 2 0 0 1 0 4h-4.5zM10.5 8V6M10.5 18v-2M13 8V6M13 18v-2"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h.5M14.5 7h.5M9 11h.5M14.5 11h.5M9 15h.5M14.5 15h.5M10 21v-3h4v3"/>',
  piggy: '<path d="M4 13a8 5.5 0 1 1 16 0 8 5.5 0 0 1-16 0z"/><path d="M9 7.5l1-2h4l1 2M6 18v2M16 18v2M20 11.5h1.5"/><circle cx="15.5" cy="11" r="1"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v3"/><path d="M3 6v13a2 2 0 0 0 2 2h15V8H5"/><circle cx="17" cy="14" r="1.5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9"/><path d="M12 8v13"/><path d="M12 8C11 4 8 4 7.5 5.5 7 7 9.5 8 12 8zM12 8c1-4 4-4 4.5-2.5C17 7 14.5 8 12 8z"/>',
  coffee: '<path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 9h2a2 2 0 0 1 0 6h-2"/><path d="M7 2v2M11 2v2M15 2v2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3 5.2 2 2 0 0 1 5 3h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L9 11a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/>',
  wifi: '<path d="M5 12.6a11 11 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>',
  dumbbell: '<path d="M2 12h2M20 12h2M5 9v6M19 9v6M8 7v10M16 7v10M8 12h8"/>',
  pill: '<path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7z"/><path d="M8.5 8.5l7 7"/>',
  music: '<path d="M9 18V5l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="15" r="3"/>',
  gamepad: '<path d="M7 9h10a4 4 0 0 1 4 4 4 4 0 0 1-7 2.5H10A4 4 0 0 1 3 13a4 4 0 0 1 4-4z"/><path d="M8 12v2M7 13h2M15.5 12.5h.1M17.5 14.5h.1"/>',
  dollar: '<path d="M12 2v20M16.5 6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7"/>',
  droplet: '<path d="M12 3S6 9.5 6 14a6 6 0 0 0 12 0c0-4.5-6-11-6-11z"/>',
  star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2.5-1.5L9 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6"/>',
};
const ICON_IDS = Object.keys(ICONS);
function iconSvg(id, cls) {
  return (
    `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${ICONS[id] || ICONS.tag}</svg>`
  );
}

// People-icon library — separate from the category ICONS map. Used by the
// Settings People section and the DebtTrakr "Who" picker.
const PEOPLE_ICONS = {
  // Generic / age silhouettes
  person:    '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  man:       '<circle cx="12" cy="7" r="3.5"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/>',
  woman:     '<circle cx="12" cy="6.5" r="3"/><path d="M8 21l1.5-8h5L16 21M9.5 13l2.5 5 2.5-5"/>',
  boy:       '<circle cx="12" cy="7" r="2.8"/><path d="M9 5h6"/><path d="M7 21v-5a5 5 0 0 1 10 0v5"/>',
  girl:      '<circle cx="12" cy="7" r="2.8"/><path d="M9.5 5q-1.5 .5-2 2M14.5 5q1.5 .5 2 2"/><path d="M8 21l1.5-7h5L16 21M9.5 14l2.5 3 2.5-3"/>',
  child:     '<circle cx="12" cy="9" r="3"/><path d="M7 21v-4a5 5 0 0 1 10 0v4"/><path d="M10 9.5h.1M14 9.5h.1"/>',
  elder:     '<circle cx="12" cy="8" r="3.5"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 8.5h.1M14.5 8.5h.1M10 11.5q2 1 4 0"/>',
  // Gender symbols
  female:    '<circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 18h6"/>',
  male:      '<circle cx="10" cy="14" r="5"/><path d="M14 10l6-6M16 4h4v4"/>',
  nb:        '<circle cx="12" cy="13" r="4.5"/><path d="M12 8.5V3M9.5 5h5M10 18.5h4"/>',
  // Relationships / groups
  mother:    '<circle cx="8" cy="6.5" r="2.5"/><path d="M5 21l1.2-7h3.6L11 21M6.5 14l1.5 3 1.5-3"/><circle cx="17" cy="13" r="1.8"/><path d="M14 21v-4a3 3 0 0 1 6 0v4"/>',
  father:    '<circle cx="8" cy="6.5" r="2.5"/><path d="M4.5 21v-5a3.5 3.5 0 0 1 7 0v5"/><circle cx="17" cy="13" r="1.8"/><path d="M14 21v-4a3 3 0 0 1 6 0v4"/>',
  couple:    '<circle cx="8" cy="7.5" r="2.8"/><circle cx="16" cy="7.5" r="2.8"/><path d="M3 21v-3a4.5 4.5 0 0 1 9 0v3M12 21v-3a4.5 4.5 0 0 1 9 0v3"/>',
  family:    '<circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="7" r="2.6"/><circle cx="12" cy="14" r="2"/><path d="M3 18v-2.5a3.5 3.5 0 0 1 7 0V18M14 18v-2.5a3.5 3.5 0 0 1 7 0V18M9.5 21v-2a2.5 2.5 0 0 1 5 0v2"/>',
  friend:    '<circle cx="7" cy="8" r="2.8"/><circle cx="17" cy="8" r="2.8"/><path d="M3 21v-3a4.4 4.4 0 0 1 8 0M13 21v-3a4.4 4.4 0 0 1 8 0M11 12.5l1 1.5 1-1.5a1.4 1.4 0 1 0-2 0z"/>',
  // Occupations
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  graduation:'<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5M22 9v6"/>',
  chef:      '<path d="M7 12h10v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/><path d="M7 12a3 3 0 0 1-3-3 3 3 0 0 1 4-2.8A3.5 3.5 0 0 1 12 4a3.5 3.5 0 0 1 4 2.2A3 3 0 0 1 20 9a3 3 0 0 1-3 3"/>',
  doctor:    '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M12 11v6M9 14h6"/>',
  worker:    '<path d="M3 18h18l-2-6a8 8 0 0 0-14 0z"/><path d="M11 4h2v4h-2zM3 18v2h18v-2"/>',
  // Tokens
  crown:     '<path d="M3 18h18M3 18l2-9 5 5 2-8 2 8 5-5 2 9"/>',
  star:      '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  heart:     '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1z"/>',
  paw:       '<circle cx="6" cy="11" r="1.8"/><circle cx="10" cy="7" r="1.8"/><circle cx="14" cy="7" r="1.8"/><circle cx="18" cy="11" r="1.8"/><path d="M7 19a5 5 0 0 1 10 0c0 1.5-1.5 2.5-5 2.5S7 20.5 7 19z"/>',
};
const PEOPLE_ICON_IDS = Object.keys(PEOPLE_ICONS);

function personIconSvg(id, cls) {
  const path = PEOPLE_ICONS[id] || PEOPLE_ICONS.person;
  return (
    '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    path +
    '</svg>'
  );
}

function catIcon(type, name) {
  const c = findCat(type, name);
  return (c && c.icon) || "tag";
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------- Preferences (persist across sessions) ---------------- */
function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        view: currentView === "settings" ? "dashboard" : currentView,
        activeType,
        range: {
          type: range.type,
          offset: range.offset,
          start: range.start,
          end: range.end,
        },
      })
    );
  } catch {}
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (!p) return;
    if (p.range) {
      range.type = p.range.type || "month";
      range.offset = p.range.offset || 0;
      range.start = p.range.start || null;
      range.end = p.range.end || null;
    }
    if (p.activeType) activeType = p.activeType;
    if (p.view) currentView = p.view;
  } catch {}
}

/* ---------------- Local store (offline, this device only) ---------------- */
const PALETTE = [
  "#7c5cff","#00d2b4","#ff6b81","#ffb84d","#4dabff",
  "#b06bff","#3ddc97","#ff8fa3","#ffd166","#5cd0ff",
  "#9b8cff","#2bb9a0","#e96e8a","#f0a93b","#6ba8ff",
];
const pickClr = (i) => PALETTE[i % PALETTE.length];
function defaultSettings() {
  const exp = [
    ["Food & Dining", ["Groceries","Restaurants","Coffee","Delivery"], "food"],
    ["Transport", ["Fuel","Public Transit","Taxi / Ride","Parking"], "car"],
    ["Housing", ["Rent","Mortgage","Maintenance","Furniture"], "home"],
    ["Utilities", ["Electricity","Water","Internet","Phone"], "bolt"],
    ["Shopping", ["Clothing","Electronics","Home","Gifts"], "cart"],
    ["Health", ["Pharmacy","Doctor","Fitness","Insurance"], "heart"],
    ["Entertainment", ["Streaming","Games","Events","Hobbies"], "film"],
    ["Travel", ["Flights","Hotels","Activities"], "plane"],
    ["Education", ["Courses","Books","Subscriptions"], "book"],
    ["Other", [], "tag"],
  ];
  const inv = [
    ["Stocks", ["Individual","ETF","Dividends"], "chart"],
    ["Crypto", ["Bitcoin","Ethereum","Altcoins"], "bitcoin"],
    ["Mutual Funds", ["Index","Active"], "briefcase"],
    ["Real Estate", ["Property","REIT"], "building"],
    ["Savings", ["Emergency Fund","High-Yield"], "piggy"],
    ["Retirement", ["401k","IRA","Pension"], "shield"],
    ["Other", [], "tag"],
  ];
  const rid = () => Math.random().toString(16).slice(2, 10);
  const build = (rows) =>
    rows.map(([name, subs, icon], i) => ({
      id: rid(), name, color: pickClr(i), icon: icon || "tag",
      subs: subs.map((s, j) => ({ id: rid(), name: s, color: pickClr(i + j + 3) })),
    }));
  return {
    theme: "default",
    headerIconFinance: null,
    headerIconDebt: null,
    defaultCurrency: "THB",
    debtShareLanguage: "en",
    currencies: ["THB", "USD", "EUR", "GBP", "INR", "PHP", "JPY", "AUD", "CAD"],
    expense: build(exp),
    investment: build(inv),
  };
}

// ECB reference-rate currencies — pairs where BOTH codes are in this set use
// Frankfurter; every other ISO currency converts via the currency-api fallback.
const ECB_CURRENCIES = new Set([
  "AUD","BGN","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP","HKD","HUF",
  "IDR","ILS","INR","ISK","JPY","KRW","MXN","MYR","NOK","NZD","PHP","PLN",
  "RON","SEK","SGD","THB","TRY","USD","ZAR",
]);
function isRealCurrency(code) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}
const isEcb = (c) => ECB_CURRENCIES.has(c);

let store = null;
function loadStore() {
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch { store = null; }
  if (!store || typeof store !== "object") store = {};
  if (!store.settings) store.settings = defaultSettings();
  if (!store.settings.theme) store.settings.theme = "default";
  if (!store.settings.defaultCurrency) store.settings.defaultCurrency = "THB";
  if (!store.settings.debtShareLanguage) store.settings.debtShareLanguage = "en";
  if (typeof store.settings.fxMarkupPct !== "number")
    store.settings.fxMarkupPct = 0;
  if (!Array.isArray(store.settings.currencies) || !store.settings.currencies.length)
    store.settings.currencies = [
      "THB", "USD", "EUR", "GBP", "INR", "PHP", "JPY", "AUD", "CAD",
    ];
  if (!store.settings.currencies.includes(store.settings.defaultCurrency))
    store.settings.currencies.unshift(store.settings.defaultCurrency);
  if (!Array.isArray(store.settings.recurring)) store.settings.recurring = [];
  if (!Array.isArray(store.settings.people)) store.settings.people = [];
  if (!Array.isArray(store.records)) store.records = [];
  if (!Array.isArray(store.debts)) store.debts = [];
  if (!store.profile) store.profile = { displayName: "Me" };

  // Header-icon split: an older version had a single `settings.headerIcon`.
  // Move it into the MuniTrakr-mode slot and clear the old field.
  if (store.settings.headerIcon !== undefined) {
    if (store.settings.headerIconFinance === undefined) {
      store.settings.headerIconFinance = store.settings.headerIcon;
    }
    delete store.settings.headerIcon;
  }
  if (store.settings.headerIconFinance === undefined) store.settings.headerIconFinance = null;
  if (store.settings.headerIconDebt === undefined) store.settings.headerIconDebt = null;

  // Migration: createdAt / updatedAt on records must be numeric ms — the
  // records-list sort tiebreaker uses (b.createdAt - a.createdAt). Records
  // generated by an old version of recurring.js wrote ISO strings, which
  // NaN'd the sort and pinned them to the top. Normalize legacy values.
  let migratedTimestamps = false;
  for (const r of store.records) {
    if (typeof r.createdAt === "string") {
      const t = Date.parse(r.createdAt);
      r.createdAt = Number.isFinite(t) ? t : 0;
      migratedTimestamps = true;
    }
    if (typeof r.updatedAt === "string") {
      const t = Date.parse(r.updatedAt);
      r.updatedAt = Number.isFinite(t) ? t : 0;
      migratedTimestamps = true;
    }
  }
  if (migratedTimestamps) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
  }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}

function setMode(next) {
  if (next !== "finance" && next !== "debt") return;
  if (next === currentMode) return;
  currentMode = next;
  // Topbar title text
  const title = next === "debt" ? "DebtTrakr" : "MuniTrakr";
  const helloEl = document.getElementById("helloName");
  if (helloEl) helloEl.textContent = title;
  // Header icon — swap to the per-mode source
  if (typeof applyHeaderIcon === "function") applyHeaderIcon();
  // Hide the dashboard confirm banner in debt mode (banner is MuniTrakr-only)
  const cb = document.getElementById("confirmBanner");
  if (cb) {
    const hasPending = typeof pendingConfirmations !== "undefined" && pendingConfirmations && pendingConfirmations.length;
    cb.classList.toggle("hidden", next === "debt" || !hasPending);
  }
  // Force a clean dashboard re-render in the new mode.
  if (typeof showView === "function") showView("dashboard");
}
const uid = () =>
  Date.now().toString(16) + Math.random().toString(16).slice(2, 8);

/* ---- FX conversion (frankfurter.dev + currency-api fallback, in-browser) ----
   Logic lives in public/finance-helpers.js (testable). Here we instantiate
   the service with browser-provided deps and expose getRate/attachConversion
   as the same globals existing call sites already use. */
const RATE_KEY = "fin_rates";
const _rateService = makeRateService({
  fetch: (...a) => fetch(...a),
  storage: localStorage,
  now: () => new Date(),
  isEcb,
  rateKey: RATE_KEY,
});
const getRate = _rateService.getRate;
// Single funnel for every conversion in the app — the global card-FX markup
// is injected here so no call site needs to know about it.
async function attachConversion(r, manualRate) {
  const s = store && store.settings;
  return _rateService.attachConversion(
    r, manualRate, s && s.defaultCurrency, (s && s.fxMarkupPct) || 0
  );
}

function sanitizeRecord(b) {
  const type = b.type === "investment" ? "investment" : "expense";
  const amount = Number(b.amount);
  return {
    category: String(b.category || "").trim(),
    subcategory: String(b.subcategory || "").trim(),
    date: String(b.date || "").slice(0, 10),
    amount: Number.isFinite(amount) ? amount : 0,
    currency: String(b.currency || "USD").trim().slice(0, 6),
    notes: String(b.notes || "").trim(),
    type,
  };
}

// Propagate category/sub-category renames is implemented in
// public/finance-helpers.js as reconcileRenames(oldS, newS, records).
// Call sites in this file pass store.records explicitly (see line ~267).

/* api(): same call sites as before, now backed by localStorage (no server) */
async function api(path, method = "GET", body) {
  loadStore();
  // ----- profile -----
  if (path === "/me") {
    return { displayName: store.profile.displayName, settings: store.settings };
  }
  if (path === "/account" && method === "PUT") {
    if (typeof body.displayName === "string" && body.displayName.trim())
      store.profile.displayName = body.displayName.trim().slice(0, 40);
    saveStore();
    return { displayName: store.profile.displayName };
  }
  // ----- settings -----
  if (path === "/settings" && method === "PUT") {
    // Renaming a category/sub in settings must rename it on existing records
    // (records store names as strings; categories are matched by id here).
    reconcileRenames(store.settings, body, store.records);
    store.settings = body;
    if (!store.settings.defaultCurrency) store.settings.defaultCurrency = "THB";
    if (!Array.isArray(store.settings.currencies) || !store.settings.currencies.length)
      store.settings.currencies = [store.settings.defaultCurrency];
    if (!store.settings.currencies.includes(store.settings.defaultCurrency))
      store.settings.currencies.unshift(store.settings.defaultCurrency);
    saveStore();
    return store.settings;
  }
  // ----- records -----
  if (path === "/records" && method === "GET") {
    return store.records
      .slice()
      .sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        // Same-day tiebreak: newest createdAt first. Coerce to numeric ms so
        // any stray string survivor still sorts correctly.
        const ac = typeof a.createdAt === "number" ? a.createdAt : Date.parse(a.createdAt) || 0;
        const bc = typeof b.createdAt === "number" ? b.createdAt : Date.parse(b.createdAt) || 0;
        return bc - ac;
      });
  }
  if (path === "/records" && method === "POST") {
    const r = sanitizeRecord(body);
    await attachConversion(r, body.manualRate);
    const rec = { id: uid(), ...r, createdAt: Date.now(), updatedAt: Date.now() };
    store.records.push(rec);
    saveStore();
    return rec;
  }
  if (path.startsWith("/records/") && path !== "/records/bulk") {
    const id = path.slice("/records/".length);
    const idx = store.records.findIndex((x) => x.id === id);
    if (method === "DELETE") {
      if (idx > -1) store.records.splice(idx, 1);
      saveStore();
      return { ok: true };
    }
    if (method === "PUT") {
      if (idx === -1) throw new Error("Record not found");
      const r = sanitizeRecord(body);
      await attachConversion(r, body.manualRate);
      store.records[idx] = {
        ...store.records[idx], ...r, updatedAt: Date.now(),
        convertedAmount: r.convertedAmount,
        convertedCurrency: r.convertedCurrency,
        rate: r.rate, rateDate: r.rateDate,
        rateUnavailable: r.rateUnavailable,
        manualRate: r.manualRate,
      };
      saveStore();
      return store.records[idx];
    }
  }
  if (path === "/records/bulk" && method === "POST") {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (body.action === "delete") {
      store.records = store.records.filter((r) => !ids.includes(r.id));
    } else if (body.action === "update") {
      const patch = {};
      if (typeof body.category === "string" && body.category.trim())
        patch.category = body.category.trim();
      if (typeof body.subcategory === "string")
        patch.subcategory = body.subcategory.trim();
      if (body.type === "expense" || body.type === "investment")
        patch.type = body.type;
      store.records.forEach((r) => {
        if (ids.includes(r.id)) Object.assign(r, patch, { updatedAt: Date.now() });
      });
    }
    saveStore();
    return { ok: true };
  }
  throw new Error("Unsupported operation");
}

/* ---------------- Settings helpers ---------------- */
function findCat(type, name) {
  return (settings[type] || []).find(
    (c) => c.name.toLowerCase() === String(name).toLowerCase()
  );
}
function catColor(type, name) {
  const c = findCat(type, name);
  if (c) return c.color;
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
function subColor(type, catName, subName) {
  const c = findCat(type, catName);
  const s = c && c.subs.find(
    (x) => x.name.toLowerCase() === String(subName).toLowerCase()
  );
  if (s) return s.color;
  if (subName === NO_SUB_LABEL) return "#3a4152";
  return catColor(type, catName);
}
function detectNew(type, category, subcategory) {
  const out = [];
  const cat = findCat(type, category);
  if (category && !cat)
    out.push({ kind: "cat", type, category, name: category });
  if (subcategory) {
    const exists =
      cat && cat.subs.some(
        (s) => s.name.toLowerCase() === subcategory.toLowerCase()
      );
    if (!exists)
      out.push({ kind: "sub", type, category, name: subcategory });
  }
  return out;
}
function applyNewToSettings(items, colors) {
  items.forEach((it, i) => {
    const color = colors[i];
    let cat = findCat(it.type, it.category);
    if (it.kind === "cat" && !cat) {
      settings[it.type].push({
        id: "c" + Date.now() + i,
        name: it.category,
        color,
        icon: "tag",
        subs: [],
      });
    } else if (it.kind === "sub") {
      if (!cat) {
        cat = {
          id: "c" + Date.now() + i,
          name: it.category,
          color: FALLBACK[0],
          icon: "tag",
          subs: [],
        };
        settings[it.type].push(cat);
      }
      cat.subs.push({ id: "s" + Date.now() + i, name: it.name, color });
    }
  });
}

/* ---------------- App init (no login — offline, on-device) ---------------- */
async function enterApp() {
  $("#app").classList.remove("hidden");
  $("#todayDate").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const me = await api("/me");
  settings = me.settings || { expense: [], investment: [] };
  applyTheme(settings.theme || "default");
  applyHeaderIcon();
  $("#helloName").textContent = "MuniTrakr";
  loadPrefs();
  if (range.type === "custom" && range.start && range.end) {
    $("#customStart").value = range.start;
    $("#customEnd").value = range.end;
  }
  showView(currentView);
  populateDatalists();
  // Show existing records ASAP — don't block first paint on processRecurring.
  await loadRecords();
  // Run recurring backfill in the background. If it generates anything new,
  // re-render the records list and the dashboard banner. Errors are
  // swallowed (they would be no-ops at the data layer anyway).
  (async () => {
    try {
      await processRecurring();
      if (pendingConfirmations.length || (store.records && store.records.length !== records.length)) {
        await loadRecords();
      }
      renderConfirmBanner();
    } catch (_e) { /* ignore — recurring failures should never block the UI */ }
  })();
}

/* ---- Recurring rules: generate due records on app boot ----
   Phase 1: walk every rule, decide which records would be auto-confirmed and
            which would land in the pending queue. Build all record drafts up
            front but DON'T call attachConversion yet.
   Phase 2: run attachConversion on every draft in parallel — for THB-only
            users this is a no-op; for multi-currency users this cuts startup
            from O(N) serial network calls to ~1 round-trip per unique date+pair.
   Phase 3: commit drafts to store.records, advance bookmarks, save once. */
async function processRecurring() {
  if (recurringProcessedThisBoot) return;
  recurringProcessedThisBoot = true;
  loadStore();
  const today = ymd(new Date());
  pendingConfirmations = [];

  const drafts = []; // [{ rec, rule, date }] — auto-confirm only
  for (const rule of (store.settings.recurring || [])) {
    if (rule.paused || !rule.cadence) continue;
    const dueDates = computeOccurrences(rule, today);
    if (!dueDates.length) continue;

    if (rule.autoConfirm) {
      for (const date of dueDates) {
        const rec = buildRecordFromRule(rule, date);
        drafts.push({ rec, rule, date });
      }
    } else {
      for (const date of dueDates) {
        pendingConfirmations.push({ ruleId: rule.id, dueDate: date, rule });
      }
    }
  }

  if (!drafts.length) return;

  // Phase 2 — parallel FX. Each attachConversion is independent (rateService
  // shares an in-memory + localStorage cache, so duplicate (date, pair)
  // requests collapse).
  await Promise.all(drafts.map(async (d) => {
    try { await attachConversion(d.rec); }
    catch (_e) { d.rec.rateUnavailable = true; }
  }));

  // Phase 3 — commit. Group by rule so end-checks apply correctly per-rule.
  const byRule = new Map();
  for (const d of drafts) {
    const arr = byRule.get(d.rule.id) || [];
    arr.push(d);
    byRule.set(d.rule.id, arr);
  }
  for (const [, list] of byRule) {
    // Sort by date ascending so applyEndChecks "stops at the cap" lands right.
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const d of list) {
      if (d.rule.paused) break; // applyEndChecks below may have paused mid-rule
      store.records.push(d.rec);
      d.rule.lastGeneratedDate = d.date;
      d.rule.occurrenceCount = (d.rule.occurrenceCount || 0) + 1;
      applyEndChecks(d.rule);
    }
  }
  saveStore();
}

async function loadRecords() {
  records = await api("/records");
  refresh();
}

/* ---------------- Time range ---------------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) =>
  d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday start
  return x;
}
const TYPE_LABEL = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  custom: "Custom range",
};
function rangeBounds() {
  const now = new Date();
  const t = range.type;
  const off = range.offset || 0;

  if (t === "custom") {
    if (range.start && range.end)
      return {
        from: range.start,
        to: range.end,
        label:
          fmtShort(range.start) + " – " + fmtShort(range.end),
      };
    return { from: "0000-01-01", to: "9999-12-31", label: "Custom range" };
  }

  if (t === "today") {
    const d = new Date(now);
    d.setDate(d.getDate() + off);
    const label =
      off === 0
        ? "Today"
        : off === -1
        ? "Yesterday"
        : off === 1
        ? "Tomorrow"
        : d.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          });
    return { from: ymd(d), to: ymd(d), label };
  }

  if (t === "week") {
    const s = startOfWeek(now);
    s.setDate(s.getDate() + off * 7);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    const label =
      off === 0
        ? "This Week"
        : off === -1
        ? "Last Week"
        : off === 1
        ? "Next Week"
        : s.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          " – " +
          e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { from: ymd(s), to: ymd(e), label };
  }

  if (t === "month") {
    const b = new Date(now.getFullYear(), now.getMonth() + off, 1);
    const e = new Date(b.getFullYear(), b.getMonth() + 1, 0);
    const label =
      off === 0
        ? "This Month"
        : b.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return { from: ymd(b), to: ymd(e), label };
  }

  // year
  const y = now.getFullYear() + off;
  return {
    from: y + "-01-01",
    to: y + "-12-31",
    label: off === 0 ? "This Year" : String(y),
  };
}
function fmtShort(s) {
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function inRange(r) {
  const { from, to } = rangeBounds();
  return r.date >= from && r.date <= to;
}

function updateRangeUI() {
  const { label } = rangeBounds();
  $("#rangeText").textContent = label;
  const isCustom = range.type === "custom";
  $("#rangeNav").classList.toggle("is-custom", isCustom);
  $("#customRange").classList.toggle("hidden", !isCustom);
  $("#fab").classList.toggle("fab-raised", isCustom);
  $("#multiBtn").classList.toggle("fab-raised", isCustom);
  $("#multiBar").classList.toggle("fab-raised", isCustom);
  $$("#rangeMenu button").forEach((b) =>
    b.classList.toggle("active", b.dataset.range === range.type)
  );
}

function setRangeType(type) {
  range.type = type;
  range.offset = 0;
  if (type === "custom" && !range.start) {
    const now = new Date();
    range.start = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    range.end = ymd(now);
    $("#customStart").value = range.start;
    $("#customEnd").value = range.end;
  }
  refresh();
}
function step(dir) {
  if (range.type === "custom") return;
  range.offset = (range.offset || 0) + dir;
  refresh();
}

$("#rangePrev").addEventListener("click", () => step(-1));
$("#rangeNext").addEventListener("click", () => step(1));
$("#rangeLabelBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#rangeMenu").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#rangeNav")) $("#rangeMenu").classList.add("hidden");
  if (!e.target.closest("#catPicker"))
    $("#catPickMenu") && $("#catPickMenu").classList.add("hidden");
  if (!e.target.closest("#subPicker"))
    $("#subPickMenu") && $("#subPickMenu").classList.add("hidden");
  if (!e.target.closest("#bulkCatPicker"))
    $("#bulkCatMenu") && $("#bulkCatMenu").classList.add("hidden");
  if (!e.target.closest("#bulkSubPicker"))
    $("#bulkSubMenu") && $("#bulkSubMenu").classList.add("hidden");
  if (
    !e.target.closest("#recFilterMenu") &&
    !e.target.closest("#recFilterBtn")
  )
    $("#recFilterMenu") && $("#recFilterMenu").classList.add("hidden");
  // Tapping anywhere outside the donut clears the selected slice — except the
  // recent-records list, which is filtered BY that selection (tapping a result
  // shouldn't clear the filter it came from).
  if (
    selectedSlice &&
    !e.target.closest("#donut") &&
    !e.target.closest("#dashRecordsList")
  ) {
    selectedSlice = null;
    refresh();
  }
});
$$("#rangeMenu button").forEach((b) =>
  b.addEventListener("click", () => {
    $("#rangeMenu").classList.add("hidden");
    setRangeType(b.dataset.range);
  })
);
$("#customApply").addEventListener("click", () => {
  range.start = $("#customStart").value;
  range.end = $("#customEnd").value;
  if (range.start && range.end && range.start > range.end)
    [range.start, range.end] = [range.end, range.start];
  refresh();
});

/* ---------------- Formatting ---------------- */
function fmt(n, cur) {
  const v = Number(n) || 0;
  const s = v.toLocaleString(undefined, {
    minimumFractionDigits: v % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return cur ? cur + " " + s : s;
}
function primaryCurrency(list) {
  const c = {};
  list.forEach((r) => (c[r.currency] = (c[r.currency] || 0) + 1));
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || "USD";
}
// amount/currency to use for totals + charts (converted to default when available)
function dispAmt(r) {
  return r.convertedAmount != null ? r.convertedAmount : r.amount;
}
function dispCur(r) {
  return r.convertedCurrency || r.currency;
}
function baseCur(list) {
  return (settings && settings.defaultCurrency) || primaryCurrency(list);
}
const sum = (l) => l.reduce((s, r) => s + dispAmt(r), 0);
// Year shown in the top totals = most recent year in the selected range
function selectedYear() {
  return rangeBounds().to.slice(0, 4);
}
// Total for a type across the WHOLE selected year (ignores narrower range)
function yearTotal(type) {
  const y = selectedYear();
  return sum(
    records.filter((r) => r.type === type && r.date.slice(0, 4) === y)
  );
}
// Auto-shrink an element's font-size until its text fits the parent's
// content-box width. Used for big totals (summary cards + donut center) so
// extreme numbers don't blow out the layout. Resets to maxPx on every call
// so the size also grows back when the number gets shorter again.
function fitText(el, maxPx, minPx) {
  if (!el || !el.parentElement) return;
  if (minPx == null) minPx = 10;
  el.style.fontSize = maxPx + "px";
  const available = el.parentElement.clientWidth;
  if (!available) return; // not laid out yet
  let size = maxPx;
  // Step down 1px at a time. Bounded loop (worst case ~maxPx iterations).
  while (el.scrollWidth > available && size > minPx) {
    size -= 1;
    el.style.fontSize = size + "px";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function formatDate(s) {
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ---------------- Refresh orchestration ---------------- */
function refresh() {
  updateRangeUI();
  updateDockTheme();
  savePrefs();
  const visible = records.filter(inRange);
  renderDashboard(visible);
  renderBulk(visible);
}

/* ---------------- Dashboard ---------------- */
$$(".summary-card").forEach((card) =>
  card.addEventListener("click", () => {
    activeType = card.dataset.type;
    drillCategory = null;
    selectedSlice = null;
    refresh();
  })
);

function recordCardHTML(r) {
  const sign = r.type === "investment" ? "+" : "-";
  const cls = r.type === "investment" ? "amt-in" : "amt-out";
  const color = catColor(r.type, r.category);
  return `
    <div class="rec-ico" style="background:${color}">
      ${iconSvg(catIcon(r.type, r.category), "rec-ico-svg")}
    </div>
    <div class="rec-body">
      <div class="rec-cat">${escapeHtml(r.category)}</div>
      ${
        r.subcategory
          ? `<div class="rec-sub">${escapeHtml(r.subcategory)}</div>`
          : ""
      }
      ${r.notes ? `<div class="rec-notes">${escapeHtml(r.notes)}</div>` : ""}
    </div>
    <div class="rec-right">
      <div class="rec-amt ${cls}">${sign}${fmt(dispAmt(r), dispCur(r))}</div>
      ${
        r.convertedAmount != null
          ? `<div class="rec-orig">${fmt(r.amount, r.currency)}</div>`
          : r.rateUnavailable
          ? `<div class="rec-orig warn">${fmt(r.amount, r.currency)} · rate n/a</div>`
          : ""
      }
      <div class="rec-date">${formatDate(r.date)}${
        r.ruleId
          ? ` <span class="rec-rule-badge" title="Generated from a recurring rule">↻</span>`
          : ""
      }</div>
    </div>`;
}

function bindRuleBadge(el, r) {
  if (!r || !r.ruleId) return;
  const badge = el.querySelector(".rec-rule-badge");
  if (!badge) return;
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    const rule = (store.settings.recurring || []).find((x) => x.id === r.ruleId);
    if (!rule) { alert("Rule no longer exists."); return; }
    showView("settings");
    setTimeout(() => {
      const block = $$("#view-settings .settings-block").find(
        (b) => b.querySelector(".block-title")?.textContent.trim() === "Recurring"
      );
      if (block) block.classList.remove("collapsed");
      openRuleEditor(rule.id);
    }, 50);
  });
}

function renderDashboard(list) {
  const expenses = list.filter((r) => r.type === "expense");
  const invest = list.filter((r) => r.type === "investment");
  const cur = baseCur(list);

  const yr = selectedYear();
  $("#sumExpense").textContent = fmt(yearTotal("expense"));
  $("#sumInvest").textContent = fmt(yearTotal("investment"));
  $("#cardExpense .muted").textContent = yr + " Expenses" + (cur ? " · " + cur : "");
  $("#cardInvest .muted").textContent = yr + " Investments" + (cur ? " · " + cur : "");
  $("#cardExpense").classList.toggle("active", activeType === "expense");
  $("#cardInvest").classList.toggle("active", activeType === "investment");
  fitText($("#sumExpense"), 22, 11);
  fitText($("#sumInvest"), 22, 11);

  const typed = activeType === "expense" ? expenses : invest;
  const label = activeType === "expense" ? "Expense" : "Investment";

  if (drillCategory && !typed.some((r) => r.category === drillCategory))
    drillCategory = null;

  let groups = {};
  if (!drillCategory) {
    typed.forEach((r) => (groups[r.category] = (groups[r.category] || 0) + dispAmt(r)));
    $("#chartTitle").textContent = label + "s by Category";
    $("#chartSub").textContent = "Tap a category, tap again to drill in";
    $("#chartBack").classList.add("hidden");
  } else {
    typed
      .filter((r) => r.category === drillCategory)
      .forEach((r) => {
        const k = r.subcategory || NO_SUB_LABEL;
        groups[k] = (groups[k] || 0) + dispAmt(r);
      });
    $("#chartTitle").textContent = drillCategory;
    $("#chartSub").textContent = "Sub-category breakdown";
    $("#chartBack").classList.remove("hidden");
  }

  const labels = Object.keys(groups).sort((a, b) => groups[b] - groups[a]);
  const values = labels.map((l) => groups[l]);
  const total = values.reduce((s, v) => s + v, 0);
  const colors = labels.map((l) =>
    drillCategory
      ? subColor(activeType, drillCategory, l)
      : catColor(activeType, l)
  );

  $("#dashEmpty").classList.add("hidden");

  if (selectedSlice && !labels.includes(selectedSlice)) selectedSlice = null;

  const drillable = {};
  if (!drillCategory)
    typed.forEach((r) => {
      if (r.subcategory) drillable[r.category] = true;
    });
  lastDrillable = drillable;

  if (selectedSlice) {
    const si = labels.indexOf(selectedSlice);
    const sv = values[si];
    const pct = total ? Math.round((sv / total) * 100) : 0;
    $("#chartCenterLabel").textContent = selectedSlice;
    $("#chartTotal").textContent = fmt(sv, cur);
    $("#chartPct").textContent = pct + "%";
  } else {
    $("#chartCenterLabel").textContent = "Total";
    $("#chartTotal").textContent = fmt(total, cur);
    $("#chartPct").textContent = "";
  }
  fitText($("#chartTotal"), 21, 9);

  drawChart(
    labels,
    values,
    colors,
    selectedSlice ? labels.indexOf(selectedSlice) : -1
  );

  // Recent records below the chart — follows the chart selection:
  // category tap (selectedSlice) or drill (drillCategory) filters by category;
  // a sub-slice tap inside the drill narrows to that sub-category (the
  // NO_SUB_LABEL slice matches records with an empty subcategory).
  let listFiltered = typed;
  let listTitle = "Recent " + label + " Records";
  if (drillCategory) {
    listFiltered = typed.filter((r) => r.category === drillCategory);
    listTitle = "Recent: " + drillCategory;
    if (selectedSlice) {
      listFiltered = listFiltered.filter(
        (r) => (r.subcategory || NO_SUB_LABEL) === selectedSlice
      );
      listTitle = "Recent: " + selectedSlice;
    }
  } else if (selectedSlice) {
    listFiltered = typed.filter((r) => r.category === selectedSlice);
    listTitle = "Recent: " + selectedSlice;
  }
  const recent = listFiltered.slice(0, 10);
  $("#dashListTitle").textContent = listTitle;
  $("#dashRecordCount").textContent =
    listFiltered.length > 10 ? "10 of " + listFiltered.length : listFiltered.length;
  const wrap = $("#dashRecordsList");
  $("#dashRecordsEmpty").classList.toggle("hidden", listFiltered.length > 0);
  wrap.innerHTML = "";
  recent.forEach((r) => {
    const el = document.createElement("div");
    el.className = "rec";
    el.innerHTML = recordCardHTML(r);
    el.addEventListener("click", () => openModal(r));
    bindRuleBadge(el, r);
    wrap.appendChild(el);
  });
}

let detachRAF = null;
const DETACH_PX = 18;
// Smoothly detach the selected arc OUTWARD without resizing the ring.
// (We animate each arc element's own offset, so Chart never shrinks the
// radius to "make room" — that was the cause of the chart getting smaller.)
function animateDetach(selIdx) {
  if (detachRAF) cancelAnimationFrame(detachRAF);
  if (!chart) return;
  const meta = chart.getDatasetMeta(0);
  const arcs = (meta && meta.data) || [];
  if (!arcs.length) return;
  const start = arcs.map((a) => a.options.offset || 0);
  const goal = arcs.map((_, i) => (i === selIdx ? DETACH_PX : 0));
  const t0 = performance.now();
  const DUR = 260;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    const t = Math.min(1, (now - t0) / DUR);
    const k = ease(t);
    arcs.forEach((a, i) => {
      a.options.offset = start[i] + (goal[i] - start[i]) * k;
    });
    chart.draw();
    if (t < 1) detachRAF = requestAnimationFrame(frame);
    else detachRAF = null;
  }
  detachRAF = requestAnimationFrame(frame);
}

function drawChart(labels, values, colors, selIdx) {
  const empty = labels.length === 0;
  const emptyColor =
    (getComputedStyle(document.documentElement).getPropertyValue("--ring-empty") || "")
      .trim() || "#3a4258";
  const bg = empty
    ? [emptyColor]
    : colors.map((c, i) => (selIdx < 0 || i === selIdx ? c : c + "55"));
  const sig = JSON.stringify({ labels, values, empty });

  // soft glow around the donut while a slice is selected
  const wrap = $(".chart-wrap");
  if (wrap) wrap.classList.toggle("glow", !empty && selIdx >= 0);

  // Same data, only selection changed: recolor instantly (no intro spin),
  // then animate just the detach.
  if (chart && chart.$sig === sig) {
    const ds = chart.data.datasets[0];
    ds.backgroundColor = bg;
    chart.$labels = labels;
    chart.update("none");
    animateDetach(empty ? -1 : selIdx);
    return;
  }

  if (chart) chart.destroy();
  chart = new Chart($("#donut"), {
    type: "doughnut",
    data: {
      labels: empty ? [""] : labels,
      datasets: [
        {
          data: empty ? [1] : values,
          backgroundColor: bg,
          borderColor: "#161a24",
          borderWidth: empty ? 0 : 2, // thin, uniform — no thick black outline
          offset: 0, // never set at dataset level (prevents ring shrink)
          hoverOffset: 0, // no desktop-only hover wobble
        },
      ],
    },
    options: {
      cutout: "66%",
      // constant inner padding => ring drawn smaller so the detached
      // slice + glow always stay inside the canvas (no clipping)
      layout: { padding: 26 },
      animation: { duration: 280 },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      onClick: (_e, els) => {
        if (chart.$empty || !els.length) return;
        sliceTap(chart.$labels[els[0].index]);
      },
    },
  });
  chart.$sig = sig;
  chart.$labels = labels;
  chart.$empty = empty;
  if (!empty && selIdx >= 0) animateDetach(selIdx);
}

// First tap selects (shows amount + %); second tap on the same slice drills in.
function sliceTap(lbl) {
  if (drillCategory) {
    selectedSlice = selectedSlice === lbl ? null : lbl;
    refresh();
    return;
  }
  if (selectedSlice !== lbl) {
    selectedSlice = lbl;
    refresh();
    return;
  }
  if (lastDrillable[lbl]) {
    drillCategory = lbl;
    selectedSlice = null;
  } else {
    selectedSlice = null;
  }
  refresh();
}
$("#chartBack").addEventListener("click", () => {
  drillCategory = null;
  selectedSlice = null;
  refresh();
});

/* ---------------- Records page + multi-select ---------------- */
let multiSelect = false;
let lastTyped = []; // records currently shown on the Records page
let recFilter = new Set(); // category filter on the Records page

function renderBulk(list) {
  const expenses = list.filter((r) => r.type === "expense");
  const invest = list.filter((r) => r.type === "investment");
  const cur = baseCur(list);
  const yr = selectedYear();
  $("#totExp").textContent = fmt(yearTotal("expense"));
  $("#totInv").textContent = fmt(yearTotal("investment"));
  $("#recCardExpense .muted").textContent = yr + " Expenses" + (cur ? " · " + cur : "");
  $("#recCardInvest .muted").textContent = yr + " Investments" + (cur ? " · " + cur : "");
  fitText($("#totExp"), 22, 11);
  fitText($("#totInv"), 22, 11);
  $("#recCardExpense").classList.toggle("active", activeType === "expense");
  $("#recCardInvest").classList.toggle("active", activeType === "investment");

  let typed = activeType === "expense" ? expenses : invest;
  if (recFilter.size) typed = typed.filter((r) => recFilter.has(r.category));
  lastTyped = typed;
  $("#bulkListTitle").textContent =
    (activeType === "expense" ? "Expense" : "Investment") + " Records";
  $("#bulkRecordCount").textContent = typed.length;
  $("#recFilterBtn").classList.toggle("on", recFilter.size > 0);

  const wrap = $("#bulkList");
  wrap.classList.toggle("select-mode", multiSelect);
  $("#bulkEmpty").classList.toggle("hidden", typed.length > 0);
  wrap.innerHTML = "";
  const visibleIds = new Set(typed.map((r) => r.id));
  [...selected].forEach((id) => !visibleIds.has(id) && selected.delete(id));

  typed.forEach((r) => {
    const el = document.createElement("div");
    el.className = "rec" + (multiSelect && selected.has(r.id) ? " selected" : "");
    if (multiSelect) {
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "rec-check";
      chk.checked = selected.has(r.id);
      chk.tabIndex = -1;
      el.appendChild(chk);
    }
    const inner = document.createElement("div");
    inner.style.cssText =
      "display:flex;gap:12px;flex:1;min-width:0;align-items:flex-start";
    inner.innerHTML = recordCardHTML(r);
    el.appendChild(inner);
    bindRuleBadge(inner, r);
    el.addEventListener("click", () => {
      if (multiSelect) {
        if (selected.has(r.id)) selected.delete(r.id);
        else selected.add(r.id);
        el.classList.toggle("selected", selected.has(r.id));
        const c = el.querySelector(".rec-check");
        if (c) c.checked = selected.has(r.id);
        updateSelUI();
      } else {
        openModal(r);
      }
    });
    wrap.appendChild(el);
  });
  updateSelUI();
}
function updateSelUI() {
  const n = selected.size;
  const sc = $("#selCount");
  sc.textContent = n + " selected";
  sc.classList.toggle("hidden", !multiSelect);
  $("#msCat").disabled = n === 0;
  $("#msType").disabled = n === 0;
  $("#msDelete").disabled = n === 0;
  const allSel = lastTyped.length > 0 && n === lastTyped.length;
  $("#msAll").classList.toggle("on", allSel);
}

function updateFabs() {
  const onRecords = currentView === "records";
  const onDebtRecords = currentView === "debt-records";
  // Hide the main + FAB on Settings, or while ANY multi-select mode is active.
  $("#fab").classList.toggle("hidden",
    currentView === "settings" || multiSelect || debtMultiSelect);
  // MuniTrakr multi
  $("#multiBtn").classList.toggle("hidden", !onRecords || multiSelect);
  $("#multiBar").classList.toggle("hidden", !(onRecords && multiSelect));
  // DebtTrakr multi
  const dbtMultiBtn = document.getElementById("dbtMultiBtn");
  const dbtMultiBar = document.getElementById("dbtMultiBar");
  if (dbtMultiBtn) dbtMultiBtn.classList.toggle("hidden", !onDebtRecords || debtMultiSelect);
  if (dbtMultiBar) dbtMultiBar.classList.toggle("hidden", !(onDebtRecords && debtMultiSelect));
}
function enterMulti() {
  multiSelect = true;
  selected.clear();
  renderBulk(records.filter(inRange));
  updateFabs();
}
function exitMulti() {
  multiSelect = false;
  selected.clear();
  renderBulk(records.filter(inRange));
  updateFabs();
}
$("#multiBtn").addEventListener("click", enterMulti);
$("#msCancel").addEventListener("click", exitMulti);
$("#msAll").addEventListener("click", () => {
  const allSel = lastTyped.length > 0 && selected.size === lastTyped.length;
  selected.clear();
  if (!allSel) lastTyped.forEach((r) => selected.add(r.id));
  renderBulk(records.filter(inRange));
});
$("#msDelete").addEventListener("click", async () => {
  if (!selected.size) return;
  if (!confirm("Delete " + selected.size + " record(s)? This can't be undone."))
    return;
  await api("/records/bulk", "POST", {
    action: "delete",
    ids: [...selected],
  });
  exitMulti();
  await loadRecords();
});
$("#msType").addEventListener("click", async () => {
  if (!selected.size) return;
  const ids = [...selected];
  const sel = records.filter((r) => ids.includes(r.id));
  const allExp = sel.every((r) => r.type === "expense");
  await api("/records/bulk", "POST", {
    action: "update",
    ids,
    type: allExp ? "investment" : "expense",
  });
  exitMulti();
  await loadRecords();
});
$$("#recCardExpense, #recCardInvest").forEach((card) =>
  card.addEventListener("click", () => {
    activeType = card.dataset.type;
    selected.clear();
    recFilter.clear(); // categories differ per type
    $("#recFilterMenu").classList.add("hidden");
    drillCategory = null;
    selectedSlice = null;
    refresh();
  })
);

/* ---- Records page: filter by category ---- */
function buildFilterMenu() {
  const menu = $("#recFilterMenu");
  const cats = (settings[activeType] || []).map((c) => c.name);
  menu.innerHTML =
    cats
      .map((name) => {
        const c = findCat(activeType, name);
        return `<button type="button" class="filter-opt" data-name="${escapeHtml(
          name
        )}"><input type="checkbox" ${
          recFilter.has(name) ? "checked" : ""
        } /><span class="pick-ico" style="background:${
          c ? c.color : "#3a4152"
        }">${iconSvg(c ? c.icon || "tag" : "tag")}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(
          name
        )}</span></button>`;
      })
      .join("") +
    `<button type="button" class="filter-clear" id="recFilterClear">Clear filters</button>`;
  menu.querySelectorAll(".filter-opt").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation(); // keep the dropdown open while picking
      const n = b.dataset.name;
      if (recFilter.has(n)) recFilter.delete(n);
      else recFilter.add(n);
      buildFilterMenu();
      renderBulk(records.filter(inRange));
    })
  );
  menu.querySelector("#recFilterClear").addEventListener("click", (e) => {
    e.stopPropagation();
    recFilter.clear();
    buildFilterMenu();
    renderBulk(records.filter(inRange));
  });
}
$("#recFilterBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const m = $("#recFilterMenu");
  const open = m.classList.contains("hidden");
  if (open) buildFilterMenu();
  m.classList.toggle("hidden");
});
// Bulk modal uses the active type's categories (records in the Records
// tab are filtered to the active Expense/Investment type).
function buildBulkCatMenu() {
  const menu = $("#bulkCatMenu");
  menu.innerHTML = (settings[activeType] || [])
    .map(
      (c) =>
        `<button type="button" class="picker-opt" data-name="${escapeHtml(
          c.name
        )}"><span class="pick-ico" style="background:${c.color}">${iconSvg(
          c.icon || "tag"
        )}</span><span>${escapeHtml(c.name)}</span></button>`
    )
    .join("");
  menu.querySelectorAll(".picker-opt").forEach((b) =>
    b.addEventListener("click", () => {
      bulkSetCategory(b.dataset.name);
      menu.classList.add("hidden");
    })
  );
}
function bulkSetCategory(name) {
  $("#bulkCat").value = name || "";
  const c = name ? findCat(activeType, name) : null;
  const val = $("#bulkCatVal");
  if (c) {
    val.classList.remove("placeholder");
    val.innerHTML =
      `<span class="pick-ico" style="background:${c.color}">${iconSvg(
        c.icon || "tag"
      )}</span><span>${escapeHtml(c.name)}</span>`;
  } else {
    val.classList.add("placeholder");
    val.textContent = "Select a category";
  }
  bulkSetSub("");
  buildBulkSubMenu(name);
}
function buildBulkSubMenu(catName) {
  const c = catName ? findCat(activeType, catName) : null;
  const subs = c ? c.subs : [];
  const field = $("#bulkSubField");
  const menu = $("#bulkSubMenu");
  if (!subs.length) {
    field.classList.add("hidden");
    menu.innerHTML = "";
    return;
  }
  field.classList.remove("hidden");
  menu.innerHTML =
    `<button type="button" class="picker-opt" data-name="">
       <span class="pick-dot" style="background:#3a4152"></span><span>None</span>
     </button>` +
    subs
      .map(
        (s) =>
          `<button type="button" class="picker-opt" data-name="${escapeHtml(
            s.name
          )}"><span class="pick-dot" style="background:${s.color}"></span><span>${escapeHtml(
            s.name
          )}</span></button>`
      )
      .join("");
  menu.querySelectorAll(".picker-opt").forEach((b) =>
    b.addEventListener("click", () => {
      bulkSetSub(b.dataset.name);
      menu.classList.add("hidden");
    })
  );
}
function bulkSetSub(name) {
  $("#bulkSub").value = name || "";
  const c = name ? findCat(activeType, $("#bulkCat").value) : null;
  const s = c && c.subs.find((x) => x.name === name);
  const val = $("#bulkSubVal");
  if (s)
    val.innerHTML =
      `<span class="pick-dot" style="background:${s.color}"></span><span>${escapeHtml(
        s.name
      )}</span>`;
  else val.textContent = "None";
}
$("#bulkCatBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#bulkSubMenu").classList.add("hidden");
  $("#bulkCatMenu").classList.toggle("hidden");
});
$("#bulkSubBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#bulkCatMenu").classList.add("hidden");
  $("#bulkSubMenu").classList.toggle("hidden");
});
$("#msCat").addEventListener("click", () => {
  if (!selected.size) return;
  $("#bulkCat").value = "";
  $("#bulkSub").value = "";
  $("#bulkModalError").textContent = "";
  $("#bulkCatMenu").classList.add("hidden");
  $("#bulkSubMenu").classList.add("hidden");
  buildBulkCatMenu();
  bulkSetCategory("");
  $("#bulkModal").classList.remove("hidden");
  syncModalLock();
});
$("#bulkModalClose").addEventListener("click", () => {
  $("#bulkModal").classList.add("hidden");
  syncModalLock();
});
$("#bulkModal").addEventListener("click", (e) => {
  if (e.target.id === "bulkModal") {
    $("#bulkModal").classList.add("hidden");
    syncModalLock();
  }
});
$("#bulkApply").addEventListener("click", async () => {
  const category = $("#bulkCat").value.trim();
  const subcategory = $("#bulkSub").value.trim();
  if (!category)
    return ($("#bulkModalError").textContent = "Select a category");
  await api("/records/bulk", "POST", {
    action: "update",
    ids: [...selected],
    category,
    subcategory,
  });
  $("#bulkModal").classList.add("hidden");
  syncModalLock();
  exitMulti();
  await loadRecords();
});

/* ---------------- View switching ---------------- */
function showView(v) {
  // Mode-compatibility gate — a persisted view from the wrong mode (e.g.
  // iOS PWA closed while on "person-history" then reopened in finance mode,
  // since mode is intentionally not persisted) must auto-redirect to the
  // dashboard, otherwise the wrong-mode view renders empty.
  const DEBT_ONLY = new Set(["person-history", "debt-records"]);
  const FINANCE_ONLY = new Set(["records"]);
  if (DEBT_ONLY.has(v) && currentMode !== "debt") v = "dashboard";
  else if (FINANCE_ONLY.has(v) && currentMode !== "finance") v = "dashboard";

  if (v !== "records" && multiSelect) {
    multiSelect = false;
    selected.clear();
  }
  if (v !== "debt-records" && debtMultiSelect) {
    debtMultiSelect = false;
    debtSelected.clear();
  }
  currentView = v;
  const onDebtMode = currentMode === "debt";
  document.getElementById("view-dashboard").classList.toggle("hidden", !(v === "dashboard" && !onDebtMode));
  document.getElementById("view-debt-dashboard").classList.toggle("hidden", !(v === "dashboard" && onDebtMode));
  document.getElementById("view-records").classList.toggle("hidden", v !== "records");
  document.getElementById("view-settings").classList.toggle("hidden", v !== "settings");
  const phView = document.getElementById("view-person-history");
  if (phView) phView.classList.toggle("hidden", v !== "person-history");
  const dbtRecView = document.getElementById("view-debt-records");
  if (dbtRecView) dbtRecView.classList.toggle("hidden", v !== "debt-records");
  if (v !== "settings")
    document.querySelectorAll("#view-settings .settings-block").forEach((b) =>
      b.classList.add("collapsed")
    );
  const dockHidden =
    v === "settings" || v === "person-history" || v === "debt-records" || onDebtMode;
  document.getElementById("rangeDock").classList.toggle("hidden", dockHidden);
  // No dock → nothing to clear; let the floating buttons sit lower.
  document.body.classList.toggle("no-dock", dockHidden);
  document.getElementById("recFilterMenu").classList.add("hidden");
  const dbtFilterMenu = document.getElementById("dbtRecFilterMenu");
  if (dbtFilterMenu) dbtFilterMenu.classList.add("hidden");
  if (v === "settings") {
    document.querySelectorAll("#view-settings .settings-block").forEach((block) => {
      const m = block.dataset.mode || "any";
      block.style.display = (m === "any" || m === currentMode) ? "" : "none";
    });
    if (currentMode === "finance") renderRecurringSection();
    if (currentMode === "debt") renderPeopleSection();
  }
  if (v === "dashboard") {
    if (onDebtMode) renderDebtDashboard();
    else renderConfirmBanner();
  }
  if (v === "person-history") renderPersonHistory(_currentHistoryPersonId);
  if (v === "debt-records") renderDebtRecords();
  updateFabs();
  updateSettingsBtn();
  updateDockTheme();
  savePrefs();
}
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>';
const BACK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
function updateSettingsBtn() {
  const inSettings = currentView === "settings";
  const btn = $("#settingsBtn");
  $("#settingsIco").innerHTML = inSettings ? BACK_SVG : GEAR_SVG;
  btn.classList.toggle("is-back", inSettings);
  btn.setAttribute(
    "aria-label",
    inSettings ? "Back" : "Settings"
  );
}
function updateDockTheme() {
  // accent (purple = Expenses, blue = Investments) applies app-wide
  $("#app").classList.toggle("t-invest", activeType === "investment");
  $("#app").classList.toggle("t-expense", activeType !== "investment");
}
const THEMES = ["default", "aero", "yoimiya"];
function applyTheme(name) {
  const t = THEMES.includes(name) ? name : "default";
  THEMES.forEach((x) => {
    const on = x === t;
    document.body.classList.toggle("theme-" + x, on);
    document.documentElement.classList.toggle("theme-" + x, on);
  });
  if (t === "yoimiya") Fireworks.start();
  else Fireworks.stop();
}
function applyHeaderIcon() {
  const key = currentMode === "debt" ? "headerIconDebt" : "headerIconFinance";
  const src = (settings && settings[key]) || "./icon.png";
  const a = document.getElementById("headerIcon");
  if (a) a.src = src;
  // Update both Settings previews (each mode's preview shows its own slot's icon).
  const bF = document.getElementById("hiPreviewFinance");
  const bD = document.getElementById("hiPreviewDebt");
  if (bF) bF.src = (settings && settings.headerIconFinance) || "./icon.png";
  if (bD) bD.src = (settings && settings.headerIconDebt) || "./icon.png";
}
// Resize an uploaded image to a small square data-URL (keeps localStorage tiny)
function fileToIconDataURL(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const S = 160;
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const g = c.getContext("2d");
      const m = Math.min(img.width, img.height);
      g.drawImage(
        img,
        (img.width - m) / 2,
        (img.height - m) / 2,
        m,
        m,
        0,
        0,
        S,
        S
      );
      cb(c.toDataURL("image/png"));
    };
    img.onerror = () => cb(null);
    img.src = fr.result;
  };
  fr.onerror = () => cb(null);
  fr.readAsDataURL(file);
}
async function persistSettings() {
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
  } catch {}
}
function _wireHeaderIconControls(inputId, resetId, settingsKey, modeLabel) {
  const inEl = document.getElementById(inputId);
  const rsEl = document.getElementById(resetId);
  if (inEl) {
    inEl.addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      const msg = document.getElementById("hiMsg");
      if (msg) msg.textContent = "";
      fileToIconDataURL(f, async (url) => {
        if (!url) {
          if (msg) { msg.style.color = ""; msg.textContent = "Couldn't read that image."; }
          return;
        }
        settings[settingsKey] = url;
        applyHeaderIcon();
        await persistSettings();
        if (msg) { msg.style.color = "var(--in)"; msg.textContent = modeLabel + " header icon updated."; }
      });
    });
  }
  if (rsEl) {
    rsEl.addEventListener("click", async () => {
      settings[settingsKey] = null;
      applyHeaderIcon();
      await persistSettings();
      const msg = document.getElementById("hiMsg");
      if (msg) { msg.style.color = "var(--in)"; msg.textContent = modeLabel + " header icon reset."; }
    });
  }
}
_wireHeaderIconControls("hiInputFinance", "hiResetFinance", "headerIconFinance", "MuniTrakr");
_wireHeaderIconControls("hiInputDebt",    "hiResetDebt",    "headerIconDebt",    "DebtTrakr");

/* ---- Fireworks backdrop (Yoimiya) — 3–6 random bursts at a time ---- */
const Fireworks = (() => {
  const cv = document.getElementById("fxCanvas");
  const ctx = cv && cv.getContext("2d");
  const COLORS = [
    "#ff7a18", "#ffae3b", "#ffd166", "#ff4d3d",
    "#ff2e63", "#fff1c9", "#ff9a3d",
  ];
  let raf = 0,
    running = false,
    rockets = [],
    parts = [],
    last = 0,
    nextLaunch = 0,
    W = 0,
    H = 0,
    DPR = 1;

  function resize() {
    if (!cv) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * DPR;
    cv.height = H * DPR;
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  function launch() {
    const x = rnd(W * 0.12, W * 0.88);
    rockets.push({
      x,
      y: H + 8,
      tx: x + rnd(-40, 40),
      ty: rnd(H * 0.10, H * 0.72), // random burst height — low to high
      vy: rnd(-11, -9),            // enough lift to reach the high ones
      col: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }
  function explode(x, y, col) {
    const n = 46 + ((Math.random() * 36) | 0);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + rnd(-0.08, 0.08);
      const sp = rnd(1.2, 3.9);
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: rnd(0.009, 0.019),
        col: Math.random() < 0.18 ? "#fff1c9" : col,
        r: rnd(1.4, 2.6),
      });
    }
  }
  function frame(t) {
    if (!running) return;
    if (!last) last = t;
    last = t;
    // active bursts = rockets + lingering explosions; keep 3–6 going
    if (t > nextLaunch) {
      const active = rockets.length + (parts.length > 60 ? 2 : 0);
      const target = 3 + ((Math.random() * 4) | 0); // 3..6
      if (active < target) launch();
      nextLaunch = t + rnd(340, 880);
    }
    // no trail — clear fully each frame; glow comes from shadowBlur
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.vy += 0.055; // lower gravity so it climbs higher before bursting
      r.x += (r.tx - r.x) * 0.02;
      r.y += r.vy;
      ctx.shadowColor = r.col;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.fillStyle = r.col;
      ctx.arc(r.x, r.y, 2.4, 0, 7);
      ctx.fill();
      if (r.y <= r.ty || r.vy >= 0) {
        explode(r.x, r.y, r.col);
        rockets.splice(i, 1);
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.034;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.shadowColor = p.col;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.fillStyle = p.col;
      ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (!ctx || running) return;
    running = true;
    resize();
    window.addEventListener("resize", resize);
    last = 0;
    nextLaunch = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    rockets = [];
    parts = [];
    window.removeEventListener("resize", resize);
    if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
  document.addEventListener("visibilitychange", () => {
    if (!running) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  });
  return { start, stop };
})();
$("#setTheme") &&
  $("#setTheme").addEventListener("change", async (e) => {
    const t = e.target.value;
    settings.theme = t;
    applyTheme(t);
    try {
      settings = await api("/settings", "PUT", buildSettingsPayload());
      syncDraftsFromSettings();
    } catch {}
    refresh();
  });
$("#viewAllBtn").addEventListener("click", () => showView("records"));
$("#recBack").addEventListener("click", () => showView("dashboard"));
let prevView = "dashboard";
$("#settingsBtn").addEventListener("click", () => {
  if (currentView === "settings") {
    showView(prevView === "settings" ? "dashboard" : prevView);
  } else {
    prevView = currentView;
    openSettings();
    showView("settings");
  }
});

/* ---------------- Record modal (select-only pickers) ---------------- */
function buildCatMenu() {
  const menu = $("#catPickMenu");
  const cats = settings[modalType] || [];
  menu.innerHTML = cats
    .map(
      (c) =>
        `<button type="button" class="picker-opt" data-name="${escapeHtml(c.name)}">
          <span class="pick-ico" style="background:${c.color}">${iconSvg(
          c.icon || "tag"
        )}</span><span>${escapeHtml(c.name)}</span>
        </button>`
    )
    .join("");
  menu.querySelectorAll(".picker-opt").forEach((b) =>
    b.addEventListener("click", () => {
      setCategory(b.dataset.name);
      menu.classList.add("hidden");
    })
  );
}
// kept name so existing call sites keep working
function populateDatalists() {
  buildCatMenu();
}

// Up-to-5 most-used categories of the current type (quick pick)
function buildFreqCats() {
  const field = $("#freqField");
  const wrap = $("#freqCats");
  const counts = {};
  records.forEach((r) => {
    // strictly this type's own categories (expense/investment kept separate)
    if (r.type === modalType && r.category && findCat(modalType, r.category))
      counts[r.category] = (counts[r.category] || 0) + 1;
  });
  const top = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 5);
  if (!top.length) {
    field.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  field.classList.remove("hidden");
  wrap.innerHTML = top
    .map(
      (name) =>
        `<button type="button" class="freq-chip" data-name="${escapeHtml(
          name
        )}"><span class="freq-ic" style="background:${catColor(
          modalType,
          name
        )}">${iconSvg(catIcon(modalType, name))}</span><span class="freq-lbl">${escapeHtml(
          name
        )}</span></button>`
    )
    .join("");
  wrap.querySelectorAll(".freq-chip").forEach((b) =>
    b.addEventListener("click", () => setCategory(b.dataset.name))
  );
}

function setCategory(name) {
  $("#fCategory").value = name || "";
  const c = name ? findCat(modalType, name) : null;
  const val = $("#catPickVal");
  if (c) {
    val.classList.remove("placeholder");
    val.innerHTML =
      `<span class="pick-ico" style="background:${c.color}">${iconSvg(
        c.icon || "tag"
      )}</span><span>${escapeHtml(c.name)}</span>`;
  } else {
    val.classList.add("placeholder");
    val.textContent = "Select a category";
  }
  setSub("");
  buildSubMenu(name);
}

function buildSubMenu(catName) {
  const c = catName ? findCat(modalType, catName) : null;
  const subs = c ? c.subs : [];
  const field = $("#subField");
  const menu = $("#subPickMenu");
  if (!subs.length) {
    field.classList.add("hidden");
    menu.innerHTML = "";
    return;
  }
  field.classList.remove("hidden");
  menu.innerHTML =
    `<button type="button" class="picker-opt" data-name="">
       <span class="pick-dot" style="background:#3a4152"></span><span>None</span>
     </button>` +
    subs
      .map(
        (s) =>
          `<button type="button" class="picker-opt" data-name="${escapeHtml(
            s.name
          )}"><span class="pick-dot" style="background:${s.color}"></span><span>${escapeHtml(
            s.name
          )}</span></button>`
      )
      .join("");
  menu.querySelectorAll(".picker-opt").forEach((b) =>
    b.addEventListener("click", () => {
      setSub(b.dataset.name);
      menu.classList.add("hidden");
    })
  );
}
// kept name so existing call sites keep working
function updateSubList(_type, cat) {
  buildSubMenu(cat);
}

function setSub(name) {
  $("#fSub").value = name || "";
  const c = name ? findCat(modalType, $("#fCategory").value) : null;
  const s = c && c.subs.find((x) => x.name === name);
  const val = $("#subPickVal");
  if (s) {
    val.innerHTML =
      `<span class="pick-dot" style="background:${s.color}"></span><span>${escapeHtml(
        s.name
      )}</span>`;
  } else {
    val.textContent = "None";
  }
}

$("#catPickBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#subPickMenu").classList.add("hidden");
  $("#catPickMenu").classList.toggle("hidden");
});
$("#subPickBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#catPickMenu").classList.add("hidden");
  $("#subPickMenu").classList.toggle("hidden");
});

$$(".type-toggle button").forEach((b) =>
  b.addEventListener("click", () => {
    modalType = b.dataset.type;
    $$(".type-toggle button").forEach((x) =>
      x.classList.toggle("active", x === b)
    );
    buildCatMenu();
    buildFreqCats();
    setCategory("");
    syncSplitSection();
  })
);

// Tags feature removed in v45.

/* ---- Currency helpers ---- */
function currencyList() {
  const l = settings.currencies;
  return l && l.length ? l : [settings.defaultCurrency || "THB"];
}
function fillCurrencySelects() {
  const opts = currencyList()
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
  if ($("#fCurrency")) $("#fCurrency").innerHTML = opts;
  if ($("#dbtCurrency")) $("#dbtCurrency").innerHTML = opts;
  if ($("#ruleCurrency")) $("#ruleCurrency").innerHTML = opts;
  if ($("#setDefCurrency")) {
    $("#setDefCurrency").innerHTML = opts;
    $("#setDefCurrency").value = settings.defaultCurrency || "THB";
  }
}
// Every ISO currency now auto-converts (Frankfurter or the currency-api
// fallback), so the manual-rate field never needs to pre-open. The field and
// the manualRate plumbing stay for legacy records and as an escape hatch.
function updateManualRateField() {
  $("#manualRateField").classList.add("hidden");
}
$("#fCurrency").addEventListener("change", updateManualRateField);

/* one payload from all settings edits, so saving any section keeps the rest */
function buildSettingsPayload() {
  const p = JSON.parse(JSON.stringify(settingsDraft || settings));
  p.currencies = (
    curDraft && curDraft.length ? curDraft : settings.currencies || []
  ).slice();
  p.defaultCurrency =
    ($("#setDefCurrency") && $("#setDefCurrency").value) ||
    settings.defaultCurrency ||
    "THB";
  p.theme = settings.theme || "default";
  p.debtShareLanguage =
    ($("#setDebtShareLanguage") && $("#setDebtShareLanguage").value) ||
    settings.debtShareLanguage ||
    "en";
  const mk = $("#setFxMarkup") ? parseFloat($("#setFxMarkup").value) : NaN;
  p.fxMarkupPct = Number.isFinite(mk) && mk >= 0
    ? Math.min(mk, 10)
    : (settings.fxMarkupPct || 0);
  p.headerIconFinance =
    settings.headerIconFinance === undefined ? null : settings.headerIconFinance;
  p.headerIconDebt =
    settings.headerIconDebt === undefined ? null : settings.headerIconDebt;
  return p;
}
function syncDraftsFromSettings() {
  settingsDraft = JSON.parse(JSON.stringify(settings));
  curDraft = (settings.currencies || []).slice();
}

/* ---- Generic touch-friendly drag reorder ----
   Reorders `arr` (array of items) to match the on-screen order of rows
   carrying data-idx, then calls render() to repaint with fresh indices. */
function makeDraggable(container, rowSel, handleSel, arr, render) {
  const rows = () =>
    [...container.children].filter((c) => c.matches && c.matches(rowSel));
  container.querySelectorAll(handleSel).forEach((h) => {
    const row = h.closest(rowSel);
    if (!row || row.parentElement !== container) return;
    h.style.touchAction = "none";
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      row.classList.add("dragging");
      try { h.setPointerCapture(e.pointerId); } catch {}
      const move = (ev) => {
        const y = ev.clientY;
        const others = rows().filter((r) => r !== row);
        let placed = false;
        for (const r of others) {
          const b = r.getBoundingClientRect();
          if (y < b.top + b.height / 2) {
            container.insertBefore(row, r);
            placed = true;
            break;
          }
        }
        if (!placed) {
          // keep within the rows group (never below trailing buttons
          // like "+ Add sub-category")
          if (others.length) others[others.length - 1].after(row);
          else container.appendChild(row);
        }
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        row.classList.remove("dragging");
        const order = rows().map((r) => arr[+r.dataset.idx]);
        arr.length = 0;
        arr.push(...order);
        render();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  });
}

/* ---- Currencies manager (Settings) ---- */
let curDraft = [];
function renderCurManager() {
  const box = $("#curManager");
  if (!box) return;
  box.innerHTML = "";
  curDraft.forEach((code, i) => {
    const isDef = code === settings.defaultCurrency;
    const row = document.createElement("div");
    row.className = "cur-row";
    row.dataset.idx = i;
    row.innerHTML =
      `<button type="button" class="drag-handle cur-drag" aria-label="Reorder">⠿</button>` +
      `<span class="cur-code">${escapeHtml(code)}</span>` +
      `<span class="cur-tag ok">auto-convert</span>` +
      `<button type="button" class="cat-del cur-del"${
        isDef ? " disabled title='Default currency'" : ""
      }>✕</button>`;
    if (!isDef)
      row.querySelector(".cur-del").addEventListener("click", () => {
        curDraft.splice(i, 1);
        renderCurManager();
      });
    box.appendChild(row);
  });
  makeDraggable(box, ".cur-row", ".cur-drag", curDraft, renderCurManager);
}
$("#addCurBtn").addEventListener("click", () => {
  $("#curMsg").textContent = "";
  const code = $("#newCurCode").value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !isRealCurrency(code)) {
    $("#curMsg").style.color = "";
    $("#curMsg").textContent = "“" + code + "” is not a valid currency code.";
    return;
  }
  if (curDraft.includes(code)) {
    $("#curMsg").style.color = "";
    $("#curMsg").textContent = code + " is already in your list.";
    return;
  }
  curDraft.push(code);
  $("#newCurCode").value = "";
  renderCurManager();
  $("#curMsg").style.color = "var(--in)";
  $("#curMsg").textContent = code + " added (auto-converts).";
});
$("#saveCurrencies").addEventListener("click", async () => {
  $("#curMsg").textContent = "";
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
    fillCurrencySelects();
    renderCurManager();
    renderCatManager();
    refresh();
    $("#curMsg").style.color = "var(--in)";
    $("#curMsg").textContent = "Currencies saved.";
  } catch (err) {
    $("#curMsg").style.color = "";
    $("#curMsg").textContent = err.message;
  }
});

function openModal(record) {
  editingId = record ? record.id : null;
  modalType = record ? record.type : activeType;
  pendingNew = null;
  $("#newColorPanel").classList.add("hidden");
  $("#saveBtn").textContent = "Save Record";
  $("#modalTitle").textContent = record ? "Edit Record" : "Add New Record";
  $("#deleteBtn").classList.toggle("hidden", !record);
  $("#modalError").textContent = "";
  $$(".type-toggle button").forEach((x) =>
    x.classList.toggle("active", x.dataset.type === modalType)
  );
  $("#fDate").value = record ? record.date : ymd(new Date());
  $("#fAmount").value = record ? record.amount : "";
  fillCurrencySelects();
  $("#fCurrency").value = record
    ? record.currency
    : settings.defaultCurrency || "THB";
  $("#fManualRate").value = record && record.manualRate ? record.rate : "";
  updateManualRateField();
  $("#fNotes").value = record ? record.notes : "";
  $("#catPickMenu").classList.add("hidden");
  $("#subPickMenu").classList.add("hidden");
  buildCatMenu();
  buildFreqCats();
  setCategory(record ? record.category : "");
  if (record && record.subcategory) setSub(record.subcategory);
  $("#modal").classList.remove("hidden");
  syncModalLock();
  setRecRecurringSection(record);
  splitPeople = [];
  splitMine = null;
  splitLastEdited = null;
  const splitToggleEl = document.getElementById("splitToggle");
  if (splitToggleEl) splitToggleEl.checked = false;
  const splitFormEl = document.getElementById("splitNewPersonForm");
  if (splitFormEl) splitFormEl.classList.add("hidden");
  syncSplitSection();
}
function closeModal() {
  $("#modal").classList.add("hidden");
  editingId = null;
  pendingNew = null;
  syncModalLock();
}
// Lock page scroll while any modal sheet is open (stops iOS scroll-chaining
// from moving the page behind the modal).
function syncModalLock() {
  const open =
    !$("#modal").classList.contains("hidden") ||
    !$("#bulkModal").classList.contains("hidden");
  document.body.classList.toggle("modal-open", open);
}
document.getElementById("fab").addEventListener("click", () => {
  if (currentMode === "debt") {
    if (currentView === "person-history" && _currentHistoryPersonId) {
      openDebtModal(null);
      setDebtPerson(_currentHistoryPersonId);
    } else {
      openDebtModal(null);
    }
  } else {
    openModal(null);
  }
});
$("#modalClose").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});

function showColorPanel(items) {
  const box = $("#newColorList");
  box.innerHTML = "";
  items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "nc-row";
    row.innerHTML = `
      <input type="color" value="${FALLBACK[i % FALLBACK.length]}" />
      <span class="nc-label">${escapeHtml(it.name)}</span>
      <span class="nc-tag">${it.kind === "cat" ? "Category" : "Sub of " + escapeHtml(it.category)}</span>`;
    box.appendChild(row);
  });
  $("#newColorPanel").classList.remove("hidden");
  $("#saveBtn").textContent = "Confirm & Save";
}

/* ---------------- Split the bill (Add Record modal) ---------------- */
// Every share field (mine included) is either typed (number) or blank (null).
// State mirrors exactly what's visible — save reads state, never the DOM, so
// number-input badInput quirks ("250." reads as "") can't desync anything.
let splitPeople = []; // [{ personId, amount: number|null }] — null = blank
let splitMine = null; // my share; null = blank
let splitLastEdited = null; // "me" | personId — which side 2-person solve mirrors

function splitTotalAmount() {
  return parseFloat($("#fAmount").value) || 0;
}
function splitMyShare() {
  return splitMine == null ? 0 : Math.round(Number(splitMine) * 100) / 100;
}

// 2-person mode only: the side the user did NOT just edit mirrors
// total − edited side. DOM-direct (no re-render) so the focused input keeps
// its caret; blank edited side leaves the counterpart untouched.
function solve2p() {
  if (splitPeople.length !== 1 || !splitLastEdited) return;
  const total = splitTotalAmount();
  if (!(total > 0)) return;
  if (splitLastEdited === "me") {
    if (splitMine == null) return;
    splitPeople[0].amount = Math.round((total - splitMine) * 100) / 100;
    const el = document.querySelector('#splitRows .split-row[data-pid] .split-amt');
    if (el) el.value = splitPeople[0].amount.toFixed(2);
  } else {
    if (splitPeople[0].amount == null) return;
    splitMine = Math.round((total - splitPeople[0].amount) * 100) / 100;
    const el = document.getElementById("splitMyAmt");
    if (el) {
      el.value = splitMine.toFixed(2);
      el.classList.toggle("neg", splitMine < 0);
    }
  }
}

// Show/hide/enable the whole section based on: add-vs-edit, record type,
// recurring-toggle state (mutually exclusive), and whether a total is entered.
function syncSplitSection() {
  const section = document.getElementById("splitSection");
  const toggle = document.getElementById("splitToggle");
  const body = document.getElementById("splitBody");
  const hint = document.getElementById("splitHint");
  if (!section || !toggle || !body) return;
  const recOn = !!document.getElementById("recRecurringToggle")?.checked;
  const allowed = !editingId && modalType === "expense" && !recOn;
  section.classList.toggle("hidden", !allowed);
  if (!allowed && toggle.checked) {
    toggle.checked = false;
    splitPeople = [];
    splitMine = null;
    splitLastEdited = null;
  }
  const hasAmount = splitTotalAmount() > 0;
  toggle.disabled = !hasAmount;
  if (hint) hint.classList.toggle("hidden", hasAmount);
  if (!hasAmount && toggle.checked) {
    toggle.checked = false;
    splitPeople = [];
    splitMine = null;
    splitLastEdited = null;
  }
  body.classList.toggle("hidden", !toggle.checked);
  // Mutual exclusion: hide the recurring section while split is on.
  const recSection = document.getElementById("recRecurringSection");
  if (recSection) recSection.classList.toggle("hidden", toggle.checked);
  if (toggle.checked) {
    renderSplitRows();
  } else {
    // Clear the rows when off — a hidden invalid input (e.g. negative
    // remainder) would otherwise silently block native form submission.
    const rows = document.getElementById("splitRows");
    if (rows) rows.innerHTML = "";
    splitMine = null;
    splitLastEdited = null;
  }
}

function renderSplitRows() {
  const box = document.getElementById("splitRows");
  if (!box) return;
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const myName = (store.profile && store.profile.displayName) || "Me";
  const mineNeg = splitMine != null && splitMine < 0;
  let html =
    '<div class="split-row split-row-me">' +
      '<span class="pick-ico" style="background:var(--accent)">' + personIconSvg("person") + '</span>' +
      '<span class="split-name">' + escapeHtml(myName) + ' <span class="split-you">(you)</span></span>' +
      '<input type="number" class="split-amt split-amt-me' + (mineNeg ? " neg" : "") + '" id="splitMyAmt" inputmode="decimal" step="0.01" placeholder="0.00" value="' + (splitMine == null ? "" : Number(splitMine).toFixed(2)) + '" />' +
    '</div>';
  for (const row of splitPeople) {
    const p = peopleById[row.personId];
    if (!p) continue;
    html +=
      '<div class="split-row" data-pid="' + p.id + '">' +
        '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
        '<span class="split-name">' + escapeHtml(p.name) + '</span>' +
        '<input type="number" class="split-amt" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + (row.amount != null ? Number(row.amount).toFixed(2) : "") + '" />' +
        '<button type="button" class="split-remove" aria-label="Remove">✕</button>' +
      '</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll(".split-row[data-pid]").forEach((rowEl) => {
    const pid = rowEl.dataset.pid;
    // Partial update on input (no re-render — keeps the input focused).
    rowEl.querySelector(".split-amt").addEventListener("input", (e) => {
      const rec = splitPeople.find((r) => r.personId === pid);
      if (!rec) return;
      const v = parseFloat(e.target.value);
      rec.amount = Number.isFinite(v) ? v : null;
      splitLastEdited = pid;
      solve2p();
    });
    rowEl.querySelector(".split-remove").addEventListener("click", () => {
      splitPeople = splitPeople.filter((r) => r.personId !== pid);
      renderSplitRows();
    });
  });
  const myInput = box.querySelector("#splitMyAmt");
  if (myInput) {
    myInput.addEventListener("input", () => {
      const v = parseFloat(myInput.value);
      splitMine = Number.isFinite(v) ? v : null;
      splitLastEdited = "me";
      myInput.classList.toggle("neg", splitMine != null && splitMine < 0);
      solve2p();
    });
  }
  // Auto button: only meaningful with 3+ participants (2-person solves live).
  const autoBtn = document.getElementById("splitAutoBtn");
  if (autoBtn) autoBtn.classList.toggle("hidden", splitPeople.length < 2);
}

// Bring the bottom of the form (where the split section lives) into view.
function scrollSplitIntoView() {
  const form = document.getElementById("recordForm");
  if (form) form.scrollTo({ top: form.scrollHeight, behavior: "smooth" });
}

// "+ Add person" menu: DebtTrakr people not yet added, plus "+ New person".
function buildSplitPersonMenu() {
  const menu = document.getElementById("splitPersonMenu");
  if (!menu) return;
  loadStore();
  const taken = new Set(splitPeople.map((r) => r.personId));
  const avail = (store.settings.people || []).filter((p) => !taken.has(p.id));
  menu.innerHTML =
    avail.map((p) =>
      '<button type="button" class="picker-opt" data-pid="' + p.id + '">' +
        '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
        '<span>' + escapeHtml(p.name) + '</span>' +
      '</button>'
    ).join("") +
    '<button type="button" class="picker-opt" data-new="1">+ New person</button>';
  menu.querySelectorAll(".picker-opt").forEach((b) => {
    b.addEventListener("click", () => {
      menu.classList.add("hidden");
      if (b.dataset.new) {
        document.getElementById("splitNewPersonForm").classList.remove("hidden");
        document.getElementById("splitNewPersonName").focus();
        return;
      }
      splitPeople.push({ personId: b.dataset.pid, amount: null });
      renderSplitRows();
      scrollSplitIntoView();
    });
  });
}

(function wireSplitSection() {
  const toggle = document.getElementById("splitToggle");
  if (!toggle) return;
  toggle.addEventListener("change", () => {
    syncSplitSection();
    // The section expands near the bottom of the form — bring it into view.
    if (toggle.checked) scrollSplitIntoView();
  });
  $("#fAmount").addEventListener("input", () => {
    solve2p(); // 2-person mode: re-mirror the counterpart to the new total
    syncSplitSection();
  });
  // Mutual exclusion (other direction): recurring ON hides split.
  const recToggle = document.getElementById("recRecurringToggle");
  if (recToggle) recToggle.addEventListener("change", syncSplitSection);

  // "+ Add person" menu open/close
  const addBtn = document.getElementById("splitAddPersonBtn");
  const menu = document.getElementById("splitPersonMenu");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    buildSplitPersonMenu();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#splitPersonPicker")) menu.classList.add("hidden");
  });

  // Split evenly: total / (me + others), remainder cent to me (index 0).
  document.getElementById("splitEvenBtn").addEventListener("click", () => {
    const total = splitTotalAmount();
    if (!(total > 0) || splitPeople.length === 0) return;
    const shares = evenShares(total, splitPeople.length + 1);
    splitMine = shares[0];
    splitPeople.forEach((r, i) => { r.amount = shares[i + 1]; });
    splitLastEdited = null;
    renderSplitRows();
  });

  // Auto: split the REMAINING amount evenly across the blank fields only.
  document.getElementById("splitAutoBtn").addEventListener("click", () => {
    const err = $("#modalError");
    const total = splitTotalAmount();
    if (!(total > 0) || splitPeople.length < 2) return;
    const blanks = [];
    if (splitMine == null) blanks.push("me");
    for (const r of splitPeople) if (r.amount == null) blanks.push(r.personId);
    if (!blanks.length) {
      err.textContent = "All shares are filled — clear one to use Auto.";
      return;
    }
    const filled = [];
    if (splitMine != null) filled.push(splitMine);
    for (const r of splitPeople) if (r.amount != null) filled.push(r.amount);
    const shares = fillBlanks(total, filled, blanks.length);
    if (!shares.length) {
      err.textContent = "Nothing left to split — the filled shares already reach the total.";
      return;
    }
    err.textContent = "";
    blanks.forEach((key, i) => {
      if (key === "me") splitMine = shares[i];
      else {
        const rec = splitPeople.find((r) => r.personId === key);
        if (rec) rec.amount = shares[i];
      }
    });
    splitLastEdited = null;
    renderSplitRows();
  });

  // Inline new-person mini-form (same pattern as the Add Debt modal).
  const form = document.getElementById("splitNewPersonForm");
  document.getElementById("splitNewPersonCancel").addEventListener("click", () => {
    form.classList.add("hidden");
  });
  // Enter in the name field saves the person — not the whole record form.
  document.getElementById("splitNewPersonName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("splitNewPersonSave").click();
    }
  });
  document.getElementById("splitNewPersonSave").addEventListener("click", () => {
    const name = document.getElementById("splitNewPersonName").value.trim();
    if (!name) return;
    const color = document.getElementById("splitNewPersonColor").value || "#7c5cff";
    loadStore();
    const newId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    store.settings.people.push({ id: newId, name, color, icon: "person" });
    saveStore();
    document.getElementById("splitNewPersonName").value = "";
    form.classList.add("hidden");
    splitPeople.push({ personId: newId, amount: null });
    renderSplitRows();
    scrollSplitIntoView();
  });
})();

$("#recordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#modalError").textContent = "";
  const payload = {
    category: $("#fCategory").value.trim(),
    subcategory: $("#fSub").value.trim(),
    date: $("#fDate").value,
    amount: parseFloat($("#fAmount").value),
    currency: $("#fCurrency").value,
    notes: $("#fNotes").value.trim(),
    type: modalType,
  };
  if (!payload.category) return ($("#modalError").textContent = "Category is required");
  if (!payload.date) return ($("#modalError").textContent = "Date is required");
  if (!(payload.amount >= 0))
    return ($("#modalError").textContent = "Enter a valid amount");
  payload.amount = Math.round(payload.amount * 100) / 100; // money is cents-precision

  // Recurring sub-form bounds — novalidate means JS must enforce what native did.
  if (document.getElementById("recRecurringToggle")?.checked) {
    const cadenceBtn = document.querySelector("#recCadence button.seg-on");
    const cadenceKind = (cadenceBtn && cadenceBtn.dataset.v) || "daily";
    if (cadenceKind === "monthly" || cadenceKind === "yearly") {
      const el = document.getElementById(cadenceKind === "monthly" ? "recDayOfMonth" : "recYearDay");
      const d = Number(el.value);
      if (!Number.isInteger(d) || d < 1 || d > 31)
        return ($("#modalError").textContent = "Recurring day must be a whole number from 1 to 31");
    }
    const endBtn = document.querySelector("#recEnd button.seg-on");
    if (endBtn && endBtn.dataset.v === "count") {
      const n = Number(document.getElementById("recEndCount").value);
      if (!Number.isInteger(n) || n < 1)
        return ($("#modalError").textContent = "Occurrences must be a whole number of at least 1");
    }
  }

  // ----- Split the bill (Add flow only) -----
  const splitOn =
    !editingId &&
    modalType === "expense" &&
    !!document.getElementById("splitToggle")?.checked;
  let splitPlan = null;
  if (splitOn) {
    if (splitPeople.length === 0)
      return ($("#modalError").textContent = "Add at least one person to split with");
    for (const r of splitPeople) {
      if (!(Number(r.amount) > 0))
        return ($("#modalError").textContent = "Every person needs a share greater than 0");
    }
    const mine = splitMyShare(); // blank = 0 (paying nothing yourself is fine)
    if (mine < 0)
      return ($("#modalError").textContent = "Shares exceed the total amount");
    loadStore();
    const peopleById = {};
    for (const p of (store.settings.people || [])) peopleById[p.id] = p;
    const myName = (store.profile && store.profile.displayName) || "Me";
    const parts = splitPeople.map((r) => ({
      personId: r.personId,
      name: (peopleById[r.personId] || {}).name || "?",
      amount: Math.round(Number(r.amount) * 100) / 100,
    }));
    // Cent-exact check on the values that will actually be stored (parts are
    // rounded above; a typed 83.333 must not pass validation yet store 83.33).
    const partCents = parts.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const diffCents = Math.round(payload.amount * 100) - Math.round(mine * 100) - partCents;
    if (diffCents !== 0)
      return ($("#modalError").textContent =
        "Shares must add up to the total (off by " + fmt(Math.abs(diffCents) / 100, payload.currency) + ")");
    const breakdown =
      "Split bill — total " + fmt(payload.amount, payload.currency) + ": " +
      [myName + " " + fmt(mine, "")]
        .concat(parts.map((p) => p.name + " " + fmt(p.amount, "")))
        .join(" · ");
    splitPlan = { parts }; // only the participants' shares are needed downstream
    payload.amount = mine; // expense records the user's share only
    payload.notes = (payload.notes ? payload.notes + "\n" : "") + breakdown;
  }

  // step 1: detect new category/sub and ask for colours
  if (!pendingNew) {
    const news = detectNew(payload.type, payload.category, payload.subcategory);
    if (news.length) {
      pendingNew = news;
      showColorPanel(news);
      return;
    }
  }
  // step 2: persist new settings (if any) then save record
  try {
    if (pendingNew) {
      const colors = $$("#newColorList .nc-row input[type=color]").map(
        (i) => i.value
      );
      applyNewToSettings(pendingNew, colors);
      settings = await api("/settings", "PUT", settings);
      pendingNew = null;
    }
    let savedRecord = null;
    if (editingId) savedRecord = await api("/records/" + editingId, "PUT", payload);
    else savedRecord = await api("/records", "POST", payload);
    // Split: one "lend" debt per participant (independent records — no links).
    if (splitPlan) {
      // Convert everything first, then persist all debts in ONE saveStore()
      // so a mid-loop interruption can't leave a partial split behind.
      const newDebts = [];
      for (const part of splitPlan.parts) {
        const d = {
          type: "lend",
          personId: part.personId,
          date: payload.date,
          amount: part.amount,
          currency: payload.currency,
          // Same notes as the expense: user's notes first, then the breakdown.
          notes: payload.notes,
        };
        try { await attachConversion(d); } catch (_e) { d.rateUnavailable = true; }
        newDebts.push(d);
      }
      loadStore();
      const base = Date.now();
      newDebts.forEach((d, i) => {
        d.id = "debt_" + (base + i).toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        d.createdAt = base + i;
        d.updatedAt = base + i;
        store.debts.push(d);
      });
      saveStore();
    }
    // "Make this recurring" — create a rule from the saved record.
    // Allowed when:
    //   (a) the record has no ruleId yet, OR
    //   (b) this save is an explicit recreate from a deleted-rule orphan
    //       (the State C button sets data-recreate-for-ruleless on the toggle wrap).
    const togglWrap = document.getElementById("recRecurringDetails");
    const isRecreate = togglWrap && togglWrap.dataset.recreateForRuleless === "1";
    if (
      document.getElementById("recRecurringToggle")?.checked &&
      savedRecord &&
      (!savedRecord.ruleId || isRecreate)
    ) {
      await createRuleFromAddRecord(savedRecord);
    }
    // Pending-confirmation callback (Edit flow from dashboard banner)
    const onSaved = window.__pendingOnSaved;
    window.__pendingOnSaved = null;
    if (onSaved && savedRecord) {
      // Stamp ruleId on the saved record so provenance badge shows up.
      // The pending callback knows the ruleId; just call it.
      await onSaved(savedRecord);
    }
    closeModal();
    await loadRecords();
  } catch (err) {
    $("#modalError").textContent = err.message;
  }
});
$("#deleteBtn").addEventListener("click", async () => {
  if (!editingId || !confirm("Delete this record?")) return;
  try {
    await api("/records/" + editingId, "DELETE");
    closeModal();
    await loadRecords();
  } catch (err) {
    $("#modalError").textContent = err.message;
  }
});

/* ---------------- Settings view ---------------- */
function openSettings() {
  $("#defCurrencyMsg").textContent = "";
  $("#settingsMsg").textContent = "";
  $("#backupMsg") && ($("#backupMsg").textContent = "");
  $("#curMsg").textContent = "";
  fillCurrencySelects();
  $("#setDefCurrency").value = settings.defaultCurrency || "THB";
  if ($("#setUserName")) {
    $("#setUserName").value = (store.profile && store.profile.displayName) || "Me";
    if ($("#userNameMsg")) $("#userNameMsg").textContent = "";
  }
  if ($("#setDebtShareLanguage")) {
    $("#setDebtShareLanguage").value = settings.debtShareLanguage || "en";
    if ($("#debtShareLanguageMsg")) $("#debtShareLanguageMsg").textContent = "";
  }
  if ($("#setFxMarkup")) {
    $("#setFxMarkup").value = settings.fxMarkupPct || 0;
    if ($("#fxMarkupMsg")) $("#fxMarkupMsg").textContent = "";
  }
  if ($("#setTheme")) $("#setTheme").value = settings.theme || "default";
  $("#hiMsg") && ($("#hiMsg").textContent = "");
  applyHeaderIcon();
  settingsDraft = JSON.parse(JSON.stringify(settings));
  curDraft = (settings.currencies || []).slice();
  catTypeTab = "expense";
  $$("#catTypeSeg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.t === "expense")
  );
  renderCatManager();
  renderCurManager();
}

/* ---- Backup / Restore (data lives only on this device) ---- */
function backupFileName() {
  return "munitrakr-backup-" + new Date().toISOString().slice(0, 10) + ".json";
}
function backupBlob() {
  loadStore();
  return new Blob([JSON.stringify(store, null, 2)], {
    type: "application/json",
  });
}
function downloadBackup() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(backupBlob());
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("#backupMsg").style.color = "var(--in)";
  $("#backupMsg").textContent = "Backup downloaded.";
}
// One-tap share → iOS share sheet (Google Drive, Files, iCloud, email…)
$("#shareBackupBtn").addEventListener("click", async () => {
  const msg = $("#backupMsg");
  msg.style.color = "";
  const name = backupFileName();
  try {
    const file = new File([backupBlob()], name, {
      type: "application/json",
    });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // files only — adding title/text makes some targets save a 2nd file
      await navigator.share({ files: [file] });
      msg.style.color = "var(--in)";
      msg.textContent = "Backup shared.";
      return;
    }
    // Sharing genuinely unsupported → single download fallback
    downloadBackup();
    msg.textContent =
      "Sharing isn't supported here — downloaded the file instead.";
  } catch (err) {
    // Don't auto-download here (the share may have already delivered the
    // file — downloading again would create a duplicate).
    msg.textContent =
      err && err.name === "AbortError" ? "" : "Backup not shared.";
  }
});
$("#restoreInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== "object" || !Array.isArray(data.records))
        throw new Error("Not a valid backup file");
      if (
        !confirm(
          "Restore will REPLACE all current data on this device with the backup. Continue?"
        )
      ) {
        e.target.value = "";
        return;
      }
      store = data;
      if (!store.settings) store.settings = defaultSettings();
      if (!store.profile) store.profile = { displayName: "Me" };
      saveStore();
      $("#backupMsg").style.color = "var(--in)";
      $("#backupMsg").textContent = "Restored. Reloading…";
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      $("#backupMsg").style.color = "";
      $("#backupMsg").textContent = "Restore failed: " + err.message;
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});
$$("#catTypeSeg button").forEach((b) =>
  b.addEventListener("click", () => {
    catTypeTab = b.dataset.t;
    $$("#catTypeSeg button").forEach((x) =>
      x.classList.toggle("active", x === b)
    );
    renderCatManager();
  })
);
function renderCatManager() {
  const list = settingsDraft[catTypeTab] || [];
  const box = $("#catManager");
  box.innerHTML = "";
  list.forEach((cat, ci) => {
    const row = document.createElement("div");
    if (!cat.id) cat.id = "c" + Date.now() + ci;
    row.className = "cat-row" + (openCats.has(cat.id) ? " open" : "");
    row.dataset.idx = ci;
    if (!cat.icon) cat.icon = "tag";
    row.innerHTML = `
      <div class="cat-main">
        <button type="button" class="drag-handle cat-drag" aria-label="Reorder">⠿</button>
        <div class="cat-left">
          <button type="button" class="icon-pick" title="Choose icon"
            style="background:${cat.color}">${iconSvg(cat.icon, "ip-svg")}</button>
          <input type="color" value="${cat.color}" data-ci="${ci}" data-k="catcolor" />
        </div>
        <input type="text" value="${escapeHtml(cat.name)}" data-ci="${ci}" data-k="catname" />
        <button type="button" class="cat-toggle">Subs (${cat.subs.length})</button>
        <button type="button" class="cat-del">✕</button>
      </div>
      <div class="subs"></div>`;
    const iconBtn = row.querySelector(".icon-pick");
    iconBtn.addEventListener("click", () => {
      openCatIconPicker(cat.icon, (next) => {
        cat.icon = next;
        iconBtn.innerHTML = iconSvg(cat.icon, "ip-svg");
      });
    });
    const subsBox = row.querySelector(".subs");
    cat.subs.forEach((s, si) => {
      const sr = document.createElement("div");
      sr.className = "sub-row";
      sr.dataset.idx = si;
      sr.innerHTML = `
        <button type="button" class="drag-handle sub-drag" aria-label="Reorder">⠿</button>
        <input type="color" value="${s.color}" data-ci="${ci}" data-si="${si}" data-k="subcolor" />
        <input type="text" value="${escapeHtml(s.name)}" data-ci="${ci}" data-si="${si}" data-k="subname" />
        <button type="button" class="cat-del" data-del-sub="${si}">✕</button>`;
      subsBox.appendChild(sr);
    });
    const addSub = document.createElement("button");
    addSub.type = "button";
    addSub.className = "add-sub";
    addSub.textContent = "+ Add sub-category";
    addSub.addEventListener("click", () => {
      cat.subs.push({
        id: "s" + Date.now(),
        name: "New sub",
        color: FALLBACK[cat.subs.length % FALLBACK.length],
      });
      openCats.add(cat.id);
      renderCatManager();
    });
    subsBox.appendChild(addSub);
    makeDraggable(subsBox, ".sub-row", ".sub-drag", cat.subs, renderCatManager);
    row.querySelector(".cat-toggle").addEventListener("click", () => {
      if (openCats.has(cat.id)) openCats.delete(cat.id);
      else openCats.add(cat.id);
      row.classList.toggle("open");
    });
    row.querySelector(".cat-main .cat-del").addEventListener("click", () => {
      if (confirm(`Delete category "${cat.name}"?`)) {
        list.splice(ci, 1);
        renderCatManager();
      }
    });
    subsBox.querySelectorAll("[data-del-sub]").forEach((btn) =>
      btn.addEventListener("click", () => {
        cat.subs.splice(+btn.dataset.delSub, 1);
        renderCatManager();
      })
    );
    box.appendChild(row);
  });
  makeDraggable(box, ".cat-row", ".cat-drag", list, renderCatManager);
  box.querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("input", () => {
      const ci = +inp.dataset.ci;
      const k = inp.dataset.k;
      if (k === "catcolor") {
        list[ci].color = inp.value;
        const ip = inp.closest(".cat-row").querySelector(".icon-pick");
        if (ip) ip.style.background = inp.value;
      }
      if (k === "catname") list[ci].name = inp.value;
      if (k === "subcolor") list[ci].subs[+inp.dataset.si].color = inp.value;
      if (k === "subname") list[ci].subs[+inp.dataset.si].name = inp.value;
    })
  );
}
// Category icon-picker modal — reusable. Mirrors openPersonIconPicker.
function openCatIconPicker(currentIconId, onPick) {
  const m = document.getElementById("catIconModal");
  const grid = document.getElementById("catIconGrid");
  if (!m || !grid) return;
  grid.innerHTML = ICON_IDS.map((id) =>
    '<button type="button" data-id="' + id + '" class="' + (id === currentIconId ? "active" : "") + '">' +
      iconSvg(id) +
    '</button>'
  ).join("");
  grid.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      grid.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      onPick(b.dataset.id);
      closeCatIconPicker();
    });
  });
  m.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeCatIconPicker() {
  const m = document.getElementById("catIconModal");
  if (m) m.classList.add("hidden");
  const otherModalIds = ["modal", "ruleModal", "personIconModal"];
  const anyOpen = otherModalIds.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
  if (!anyOpen) document.body.classList.remove("modal-open");
}
document.getElementById("catIconClose")?.addEventListener("click", closeCatIconPicker);

// Icon picker state for the "Add a new category" row.
let _newCatIconId = "tag";
function _paintNewCatIconTile() {
  const tile = document.getElementById("newCatIcon");
  if (!tile) return;
  tile.innerHTML = iconSvg(_newCatIconId, "ip-svg");
  const color = document.getElementById("newCatColor");
  if (color) tile.style.background = color.value || "#7c5cff";
}
(function wireNewCatIcon() {
  const tile = document.getElementById("newCatIcon");
  if (!tile) return;
  _paintNewCatIconTile();
  tile.addEventListener("click", () => {
    openCatIconPicker(_newCatIconId, (next) => {
      _newCatIconId = next;
      _paintNewCatIconTile();
    });
  });
  const colorInp = document.getElementById("newCatColor");
  if (colorInp) {
    colorInp.addEventListener("input", () => {
      tile.style.background = colorInp.value;
    });
  }
})();
$("#addCatBtn").addEventListener("click", () => {
  const name = $("#newCatName").value.trim();
  if (!name) return;
  settingsDraft[catTypeTab].push({
    id: "c" + Date.now(),
    name,
    color: $("#newCatColor").value,
    icon: _newCatIconId,
    subs: [],
  });
  $("#newCatName").value = "";
  _newCatIconId = "tag";
  _paintNewCatIconTile();
  renderCatManager();
});
$("#saveUserName")?.addEventListener("click", async () => {
  const msg = $("#userNameMsg");
  if (msg) msg.textContent = "";
  const name = ($("#setUserName").value || "").trim();
  try {
    await api("/account", "PUT", { displayName: name || "Me" });
    if (msg) {
      msg.style.color = "var(--in)";
      msg.textContent = "Saved.";
    }
  } catch (err) {
    if (msg) {
      msg.style.color = "";
      msg.textContent = err.message;
    }
  }
});
$("#saveDebtShareLanguage")?.addEventListener("click", async () => {
  const msg = $("#debtShareLanguageMsg");
  if (msg) msg.textContent = "";
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
    if ($("#setDebtShareLanguage")) {
      $("#setDebtShareLanguage").value = settings.debtShareLanguage || "en";
    }
    if (msg) {
      msg.style.color = "var(--in)";
      msg.textContent = "Saved.";
    }
  } catch (err) {
    if (msg) {
      msg.style.color = "";
      msg.textContent = err.message;
    }
  }
});
$("#saveFxMarkup")?.addEventListener("click", async () => {
  const msg = $("#fxMarkupMsg");
  if (msg) msg.textContent = "";
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
    if ($("#setFxMarkup")) $("#setFxMarkup").value = settings.fxMarkupPct || 0;
    if (msg) {
      msg.style.color = "var(--in)";
      msg.textContent = (settings.fxMarkupPct || 0) > 0
        ? "Markup set to " + settings.fxMarkupPct + "% — applied to all new conversions."
        : "Markup off.";
    }
  } catch (err) {
    if (msg) { msg.style.color = ""; msg.textContent = err.message; }
  }
});
$("#saveDefCurrency").addEventListener("click", async () => {
  $("#defCurrencyMsg").textContent = "";
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
    fillCurrencySelects();
    renderCurManager();
    refresh();
    $("#defCurrencyMsg").style.color = "var(--in)";
    $("#defCurrencyMsg").textContent =
      "Default currency set to " + settings.defaultCurrency + ".";
  } catch (err) {
    $("#defCurrencyMsg").style.color = "";
    $("#defCurrencyMsg").textContent = err.message;
  }
});
$("#saveSettings").addEventListener("click", async () => {
  $("#settingsMsg").textContent = "";
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
    populateDatalists();
    fillCurrencySelects();
    await loadRecords(); // pull renamed records so cards update immediately
    renderCatManager();
    renderCurManager();
    $("#settingsMsg").style.color = "var(--in)";
    $("#settingsMsg").textContent = "Categories saved.";
  } catch (err) {
    $("#settingsMsg").style.color = "";
    $("#settingsMsg").textContent = err.message;
  }
});

/* ---------------- Boot ---------------- */
(async function boot() {
  loadStore();
  await enterApp();
})();

/* Register service worker; auto-apply updates so new versions show up. */
if ("serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller)
              nw.postMessage("skipWaiting");
          });
        });
      })
      .catch(() => {})
  );
}

/* ---- Check for updates (same-origin PWA self-update) ---- */
$("#appVer").textContent = "MuniTrakr " + APP_VERSION;
$("#checkUpdateBtn").addEventListener("click", async () => {
  const m = $("#updateMsg");
  m.style.color = "";
  m.textContent = "Checking…";
  if (!("serviceWorker" in navigator)) {
    m.textContent = "Updates aren't supported in this browser.";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      // not installed yet — just pull the freshest files
      m.textContent = "Loading the latest version…";
      setTimeout(() => location.reload(), 500);
      return;
    }
    await reg.update();
    setTimeout(() => {
      if (reg.waiting) {
        reg.waiting.postMessage("skipWaiting"); // → controllerchange → reload
        m.textContent = "Updating to the new version…";
      } else if (reg.installing) {
        m.textContent = "Downloading update…";
      } else {
        m.style.color = "var(--in)";
        m.textContent =
          "You're on the latest version (" + APP_VERSION + ").";
      }
    }, 1500);
  } catch (err) {
    m.textContent = "Couldn't check for updates: " + err.message;
  }
});

/* ---- Collapsible settings sections ---- */
(function setupCollapsibleSettings() {
  const CHEV =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  $$("#view-settings .settings-block").forEach((block) => {
    const title = block.querySelector(".block-title");
    if (!title || title.querySelector(".block-chevron")) return;
    const ch = document.createElement("span");
    ch.className = "block-chevron";
    ch.innerHTML = CHEV;
    title.appendChild(ch);
    block.classList.add("collapsed"); // all sections collapsed by default
    title.addEventListener("click", () =>
      block.classList.toggle("collapsed")
    );
  });
})();

/* ================================================================
   Recurring rules — UI (Task 10–14)
   ================================================================ */

function todayStr() {
  return ymd(new Date());
}

function cadenceSummary(c) {
  if (!c) return "—";
  if (c.kind === "daily") return "Daily";
  if (c.kind === "weekly") return "Weekly · " + ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][c.weekday];
  if (c.kind === "monthly") return "Monthly · day " + c.dayOfMonth;
  if (c.kind === "yearly") {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return "Yearly · " + months[(c.month||1)-1] + " " + c.day;
  }
  return c.kind;
}

function nextOccurrenceLabel(rule) {
  if (rule.paused) return "Paused";
  // Probe forward from today: clone rule with lastGeneratedDate = today, compute over the next ~13 months.
  const today = todayStr();
  const clone = JSON.parse(JSON.stringify(rule));
  clone.lastGeneratedDate = today;
  // Compute the date one year + 1 month from today as upper bound.
  const tdate = new Date();
  tdate.setMonth(tdate.getMonth() + 13);
  const horizon = ymd(tdate);
  const occ = computeOccurrences(clone, horizon);
  return occ[0] || "—";
}

/* ---- Settings list render ---- */
function renderRecurringSection() {
  const root = document.getElementById("recurringList");
  if (!root) return;
  loadStore();
  root.innerHTML = "";
  const rules = store.settings.recurring || [];
  if (!rules.length) {
    root.innerHTML = '<div class="recurring-empty">No recurring rules yet. Tap "+ Add rule" to create one.</div>';
    return;
  }
  for (const rule of rules) {
    const row = document.createElement("div");
    row.className = "recurring-row" + (rule.paused ? " paused" : "");
    row.dataset.ruleId = rule.id;
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
    const PLAY_SVG  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.5-6.8c.7-.4.7-1.4 0-1.8L9.6 4.3c-.7-.4-1.6.1-1.6.9z"/></svg>';
    row.innerHTML =
      '<div class="rr-body">' +
        '<div class="rr-title">' + escapeHtml(rule.category || "(no category)") + ' · ' + escapeHtml(cadenceSummary(rule.cadence)) + '</div>' +
        '<div class="rr-meta">' + fmt(rule.amount, rule.currency) + ' · ' + (rule.autoConfirm ? "Auto-confirm ON" : "Confirm each") + ' · Next: ' + escapeHtml(nextOccurrenceLabel(rule)) + '</div>' +
      '</div>' +
      '<div class="rr-actions">' +
        '<button type="button" class="rr-icon-btn rr-pause" title="' + (rule.paused ? "Resume" : "Pause") + '" aria-label="' + (rule.paused ? "Resume" : "Pause") + '">' + (rule.paused ? PLAY_SVG : PAUSE_SVG) + '</button>' +
      '</div>';
    row.querySelector(".rr-pause").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePauseRule(rule.id);
    });
    row.addEventListener("click", () => openRuleEditor(rule.id));
    root.appendChild(row);
  }
}

function togglePauseRule(ruleId) {
  loadStore();
  const rule = store.settings.recurring.find((r) => r.id === ruleId);
  if (!rule) return;
  if (rule.paused) {
    unpauseRule(rule, todayStr());
  } else {
    rule.paused = true;
    rule.updatedAt = new Date().toISOString();
  }
  saveStore();
  renderRecurringSection();
}

/* ---- Rule editor modal (Task 11) ---- */
function newRuleDraft() {
  return {
    id: "rule_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    type: activeType || "expense",
    category: "", subcategory: "", amount: 0,
    currency: store.settings.defaultCurrency,
    notes: "",
    cadence: { kind: "daily" },
    startDate: todayStr(),
    occurrenceCount: 0, autoConfirm: true, paused: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function setSeg(segId, value) {
  const root = document.getElementById(segId);
  if (!root) return;
  for (const b of root.querySelectorAll("button")) {
    b.classList.toggle("seg-on", b.dataset.v === String(value));
    b.classList.toggle("active", b.dataset.v === String(value));
  }
}
function wireSeg(segId, onChange) {
  const root = document.getElementById(segId);
  if (!root) return;
  for (const b of root.querySelectorAll("button")) {
    b.onclick = () => {
      for (const x of root.querySelectorAll("button")) {
        const on = x === b;
        x.classList.toggle("seg-on", on);
        x.classList.toggle("active", on);
      }
      onChange(b.dataset.v);
    };
  }
}

function showCadenceSub(kind) {
  document.getElementById("ruleWeeklyWrap").classList.toggle("hidden", kind !== "weekly");
  document.getElementById("ruleMonthlyWrap").classList.toggle("hidden", kind !== "monthly");
  document.getElementById("ruleYearlyWrap").classList.toggle("hidden", kind !== "yearly");
}
function showEndSub(kind) {
  document.getElementById("ruleEndDateWrap").classList.toggle("hidden", kind !== "date");
  document.getElementById("ruleEndCountWrap").classList.toggle("hidden", kind !== "count");
}

// Rule-modal Category/Sub pickers — same UX as the Add Record modal (icons,
// dropdown menus, sub-field hides when category has no subs). The rule object
// is mutated as the user picks.
function populateRuleCategorySelects(rule) {
  ruleBuildCatMenu(rule);
  // If existing rule.category is no longer valid after a type-switch, clear it.
  const cats = (rule.type === "expense" ? store.settings.expense : store.settings.investment) || [];
  if (rule.category && !cats.find((c) => c.name === rule.category)) rule.category = "";
  ruleSetCategory(rule, rule.category || "");
  if (rule.category && rule.subcategory) ruleSetSub(rule, rule.subcategory);
}

function ruleBuildCatMenu(rule) {
  const menu = document.getElementById("rulCatPickMenu");
  if (!menu) return;
  const cats = (rule.type === "expense" ? store.settings.expense : store.settings.investment) || [];
  menu.innerHTML = cats.map((c) =>
    `<button type="button" class="picker-opt" data-name="${escapeHtml(c.name)}">
       <span class="pick-ico" style="background:${c.color}">${iconSvg(c.icon || "tag")}</span>
       <span>${escapeHtml(c.name)}</span>
     </button>`
  ).join("");
  menu.querySelectorAll(".picker-opt").forEach((b) => {
    b.addEventListener("click", () => {
      ruleSetCategory(rule, b.dataset.name);
      menu.classList.add("hidden");
    });
  });
}

function ruleSetCategory(rule, name) {
  rule.category = name || "";
  document.getElementById("ruleCategory").value = rule.category;
  const cats = (rule.type === "expense" ? store.settings.expense : store.settings.investment) || [];
  const c = name ? cats.find((x) => x.name === name) : null;
  const val = document.getElementById("rulCatPickVal");
  if (c) {
    val.classList.remove("placeholder");
    val.innerHTML =
      `<span class="pick-ico" style="background:${c.color}">${iconSvg(c.icon || "tag")}</span>` +
      `<span>${escapeHtml(c.name)}</span>`;
  } else {
    val.classList.add("placeholder");
    val.textContent = "Select a category";
  }
  // Reset & rebuild sub menu / show-hide field
  ruleSetSub(rule, "");
  ruleBuildSubMenu(rule, name);
}

function ruleBuildSubMenu(rule, catName) {
  const cats = (rule.type === "expense" ? store.settings.expense : store.settings.investment) || [];
  const c = catName ? cats.find((x) => x.name === catName) : null;
  const subs = c ? (c.subs || []) : [];
  const field = document.getElementById("rulSubField");
  const menu = document.getElementById("rulSubPickMenu");
  if (!field || !menu) return;
  if (!subs.length) {
    field.classList.add("hidden");
    menu.innerHTML = "";
    return;
  }
  field.classList.remove("hidden");
  menu.innerHTML =
    `<button type="button" class="picker-opt" data-name="">
       <span class="pick-dot" style="background:#3a4152"></span><span>None</span>
     </button>` +
    subs.map((s) =>
      `<button type="button" class="picker-opt" data-name="${escapeHtml(s.name)}">
         <span class="pick-dot" style="background:${s.color}"></span><span>${escapeHtml(s.name)}</span>
       </button>`
    ).join("");
  menu.querySelectorAll(".picker-opt").forEach((b) => {
    b.addEventListener("click", () => {
      ruleSetSub(rule, b.dataset.name);
      menu.classList.add("hidden");
    });
  });
}

function ruleSetSub(rule, name) {
  rule.subcategory = name || "";
  document.getElementById("ruleSubcategory").value = rule.subcategory;
  const cats = (rule.type === "expense" ? store.settings.expense : store.settings.investment) || [];
  const c = rule.category ? cats.find((x) => x.name === rule.category) : null;
  const s = c && name ? (c.subs || []).find((x) => x.name === name) : null;
  const val = document.getElementById("rulSubPickVal");
  if (!val) return;
  if (s) {
    val.innerHTML = `<span class="pick-dot" style="background:${s.color}"></span><span>${escapeHtml(s.name)}</span>`;
  } else {
    val.textContent = "None";
  }
}

function populateRuleCurrency(rule) {
  const sel = document.getElementById("ruleCurrency");
  sel.innerHTML = (store.settings.currencies || []).map((c) => `<option value="${c}">${c}</option>`).join("");
  sel.value = rule.currency || store.settings.defaultCurrency;
  sel.onchange = () => { rule.currency = sel.value; };
}

function populateYearMonthSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel || sel.options.length) return;
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  sel.innerHTML = names.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");
}

function openRuleEditor(ruleId) {
  loadStore();
  const isNew = !ruleId;
  const existing = !isNew ? store.settings.recurring.find((r) => r.id === ruleId) : null;
  if (!isNew && !existing) return;
  const rule = isNew ? newRuleDraft() : JSON.parse(JSON.stringify(existing));

  const $m = document.getElementById("ruleModal");
  if (!$m) return;
  document.getElementById("ruleModalTitle").textContent = isNew ? "New recurring rule" : "Edit recurring rule";
  document.getElementById("ruleDelete").classList.toggle("hidden", isNew);

  setSeg("ruleType", rule.type);
  populateRuleCategorySelects(rule);
  // Show empty for new rules or any non-positive amount — the placeholder
  // ("0.00") communicates the format without misleading the user that the
  // field is pre-filled with a real value.
  document.getElementById("ruleAmount").value = rule.amount > 0 ? rule.amount : "";
  document.getElementById("ruleNotes").value = rule.notes || "";
  populateRuleCurrency(rule);

  setSeg("ruleCadence", rule.cadence?.kind || "daily");
  showCadenceSub(rule.cadence?.kind || "daily");
  document.getElementById("ruleWeekday").value = rule.cadence?.weekday ?? 1;
  document.getElementById("ruleDayOfMonth").value = rule.cadence?.dayOfMonth ?? 1;
  populateYearMonthSelect("ruleYearMonth");
  document.getElementById("ruleYearMonth").value = rule.cadence?.month ?? 1;
  document.getElementById("ruleYearDay").value = rule.cadence?.day ?? 1;

  document.getElementById("ruleStartDate").value = rule.startDate || todayStr();

  const endKind = rule.endDate ? "date" : (rule.maxOccurrences != null ? "count" : "none");
  setSeg("ruleEnd", endKind);
  showEndSub(endKind);
  document.getElementById("ruleEndDate").value = rule.endDate || "";
  document.getElementById("ruleEndCount").value = rule.maxOccurrences ?? 12;

  document.getElementById("ruleAutoConfirm").checked = rule.autoConfirm !== false;

  wireSeg("ruleType", (v) => { rule.type = v; populateRuleCategorySelects(rule); });
  wireSeg("ruleCadence", (v) => { rule.cadence = { ...(rule.cadence||{}), kind: v }; showCadenceSub(v); });
  wireSeg("ruleEnd", (v) => showEndSub(v));

  const errEl = document.getElementById("ruleError");
  if (errEl) errEl.textContent = "";

  $m.classList.remove("hidden");
  document.body.classList.add("modal-open");

  document.getElementById("ruleModalClose").onclick = closeRuleModal;
  document.getElementById("ruleSave").onclick = () => saveRuleFromModal(rule, isNew);
  document.getElementById("ruleDelete").onclick = () => deleteRuleFromModal(rule);
}

function closeRuleModal() {
  const $m = document.getElementById("ruleModal");
  if ($m) $m.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function saveRuleFromModal(draft, isNew) {
  // Collect form values into the draft FIRST.
  draft.category = document.getElementById("ruleCategory").value.trim();
  draft.subcategory = document.getElementById("ruleSubcategory").value.trim();
  draft.amount = Number(document.getElementById("ruleAmount").value) || 0;
  draft.notes = document.getElementById("ruleNotes").value;
  draft.currency = document.getElementById("ruleCurrency").value;
  draft.startDate = document.getElementById("ruleStartDate").value || todayStr();

  const cadenceKind = draft.cadence?.kind || "daily";
  draft.cadence = { kind: cadenceKind };
  if (cadenceKind === "weekly") draft.cadence.weekday = Number(document.getElementById("ruleWeekday").value);
  if (cadenceKind === "monthly") draft.cadence.dayOfMonth = Number(document.getElementById("ruleDayOfMonth").value);
  if (cadenceKind === "yearly") {
    draft.cadence.month = Number(document.getElementById("ruleYearMonth").value);
    draft.cadence.day = Number(document.getElementById("ruleYearDay").value);
  }

  const endKind = document.querySelector("#ruleEnd button.seg-on").dataset.v;
  draft.endDate = endKind === "date" ? (document.getElementById("ruleEndDate").value || undefined) : undefined;
  draft.maxOccurrences = endKind === "count" ? (Number(document.getElementById("ruleEndCount").value) || undefined) : undefined;

  draft.autoConfirm = document.getElementById("ruleAutoConfirm").checked;
  draft.updatedAt = new Date().toISOString();

  // Validation
  const err = document.getElementById("ruleError");
  if (err) err.textContent = "";
  if (!draft.category) {
    if (err) err.textContent = "Category is required.";
    return;
  }
  if (!(draft.amount > 0)) {
    if (err) err.textContent = "Amount must be greater than 0.";
    return;
  }

  // Floodgate: for newly-created rules, warn whenever save would generate any
  // past-dated record (i.e. real backfill). Today-only occurrences don't count
  // as backfill and skip the prompt. User can pick "Start from today" to skip
  // the past, "Generate all" to backfill, or X to cancel and keep editing.
  if (isNew) {
    const today = todayStr();
    const projected = computeOccurrences(draft, today);
    const pastCount = projected.filter((d) => d < today).length;
    if (pastCount > 0) {
      const choice = await askFloodgate(pastCount);
      if (choice === "cancel") return; // user backed out; leave rule editor open
      if (choice === "today") {
        // Bookmark to yesterday so today is still a valid first occurrence,
        // but nothing earlier is generated.
        const d = new Date();
        d.setDate(d.getDate() - 1);
        draft.lastGeneratedDate = ymd(d);
      }
    }
  }

  loadStore();
  if (isNew) {
    store.settings.recurring.push(draft);
  } else {
    const idx = store.settings.recurring.findIndex((r) => r.id === draft.id);
    if (idx >= 0) store.settings.recurring[idx] = draft;
  }
  saveStore();
  closeRuleModal();

  // Re-run processRecurring so any newly-due occurrences materialize now
  // (silent path) or land in the dashboard banner (confirm-each path) —
  // without requiring the user to reload the page.
  recurringProcessedThisBoot = false;
  await processRecurring();
  await loadRecords();
  renderRecurringSection();
  renderConfirmBanner();
}

// Modal prompt used when a brand-new rule would backfill past records.
// Resolves: "all" | "today" | "cancel". Cancel returns the user to the rule
// editor without saving.
function askFloodgate(count) {
  return new Promise((resolve) => {
    const m = document.getElementById("floodgateModal");
    const countEl = document.getElementById("floodgateCount");
    if (!m || !countEl) return resolve("all");
    countEl.textContent = String(count);
    m.classList.remove("hidden");
    document.body.classList.add("modal-open");
    const cleanup = () => {
      m.classList.add("hidden");
      // Only release modal-open if no other modal is showing.
      const anyOpen =
        !document.getElementById("modal").classList.contains("hidden") ||
        !document.getElementById("ruleModal").classList.contains("hidden");
      if (!anyOpen) document.body.classList.remove("modal-open");
    };
    document.getElementById("floodgateGenerate").onclick = () => { cleanup(); resolve("all"); };
    document.getElementById("floodgateStartToday").onclick = () => { cleanup(); resolve("today"); };
    document.getElementById("floodgateClose").onclick = () => { cleanup(); resolve("cancel"); };
    // Tap outside the card also cancels.
    m.onclick = (e) => { if (e.target.id === "floodgateModal") { cleanup(); resolve("cancel"); } };
  });
}

function deleteRuleFromModal(draft) {
  if (!confirm("Delete this rule? Records it already generated will be kept.")) return;
  loadStore();
  store.settings.recurring = store.settings.recurring.filter((r) => r.id !== draft.id);
  saveStore();
  renderRecurringSection();
  closeRuleModal();
}

// Wire Add button
const _addRecBtn = document.getElementById("addRecurringBtn");
if (_addRecBtn) _addRecBtn.addEventListener("click", () => openRuleEditor(null));

// Rule modal: picker button click → toggle its menu, close the other.
(function wireRulePickers() {
  const catBtn = document.getElementById("rulCatPickBtn");
  const subBtn = document.getElementById("rulSubPickBtn");
  const catMenu = document.getElementById("rulCatPickMenu");
  const subMenu = document.getElementById("rulSubPickMenu");
  if (catBtn && catMenu) {
    catBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (subMenu) subMenu.classList.add("hidden");
      catMenu.classList.toggle("hidden");
    });
  }
  if (subBtn && subMenu) {
    subBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (catMenu) catMenu.classList.add("hidden");
      subMenu.classList.toggle("hidden");
    });
  }
  // Click outside → close menus.
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#rulCatPicker") && catMenu) catMenu.classList.add("hidden");
    if (!e.target.closest("#rulSubPicker") && subMenu) subMenu.classList.add("hidden");
  });
})();

/* ---- Confirmation banner (Task 14) ---- */
function renderConfirmBanner() {
  const root = document.getElementById("confirmBanner");
  if (!root) return;
  if (!pendingConfirmations.length) {
    root.classList.add("hidden");
    root.innerHTML = "";
    return;
  }
  root.classList.remove("hidden");
  const shown = pendingConfirmations.slice(0, 3);
  const extra = pendingConfirmations.length - shown.length;
  let html = shown.map((p, i) =>
    '<div class="cb-row" data-i="' + i + '">' +
      '<div class="cb-text">' + escapeHtml(p.rule.category || "(rule)") + ' — ' + fmt(p.rule.amount, p.rule.currency) + ' — due ' + p.dueDate + '</div>' +
      '<div class="cb-actions">' +
        '<button class="cb-confirm" data-act="confirm">Confirm</button>' +
        '<button data-act="edit">Edit</button>' +
        '<button data-act="skip">Skip</button>' +
      '</div>' +
    '</div>'
  ).join("");
  if (extra > 0) {
    html += '<div class="cb-more">+' + extra + ' more</div>' +
      '<div class="cb-bulk">' +
        '<button id="cbConfirmAll" class="cb-confirm">Confirm all</button>' +
        '<button id="cbSkipAll">Skip all</button>' +
      '</div>';
  }
  root.innerHTML = html;
  for (const row of root.querySelectorAll(".cb-row")) {
    const i = Number(row.dataset.i);
    row.querySelector('[data-act="confirm"]').onclick = () => confirmPending(i);
    row.querySelector('[data-act="edit"]').onclick = () => editPending(i);
    row.querySelector('[data-act="skip"]').onclick = () => skipPending(i);
  }
  const ca = document.getElementById("cbConfirmAll");
  if (ca) ca.addEventListener("click", confirmAllPending);
  const sa = document.getElementById("cbSkipAll");
  if (sa) sa.addEventListener("click", skipAllPending);
}

async function confirmPending(idx) {
  const p = pendingConfirmations[idx];
  if (!p) return;
  loadStore();
  const rule = store.settings.recurring.find((r) => r.id === p.ruleId);
  if (!rule) { pendingConfirmations.splice(idx, 1); renderConfirmBanner(); return; }
  const rec = buildRecordFromRule(rule, p.dueDate);
  try { await attachConversion(rec); } catch (_e) { rec.rateUnavailable = true; }
  store.records.push(rec);
  rule.lastGeneratedDate = p.dueDate;
  rule.occurrenceCount = (rule.occurrenceCount || 0) + 1;
  applyEndChecks(rule);
  saveStore();
  pendingConfirmations.splice(idx, 1);
  await loadRecords();
  renderConfirmBanner();
}

function skipPending(idx) {
  const p = pendingConfirmations[idx];
  if (!p) return;
  loadStore();
  const rule = store.settings.recurring.find((r) => r.id === p.ruleId);
  if (!rule) { pendingConfirmations.splice(idx, 1); renderConfirmBanner(); return; }
  rule.lastGeneratedDate = p.dueDate;
  rule.occurrenceCount = (rule.occurrenceCount || 0) + 1;
  applyEndChecks(rule);
  saveStore();
  pendingConfirmations.splice(idx, 1);
  renderConfirmBanner();
}

function editPending(idx) {
  const p = pendingConfirmations[idx];
  if (!p) return;
  const rule = (store.settings.recurring || []).find((r) => r.id === p.ruleId);
  if (!rule) return;
  const draft = buildRecordFromRule(rule, p.dueDate);
  // Reuse openModal to edit the pre-filled draft, then on save treat as confirm.
  window.__pendingOnSaved = async (savedRecord) => {
    loadStore();
    const r2 = store.settings.recurring.find((r) => r.id === p.ruleId);
    if (r2) {
      r2.lastGeneratedDate = p.dueDate;
      r2.occurrenceCount = (r2.occurrenceCount || 0) + 1;
      applyEndChecks(r2);
    }
    // Stamp ruleId on the saved record so the badge renders.
    if (savedRecord) {
      const recIdx = store.records.findIndex((r) => r.id === savedRecord.id);
      if (recIdx >= 0) store.records[recIdx].ruleId = p.ruleId;
    }
    saveStore();
    // Remove this pending entry — find by ruleId+dueDate (idx may have drifted).
    const removeAt = pendingConfirmations.findIndex(
      (x) => x.ruleId === p.ruleId && x.dueDate === p.dueDate
    );
    if (removeAt >= 0) pendingConfirmations.splice(removeAt, 1);
    renderConfirmBanner();
  };
  // openModal expects a record-shaped object to prefill.
  openModal(draft);
}

async function confirmAllPending() {
  while (pendingConfirmations.length) await confirmPending(0);
}
function skipAllPending() {
  while (pendingConfirmations.length) skipPending(0);
}

/* ---- "Make this recurring" sub-form in Add Record modal (Task 12) ---- */
function showRecCadenceSub(kind) {
  const w = document.getElementById("recWeeklyWrap");
  const m = document.getElementById("recMonthlyWrap");
  const y = document.getElementById("recYearlyWrap");
  if (w) w.classList.toggle("hidden", kind !== "weekly");
  if (m) m.classList.toggle("hidden", kind !== "monthly");
  if (y) y.classList.toggle("hidden", kind !== "yearly");
}
function showRecEndSub(kind) {
  const d = document.getElementById("recEndDateWrap");
  const c = document.getElementById("recEndCountWrap");
  if (d) d.classList.toggle("hidden", kind !== "date");
  if (c) c.classList.toggle("hidden", kind !== "count");
}

// Decide which of the three recurring views to show in the Add Record modal
// based on the record's ruleId and whether that rule still exists.
function setRecRecurringSection(record) {
  const linkedEl  = document.getElementById("recRecurringLinked");
  const orphanEl  = document.getElementById("recRecurringOrphan");
  const togglWrap = document.getElementById("recRecurringDetails");
  const toggle    = document.getElementById("recRecurringToggle");
  if (!linkedEl || !orphanEl || !togglWrap || !toggle) return;

  // Reset toggle sub-form to "fresh"
  toggle.checked = false;
  togglWrap.open = false;
  populateYearMonthSelect("recYearMonth");
  setSeg("recCadence", "daily"); showRecCadenceSub("daily");
  setSeg("recEnd", "none"); showRecEndSub("none");
  wireSeg("recCadence", showRecCadenceSub);
  wireSeg("recEnd", showRecEndSub);
  toggle.onchange = () => { togglWrap.open = toggle.checked; };

  // Clear marker that the save handler reads (used by State C "recreate" path).
  delete togglWrap.dataset.recreateForRuleless;

  const ruleId = record && record.ruleId;
  if (!ruleId) {
    // STATE A — no rule, show toggle
    linkedEl.classList.add("hidden");
    orphanEl.classList.add("hidden");
    togglWrap.classList.remove("hidden");
    return;
  }

  loadStore();
  const rule = (store.settings.recurring || []).find((r) => r.id === ruleId);
  if (rule) {
    // STATE B — linked, show read-only chip
    linkedEl.classList.remove("hidden");
    orphanEl.classList.add("hidden");
    togglWrap.classList.add("hidden");
    const nameEl = document.getElementById("recRecurringLinkedName");
    if (nameEl) {
      nameEl.textContent =
        escapeHtmlText(rule.category || "(no category)") +
        " · " + cadenceSummary(rule.cadence) +
        " · " + (rule.autoConfirm ? "Auto-confirm ON" : "Confirm each") +
        (rule.paused ? " · Paused" : "");
    }
    const editBtn = document.getElementById("recRecurringEditLink");
    if (editBtn) editBtn.onclick = () => {
      closeModal();
      showView("settings");
      setTimeout(() => {
        const block = $$("#view-settings .settings-block").find(
          (b) => b.querySelector(".block-title")?.textContent.trim() === "Recurring"
        );
        if (block) block.classList.remove("collapsed");
        openRuleEditor(rule.id);
      }, 50);
    };
  } else {
    // STATE C — orphan, show warning + recreate + dismiss
    linkedEl.classList.add("hidden");
    orphanEl.classList.remove("hidden");
    togglWrap.classList.add("hidden");

    const recreateBtn = document.getElementById("recRecurringRecreateBtn");
    if (recreateBtn) recreateBtn.onclick = () => {
      // Switch to State A in-place: show toggle, pre-check it, expand body.
      orphanEl.classList.add("hidden");
      togglWrap.classList.remove("hidden");
      togglWrap.open = true;
      toggle.checked = true;
      // Tell the save handler to treat this as a "recreate" (clears the dead
      // ruleId so createRuleFromAddRecord can stamp the new one).
      togglWrap.dataset.recreateForRuleless = "1";
    };

    const dismissBtn = document.getElementById("recRecurringOrphanDismiss");
    if (dismissBtn) dismissBtn.onclick = () => {
      if (!confirm("Stop showing this orphan-rule warning for this record? The record stays; only the broken link is cleared.")) return;
      loadStore();
      const idx = store.records.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        delete store.records[idx].ruleId;
        saveStore();
      }
      // Hide orphan, fall through to State A.
      orphanEl.classList.add("hidden");
      togglWrap.classList.remove("hidden");
      // Reflect change on the in-memory `record` reference too so subsequent
      // saves in this modal session don't carry the stale ruleId.
      if (record) delete record.ruleId;
    };
  }
}

// Safe text version of escapeHtml (returns plain text, not HTML-escaped, for
// setting via .textContent — the chip uses textContent so no escaping needed,
// but we keep the call site clean).
function escapeHtmlText(s) { return String(s == null ? "" : s); }

async function createRuleFromAddRecord(savedRecord) {
  const cadenceBtn = document.querySelector("#recCadence button.seg-on");
  const cadenceKind = (cadenceBtn && cadenceBtn.dataset.v) || "daily";
  const cadence = { kind: cadenceKind };
  if (cadenceKind === "weekly") cadence.weekday = Number(document.getElementById("recWeekday").value);
  if (cadenceKind === "monthly") cadence.dayOfMonth = Number(document.getElementById("recDayOfMonth").value);
  if (cadenceKind === "yearly") {
    cadence.month = Number(document.getElementById("recYearMonth").value);
    cadence.day = Number(document.getElementById("recYearDay").value);
  }
  const endBtn = document.querySelector("#recEnd button.seg-on");
  const endKind = (endBtn && endBtn.dataset.v) || "none";
  const rule = {
    id: "rule_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    type: savedRecord.type,
    category: savedRecord.category,
    subcategory: savedRecord.subcategory || "",
    amount: savedRecord.amount,
    currency: savedRecord.currency,
    notes: savedRecord.notes || "",
    cadence,
    startDate: savedRecord.date,
    lastGeneratedDate: savedRecord.date, // record was just created — next tick after this date
    endDate: endKind === "date" ? (document.getElementById("recEndDate").value || undefined) : undefined,
    maxOccurrences: endKind === "count" ? (Number(document.getElementById("recEndCount").value) || undefined) : undefined,
    occurrenceCount: 1, // count the record we just produced
    autoConfirm: document.getElementById("recAutoConfirm").checked,
    paused: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Stamp ruleId on the just-saved record for provenance.
  loadStore();
  const recIdx = store.records.findIndex((r) => r.id === savedRecord.id);
  if (recIdx >= 0) store.records[recIdx].ruleId = rule.id;
  store.settings.recurring.push(rule);
  saveStore();
}

/* Mode switcher: tapping the title (or the header icon) toggles modes. */
(function wireModeSwitcher() {
  const btn = document.getElementById("modeSwitcher");
  if (!btn) return;
  const toggle = (e) => {
    e.stopPropagation();
    setMode(currentMode === "debt" ? "finance" : "debt");
  };
  btn.addEventListener("click", toggle);
  const icon = document.getElementById("headerIcon");
  if (icon) {
    icon.style.cursor = "pointer";
    icon.addEventListener("click", toggle);
  }
})();

function renderDebtDashboard() {
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const balances = personBalances(store.debts || [], peopleById);
  const { totalLend, totalBorrow } = totalsAcrossPeople(balances);

  const cur = (store.settings.defaultCurrency || "THB");
  document.getElementById("dbtTotalLend").textContent = fmt(totalLend);
  document.getElementById("dbtTotalBorrow").textContent = fmt(totalBorrow);
  document.querySelector("#dbtTotalLendCard .muted").textContent = "Total Lend · " + cur;
  document.querySelector("#dbtTotalBorrowCard .muted").textContent = "Total Borrow · " + cur;
  if (typeof fitText === "function") {
    fitText(document.getElementById("dbtTotalLend"), 22, 11);
    fitText(document.getElementById("dbtTotalBorrow"), 22, 11);
  }

  const list = document.getElementById("dbtPersonList");
  const empty = document.getElementById("dbtEmpty");
  list.innerHTML = "";
  const rows = [];
  for (const [pid, row] of balances) {
    if (row.direction === "clear") continue;
    const p = peopleById[pid];
    if (!p) continue;
    rows.push({ p, row });
  }
  rows.sort((a, b) => Math.abs(b.row.outstanding) - Math.abs(a.row.outstanding));

  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const { p, row } of rows) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "dbt-person-card " + (row.direction === "they-owe" ? "is-in" : "is-out");
    card.dataset.personId = p.id;
    const sign = row.direction === "they-owe" ? "+" : "-";
    const amt  = Math.abs(row.outstanding);
    const pct  = Math.round(row.progress * 100);
    card.innerHTML =
      '<div class="dbt-ic" style="background:' + p.color + '">' +
        personIconSvg(p.icon || "person", "dbt-ic-svg") +
      '</div>' +
      '<div class="dbt-body">' +
        '<div class="dbt-row1">' +
          '<span class="dbt-name">' + escapeHtml(p.name) + '</span>' +
          '<span class="dbt-amt">' + sign + fmt(amt, cur) + '</span>' +
        '</div>' +
        '<div class="dbt-bar"><span style="width:' + pct + '%"></span></div>' +
      '</div>';
    card.addEventListener("click", () => openPersonHistory(p.id));
    list.appendChild(card);
  }
}

function openPersonHistory(personId) {
  _currentHistoryPersonId = personId;
  showView("person-history");
  renderPersonHistory(personId);
}

function renderPeopleSection() {
  const root = document.getElementById("peopleList");
  if (!root) return;
  loadStore();
  root.innerHTML = "";
  const people = store.settings.people || [];
  if (!people.length) {
    root.innerHTML = '<div class="recurring-empty">No people yet. Add one below.</div>';
    return;
  }
  for (const p of people) {
    const row = document.createElement("div");
    row.className = "people-row";
    row.dataset.personId = p.id;
    row.innerHTML =
      '<button type="button" class="pp-ic" style="background:' + p.color + '" aria-label="Choose icon">' + personIconSvg(p.icon || "person") + '</button>' +
      '<input type="color" value="' + (p.color || "#7c5cff") + '" />' +
      '<input type="text" value="' + escapeHtml(p.name) + '" />' +
      '<button type="button" class="pp-del" aria-label="Delete">×</button>';

    const iconBtn = row.querySelector(".pp-ic");
    const colorIn = row.querySelector('input[type="color"]');
    const nameIn  = row.querySelector('input[type="text"]');
    const delBtn  = row.querySelector(".pp-del");

    colorIn.addEventListener("change", () => {
      p.color = colorIn.value;
      iconBtn.style.background = p.color;
      saveStore();
    });
    nameIn.addEventListener("change", () => {
      p.name = nameIn.value.trim() || "(unnamed)";
      nameIn.value = p.name;
      saveStore();
    });
    iconBtn.addEventListener("click", () => {
      openPersonIconPicker(p.icon || "person", (next) => {
        p.icon = next;
        iconBtn.innerHTML = personIconSvg(p.icon);
        saveStore();
      });
    });
    delBtn.addEventListener("click", () => {
      if (!confirm("Delete this person? Their debt records will remain but become orphaned.")) return;
      store.settings.people = store.settings.people.filter((x) => x.id !== p.id);
      saveStore();
      renderPeopleSection();
    });

    root.appendChild(row);
  }
}

// Icon picker state for the "Add a new person" row.
let _newPersonIconId = "person";
function _paintNewPersonIconTile() {
  const tile = document.getElementById("newPersonIcon");
  if (!tile) return;
  tile.innerHTML = personIconSvg(_newPersonIconId, "ip-svg");
  const color = document.getElementById("newPersonColor");
  if (color) tile.style.background = color.value || "#7c5cff";
}
(function wireNewPersonIcon() {
  const tile = document.getElementById("newPersonIcon");
  if (!tile) return;
  _paintNewPersonIconTile();
  tile.addEventListener("click", () => {
    openPersonIconPicker(_newPersonIconId, (id) => {
      _newPersonIconId = id;
      _paintNewPersonIconTile();
    });
  });
  const colorInp = document.getElementById("newPersonColor");
  if (colorInp) {
    colorInp.addEventListener("input", () => {
      tile.style.background = colorInp.value;
    });
  }
})();

// Add button — wired at script-load time.
(function wirePeopleAdd() {
  const btn = document.getElementById("addPersonBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const name = document.getElementById("newPersonName").value.trim();
    if (!name) return;
    const color = document.getElementById("newPersonColor").value || "#7c5cff";
    loadStore();
    store.settings.people.push({
      id: "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      name, color, icon: _newPersonIconId,
    });
    saveStore();
    document.getElementById("newPersonName").value = "";
    _newPersonIconId = "person";
    _paintNewPersonIconTile();
    renderPeopleSection();
  });
})();

// Icon picker modal — reusable.
function openPersonIconPicker(currentIconId, onPick) {
  const m = document.getElementById("personIconModal");
  const grid = document.getElementById("personIconGrid");
  if (!m || !grid) return;
  grid.innerHTML = PEOPLE_ICON_IDS.map((id) =>
    '<button type="button" data-id="' + id + '" class="' + (id === currentIconId ? "active" : "") + '">' +
      personIconSvg(id) +
    '</button>'
  ).join("");
  grid.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      grid.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      onPick(b.dataset.id);
      closePersonIconPicker();
    });
  });
  m.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closePersonIconPicker() {
  const m = document.getElementById("personIconModal");
  if (m) m.classList.add("hidden");
  const otherModalIds = ["modal", "ruleModal", "catIconModal"];
  const anyOpen = otherModalIds.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
  if (!anyOpen) document.body.classList.remove("modal-open");
}

let editingDebtId = null;
let debtDraftType = "lend";

// Render the 2-button context-aware direction toggle in the Add Debt modal.
// Decides which two types to show based on the selected person's current outstanding.
// `personId` may be empty (no person picked yet -> clear-context default).
// `preferType` (optional) is the type to mark active if it's one of the two options;
// otherwise the context's default is selected and `debtDraftType` is updated to match.
function renderDebtDirectionToggle(personId, preferType) {
  const toggle = document.getElementById("debtTypeToggle");
  if (!toggle) return;
  loadStore();
  let direction = "clear";
  if (personId) {
    const peopleById = {};
    for (const p of (store.settings.people || [])) peopleById[p.id] = p;
    const row = personBalances(store.debts || [], peopleById).get(personId);
    if (row) direction = row.direction;
  }

  // Each entry: [type, label]
  let options;
  let defaultType;
  if (direction === "they-owe") {
    options = [["lend", "Lend (more)"], ["paid-back", "Paid back"]];
    defaultType = "paid-back";
  } else if (direction === "i-owe") {
    options = [["pay-back", "Pay back"], ["borrow", "Borrow (more)"]];
    defaultType = "pay-back";
  } else {
    options = [["lend", "Lend"], ["borrow", "Borrow"]];
    defaultType = "lend";
  }

  const valid = options.some(([t]) => t === preferType);
  const active = valid ? preferType : defaultType;
  debtDraftType = active;

  toggle.innerHTML = options.map(([t, label]) =>
    '<button type="button" data-type="' + t + '"' +
    (t === active ? ' class="active"' : '') + '>' +
    label + '</button>'
  ).join("");

  // Wire clicks (replaces any prior handlers via innerHTML reset).
  toggle.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      debtDraftType = b.dataset.type;
      toggle.querySelectorAll("button").forEach((x) =>
        x.classList.toggle("active", x === b)
      );
      refreshMatchOutstanding();
    });
  });
}

function openDebtModal(debt /* nullable */) {
  loadStore();
  editingDebtId = debt ? debt.id : null;
  debtDraftType = debt ? debt.type : "lend";
  document.getElementById("debtModalTitle").textContent = debt ? "Edit Debt" : "Add Debt";
  document.getElementById("dbtDelete").classList.toggle("hidden", !debt);
  document.getElementById("debtError").textContent = "";

  // Direction toggle — context-aware, populated by JS based on the person's balance.
  renderDebtDirectionToggle(debt ? debt.personId : "", debt ? debt.type : null);

  // Currency select — reuse the existing helper if it exists; otherwise build manually.
  if (typeof fillCurrencySelects === "function") {
    fillCurrencySelects();
  } else {
    // Fallback: populate just our currency select
    const sel = document.getElementById("dbtCurrency");
    if (sel) {
      sel.innerHTML = (store.settings.currencies || []).map((c) =>
        '<option value="' + c + '">' + c + '</option>'
      ).join("");
    }
  }
  document.getElementById("dbtCurrency").value = (debt && debt.currency) || (store.settings.defaultCurrency || "THB");

  document.getElementById("dbtAmount").value = (debt && debt.amount > 0) ? debt.amount : "";
  document.getElementById("dbtDate").value = debt ? debt.date : ymd(new Date());
  document.getElementById("dbtNotes").value = debt ? debt.notes : "";

  // Manual-rate field: pre-fill from existing record when editing, then update visibility.
  document.getElementById("dbtManualRate").value =
    (debt && debt.manualRate && debt.rate) ? debt.rate : "";
  updateDbtManualRateField();

  // Person picker
  buildDebtPersonMenu();
  setDebtPerson(debt ? debt.personId : "");

  // Hide inline add-person form
  document.getElementById("dbtAddPersonForm").classList.add("hidden");

  // Match-outstanding chip (re-evaluated whenever person changes; initial pass below)
  refreshMatchOutstanding();

  document.getElementById("debtModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeDebtModal() {
  document.getElementById("debtModal").classList.add("hidden");
  editingDebtId = null;
  const otherModalIds = ["modal", "ruleModal", "personIconModal", "debtSplitModal"];
  const anyOpen = otherModalIds.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
  if (!anyOpen) document.body.classList.remove("modal-open");
}

document.getElementById("debtModalClose")?.addEventListener("click", closeDebtModal);
document.getElementById("debtModal")?.addEventListener("click", (e) => {
  if (e.target.id === "debtModal") closeDebtModal();
});

// Person picker — full implementation
function buildDebtPersonMenu() {
  const menu = document.getElementById("dbtPersonMenu");
  if (!menu) return;
  loadStore();
  const people = store.settings.people || [];
  menu.innerHTML = people.map((p) =>
    '<button type="button" class="picker-opt" data-id="' + p.id + '">' +
      '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
      '<span>' + escapeHtml(p.name) + '</span>' +
    '</button>'
  ).join("");
  menu.querySelectorAll(".picker-opt").forEach((b) => {
    b.addEventListener("click", () => {
      setDebtPerson(b.dataset.id);
      menu.classList.add("hidden");
    });
  });
}

function setDebtPerson(id) {
  document.getElementById("dbtPersonId").value = id || "";
  const val = document.getElementById("dbtPersonVal");
  loadStore();
  const people = store.settings.people || [];
  const p = id ? people.find((x) => x.id === id) : null;
  if (p) {
    val.classList.remove("placeholder");
    val.innerHTML =
      '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
      '<span>' + escapeHtml(p.name) + '</span>';
  } else {
    val.classList.add("placeholder");
    val.textContent = "Select a person";
  }
  renderDebtDirectionToggle(id || "", debtDraftType);
  refreshMatchOutstanding();
}

// Picker button open/close + outside-click close
(function wireDebtPersonPicker() {
  const btn = document.getElementById("dbtPersonBtn");
  const menu = document.getElementById("dbtPersonMenu");
  if (!btn || !menu) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#dbtPersonPicker")) menu.classList.add("hidden");
  });
})();

// Inline add-person from within the debt modal
(function wireInlineAddPerson() {
  const open  = document.getElementById("dbtAddPersonBtn");
  const form  = document.getElementById("dbtAddPersonForm");
  const save  = document.getElementById("dbtNewPersonSave");
  const cancel= document.getElementById("dbtNewPersonCancel");
  if (!open || !form || !save || !cancel) return;
  open.addEventListener("click", () => form.classList.toggle("hidden"));
  cancel.addEventListener("click", () => form.classList.add("hidden"));
  save.addEventListener("click", () => {
    const name = document.getElementById("dbtNewPersonName").value.trim();
    if (!name) return;
    const color = document.getElementById("dbtNewPersonColor").value || "#7c5cff";
    loadStore();
    const newId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    store.settings.people.push({ id: newId, name, color, icon: "person" });
    saveStore();
    document.getElementById("dbtNewPersonName").value = "";
    form.classList.add("hidden");
    buildDebtPersonMenu();
    setDebtPerson(newId);
  });
})();

function refreshMatchOutstanding() {
  const btn = document.getElementById("dbtMatchOutstanding");
  if (!btn) return;
  const pid = document.getElementById("dbtPersonId").value;
  if (!pid) { btn.classList.add("hidden"); return; }
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const balances = personBalances(store.debts || [], peopleById);
  const row = balances.get(pid);
  if (!row || row.direction === "clear") { btn.classList.add("hidden"); return; }
  const cur = store.settings.defaultCurrency || "THB";
  // When they owe me, the settling action is recording their repayment — "paid-back".
  // When I owe them, the settling action is recording my repayment — "pay-back".
  const oppDir = row.direction === "they-owe" ? "paid-back" : "pay-back";
  btn.classList.remove("hidden");
  btn.textContent = "Match outstanding (" + fmt(Math.abs(row.outstanding), cur) + ")";
  btn.onclick = () => {
    document.getElementById("dbtAmount").value = Math.abs(row.outstanding);
    debtDraftType = oppDir;
    const pid = document.getElementById("dbtPersonId").value;
    renderDebtDirectionToggle(pid, oppDir);
  };
}

function updateDbtManualRateField() {
  const field = document.getElementById("dbtManualRateField");
  if (field) field.classList.add("hidden");
}
// Currency-change re-evaluates the manual-rate field.
document.getElementById("dbtCurrency")?.addEventListener("change", updateDbtManualRateField);
document.getElementById("personIconClose")?.addEventListener("click", closePersonIconPicker);

async function saveDebtFromModal() {
  const err = document.getElementById("debtError");
  err.textContent = "";

  const personId = document.getElementById("dbtPersonId").value;
  const amount = Number(document.getElementById("dbtAmount").value);
  const date = document.getElementById("dbtDate").value;
  const currency = document.getElementById("dbtCurrency").value;
  const notes = document.getElementById("dbtNotes").value.trim();

  if (!personId) { err.textContent = "Person is required."; return; }
  if (!(amount > 0)) { err.textContent = "Amount must be greater than 0."; return; }
  if (!date) { err.textContent = "Date is required."; return; }

  loadStore();
  const defaultCurrency = (store.settings.defaultCurrency || "THB");

  if (editingDebtId) {
    // ----- EDIT branch -----
    const idx = store.debts.findIndex((d) => d.id === editingDebtId);
    if (idx === -1) { err.textContent = "Debt not found."; return; }
    const existing = store.debts[idx];
    const updated = Object.assign({}, existing, {
      type: debtDraftType, personId, amount, currency, date, notes,
      updatedAt: Date.now(),
    });
    delete updated.convertedAmount; delete updated.convertedCurrency;
    delete updated.rate; delete updated.rateDate; delete updated.rateUnavailable; delete updated.manualRate;
    try { await attachConversion(updated); } catch (_e) { updated.rateUnavailable = true; }

    // Overshoot guard — blocks edits that would have triggered the split modal on Add.
    if (wouldOvershoot(store.debts, updated, defaultCurrency)) {
      err.textContent = "This edit would overshoot the outstanding balance. Delete this record and add a new one instead.";
      return;
    }

    store.debts[idx] = updated;
    saveStore();
    closeDebtModal();
    rerenderActiveDebtView();
    return;
  }

  // ----- ADD branch -----
  // Build the "entered record" — no id/createdAt yet (planSplit doesn't need them).
  const entered = {
    type: debtDraftType, personId, amount, currency, date, notes,
  };
  try { await attachConversion(entered); } catch (_e) { entered.rateUnavailable = true; }

  // Compute balanceBefore for this person at "now" (the entered record will sit at the end
  // chronologically since createdAt = now). balanceBefore needs an id to stop at; we pass
  // a sentinel id that won't match any existing record so the walk processes every record.
  // The resulting outstanding IS the balance-before-this-new-record.
  const sentinel = "__entered_sentinel__";
  const debtsForCalc = (store.debts || []).concat([Object.assign({}, entered, {
    id: sentinel,
    date: entered.date,
    createdAt: Date.now() + 1000000,  // ensures sentinel sorts last
  })]);
  const balanceBeforeSigned = balanceBefore(debtsForCalc, sentinel);

  const plan = planSplit(entered, balanceBeforeSigned, defaultCurrency);
  if (!plan.split) {
    insertSingleDebt(plan.a);
    closeDebtModal();
    rerenderActiveDebtView();
    return;
  }
  // Show confirmation modal; if user confirms, commit both records.
  openSplitConfirmModal(plan, defaultCurrency, personId);
}

function insertSingleDebt(rec) {
  const now = Date.now();
  rec.id = "debt_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  rec.createdAt = now;
  rec.updatedAt = now;
  store.debts.push(rec);
  saveStore();
}

function rerenderActiveDebtView() {
  if (currentView === "dashboard" && currentMode === "debt") {
    renderDebtDashboard();
  } else if (currentView === "person-history") {
    renderPersonHistory(_currentHistoryPersonId);
  } else if (currentView === "debt-records") {
    renderDebtRecords();
  }
}

function openSplitConfirmModal(plan, defaultCurrency, personId) {
  const modal = document.getElementById("debtSplitModal");
  if (!modal) return;
  loadStore();
  const person = (store.settings.people || []).find((p) => p.id === personId);
  const personName = person ? person.name : "this person";

  const msg = document.getElementById("debtSplitMsg");
  msg.textContent = (plan.a.type === "paid-back"
    ? "This is more than what " + personName + " owes you."
    : "This is more than what you owe " + personName + ".")
    + " We'll split it into:";

  const dirLabelForSplit = (t) =>
    t === "lend" ? "Lend" :
    t === "borrow" ? "Borrow" :
    t === "paid-back" ? "Paid back" :
    t === "pay-back" ? "Pay back" :
    t;

  const fmtSplit = (rec) => rec.currency + " " +
    Number(rec.amount).toLocaleString(undefined, { maximumFractionDigits: 2 });

  document.getElementById("debtSplitPreview").innerHTML =
    '<div class="dbt-split-row is-settled">' +
      '<span class="dbt-split-idx">1.</span>' +
      '<span class="dbt-split-type">' + dirLabelForSplit(plan.a.type) + '</span>' +
      '<span class="dbt-split-amt">' + fmtSplit(plan.a) + '</span>' +
      '<span class="dbt-split-tag">· Settled</span>' +
    '</div>' +
    '<div class="dbt-split-row is-new">' +
      '<span class="dbt-split-idx">2.</span>' +
      '<span class="dbt-split-type">' + dirLabelForSplit(plan.b.type) + '</span>' +
      '<span class="dbt-split-amt">' + fmtSplit(plan.b) + '</span>' +
      '<span class="dbt-split-tag">(new)</span>' +
    '</div>';

  // Wire buttons (rewire each open to avoid stacking listeners — we use onclick assignment).
  document.getElementById("debtSplitCancel").onclick = () => closeSplitConfirmModal();
  document.getElementById("debtSplitClose").onclick  = () => closeSplitConfirmModal();
  document.getElementById("debtSplitConfirm").onclick = () => {
    // Commit A then B, with B.createdAt = A.createdAt + 1.
    const nowA = Date.now();
    const recA = Object.assign({}, plan.a, {
      id: "debt_" + nowA.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      createdAt: nowA, updatedAt: nowA,
    });
    const nowB = nowA + 1;
    const recB = Object.assign({}, plan.b, {
      id: "debt_" + nowB.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      createdAt: nowB, updatedAt: nowB,
    });
    loadStore();
    store.debts.push(recA, recB);
    saveStore();
    closeSplitConfirmModal();
    closeDebtModal();
    rerenderActiveDebtView();
  };

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeSplitConfirmModal() {
  const modal = document.getElementById("debtSplitModal");
  if (modal) modal.classList.add("hidden");
  // If the Add Debt modal is also closed, drop the body class. Otherwise keep it.
  const addModalOpen = !document.getElementById("debtModal").classList.contains("hidden");
  if (!addModalOpen) document.body.classList.remove("modal-open");
}

function deleteDebtFromModal() {
  if (!editingDebtId) return;
  if (!confirm("Delete this debt record?")) return;
  loadStore();
  store.debts = store.debts.filter((d) => d.id !== editingDebtId);
  saveStore();
  closeDebtModal();
  if (currentView === "dashboard" && currentMode === "debt") {
    renderDebtDashboard();
  } else if (currentView === "person-history") {
    renderPersonHistory(_currentHistoryPersonId);
  } else if (currentView === "debt-records") {
    renderDebtRecords();
  }
}

document.getElementById("dbtSave")?.addEventListener("click", saveDebtFromModal);
document.getElementById("dbtDelete")?.addEventListener("click", deleteDebtFromModal);

// Set in Task 11
let _currentHistoryPersonId = null;

/* ================================================================
   DebtTrakr — Share record as image
   Renders an Aero-themed PNG card and hands it to the share sheet.
   ================================================================ */
const _aeroCardPalette = {
  bg:     "#cfeede",
  card:   "#ffffff",
  text:   "#0e2a3f",
  muted:  "#4d6e86",
  accent: "#1f8bff",
  out:    "#ff5a6a",
  in:     "#0fae5e",
  line:   "rgba(120,170,210,0.38)",
};

// Rasterizes an SVG string into an HTMLImageElement at the given pixel size.
// The SVG must be wrapped (or wrappable) into a <svg xmlns="..."> root.
// Used to draw person icons into the canvas card.
function _loadImageFromSvg(svgStr, sizePx) {
  return new Promise((resolve, reject) => {
    // personIconSvg() doesn't include xmlns — patch it in if missing.
    let s = svgStr;
    if (!/xmlns=/.test(s)) {
      s = s.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    }
    // Force width/height so the rasterizer knows the target size.
    s = s.replace("<svg ", '<svg width="' + sizePx + '" height="' + sizePx + '" ');
    const blob = new Blob([s], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Renders an Aero-themed PNG card for a single debt record.
// `debt`     — the Debt object being shared.
// `person`   — the Person object (name, color, icon). May be a synthetic
//              "(deleted person)" object if the person was removed.
// `balanceBeforeAmt` — signed outstanding for this person immediately
//              before this record (use balanceBefore() from debts.js).
// `defaultCurrency` — store.settings.defaultCurrency, used for the math line.
// `userName` — the share author's name, used in the tag sentence.
// `language` — "en" or "th"; controls share-image text only.
// Resolves with a PNG Blob, ready for share/download.
async function renderDebtCard(debt, person, balanceBeforeAmt, defaultCurrency, userName, language) {
  const P = _aeroCardPalette;
  const WIDTH = 1080;
  const DPR = 2;
  const PAD = 72;

  // ---- Compute lines first to measure required height ----
  const me   = userName || "Me";
  const them = person.name || "(deleted person)";
  const lang = language === "th" ? "th" : "en";
  // Full-sentence tag so the recipient knows who's involved without needing app context.
  const tagSentence = lang === "th"
    ? (debt.type === "lend"      ? them + " ยืมเงินจาก " + me :
       debt.type === "borrow"    ? me   + " ยืมเงินจาก " + them :
       debt.type === "paid-back" ? them + " คืนเงินให้ " + me :
       debt.type === "pay-back"  ? me   + " คืนเงินให้ " + them :
       "")
    : (debt.type === "lend"      ? them + " borrowed from " + me :
       debt.type === "borrow"    ? me   + " borrowed from " + them :
       debt.type === "paid-back" ? them + " paid back to "  + me :
       debt.type === "pay-back"  ? me   + " paid back to "  + them :
       "");
  const dirColor = (debt.type === "lend" || debt.type === "pay-back") ? P.out : P.in;

  const amountLine =
    Number(debt.amount).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
    " " + (debt.currency || "");

  const showConverted =
    debt.convertedAmount != null && debt.convertedCurrency &&
    debt.convertedCurrency !== debt.currency;
  const convertedLine = showConverted
    ? "≈ " + Number(debt.convertedAmount).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
      " " + debt.convertedCurrency +
      (debt.rate ? " @ " + Number(debt.rate).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "")
    : null;

  const dateLine = debt.date || "";
  const notesLine = debt.notes ? debt.notes.trim() : "";

  // Math line uses converted amount when record currency differs from default.
  const recordAmtInDefault =
    (debt.convertedAmount != null && debt.convertedCurrency === defaultCurrency)
      ? Number(debt.convertedAmount)
      : (debt.currency === defaultCurrency ? Number(debt.amount) : Number(debt.convertedAmount || debt.amount));

  const delta = ((debt.type === "lend" || debt.type === "pay-back") ? +1 : -1) * recordAmtInDefault;
  const newBalance = balanceBeforeAmt + delta;

  // Magnitude-only formatting. The equation always reads as positive amounts;
  // the operator carries direction. This keeps the math intuitive regardless of
  // whether the cycle represents "they owe me" or "I owe them".
  const fmtAbs = (v) =>
    Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmtResult = (v) => fmtAbs(v) + " " + defaultCurrency;
  // "+" when the magnitude grows (delta same sign as prior balance, or prior 0);
  // "−" when it shrinks toward zero (settling action).
  const grows = balanceBeforeAmt === 0
    ? true
    : (Math.sign(delta) === Math.sign(balanceBeforeAmt));
  const op = grows ? "+" : "−";
  const isStartingRecord = balanceBeforeAmt === 0;
  const outstandingLabel = lang === "th" ? "ยอดคงค้าง:  " : "Outstanding:  ";
  const mathPrefix = isStartingRecord
    ? outstandingLabel
    : outstandingLabel + fmtAbs(balanceBeforeAmt) + " " + op + " " + fmtAbs(delta) + " = ";
  const totalText = fmtResult(newBalance);
  // Settled when this record brought the cycle to exactly zero. Empty starting
  // balance with a zero-amount record (impossible in practice) wouldn't count.
  const isSettled = newBalance === 0 && balanceBeforeAmt !== 0;

  // ---- Measure content height ----
  // Card height auto-fits content. Vertical layout (in CSS px before DPR scaling):
  //   PAD (top) + 160 (icon row) + 32 + 48 (tag) + 24 + 88 (amount)
  //   + (44 if converted line) + 16 + 32 (date) + (notes ? 24+32 : 0)
  //   + 40 (separator gap) + 56 (math line + underline)
  //   + (settled ? 64 : 0) + PAD (bottom)
  const HEIGHT =
    PAD + 160 + 32 + 48 + 24 + 88 +
    (convertedLine ? 44 : 0) +
    16 + 32 +
    (notesLine ? 24 + 32 : 0) +
    40 + 56 + (isSettled ? 64 : 0) + PAD;

  // ---- Set up canvas ----
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * DPR;
  canvas.height = HEIGHT * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);

  // Background (Aero gradient, simplified — radial glows on a green base)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bgGrad.addColorStop(0, "#bfe6ff");
  bgGrad.addColorStop(0.5, P.bg);
  bgGrad.addColorStop(1, "#e9fbef");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Inner glass card
  const cardX = PAD * 0.5;
  const cardY = PAD * 0.5;
  const cardW = WIDTH - PAD;
  const cardH = HEIGHT - PAD;
  const radius = 36;
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  _roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  _roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.stroke();

  // ---- Person icon tile + name ----
  let y = PAD + 40;
  const iconSize = 120;
  const iconX = PAD + 20;
  ctx.fillStyle = person.color || "#888";
  _roundRect(ctx, iconX, y, iconSize, iconSize, 28);
  ctx.fill();

  // Rasterize the person SVG and draw it centered + scaled inside the tile.
  // personIconSvg uses currentColor=white-ish via tile background; we want
  // the stroke to be white for contrast. Force stroke color in the SVG:
  const rawSvg = personIconSvg(person.icon || "person");
  const whiteSvg = rawSvg.replace('stroke="currentColor"', 'stroke="#ffffff"');
  try {
    const iconImg = await _loadImageFromSvg(whiteSvg, iconSize - 24);
    ctx.drawImage(iconImg, iconX + 12, y + 12, iconSize - 24, iconSize - 24);
  } catch (_) { /* if SVG fails, the colored tile alone is fine */ }

  // Name to the right of the tile
  ctx.fillStyle = P.text;
  ctx.font = "600 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "middle";
  const nameMaxW = WIDTH - (iconX + iconSize + 24) - PAD;
  ctx.fillText(_clipText(ctx, person.name || "(deleted person)", nameMaxW), iconX + iconSize + 24, y + iconSize / 2);

  // ---- Sentence tag (pill) ----
  y += iconSize + 32;
  ctx.font = "700 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const badgePadX = 18, badgePadY = 9;
  const maxBadgeTextW = WIDTH - PAD * 2 - badgePadX * 2;
  const tagClipped = _clipText(ctx, tagSentence, maxBadgeTextW);
  const tagMetrics = ctx.measureText(tagClipped);
  const badgeW = tagMetrics.width + badgePadX * 2;
  const badgeH = 26 + badgePadY * 2;
  ctx.fillStyle = dirColor;
  _roundRect(ctx, PAD, y, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(tagClipped, PAD + badgePadX, y + badgeH / 2 + 1);

  // ---- Amount + (optional) converted + date + (optional) notes ----
  y += badgeH + 24;
  ctx.fillStyle = P.text;
  ctx.font = "700 72px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(_clipText(ctx, amountLine, WIDTH - PAD * 2), PAD, y);
  y += 88;

  if (convertedLine) {
    ctx.fillStyle = P.muted;
    ctx.font = "500 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(convertedLine, PAD, y);
    y += 44;
  }

  ctx.fillStyle = P.muted;
  ctx.font = "500 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(dateLine, PAD, y);
  y += 32;

  if (notesLine) {
    y += 24;
    ctx.fillStyle = P.text;
    ctx.font = "400 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const notesMaxW = WIDTH - PAD * 2;
    ctx.fillText('"' + _clipText(ctx, notesLine, notesMaxW - ctx.measureText('""').width) + '"', PAD, y);
    y += 32;
  }

  // ---- Separator + math line ----
  y += 40;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 24);
  ctx.lineTo(WIDTH - PAD, y - 24);
  ctx.stroke();

  // Math line — prefix in normal weight, the new total in bold + underlined.
  ctx.fillStyle = P.text;
  ctx.textBaseline = "top";
  ctx.font = "600 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(mathPrefix, PAD, y);
  const prefixW = ctx.measureText(mathPrefix).width;

  ctx.font = "800 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const totalX = PAD + prefixW;
  ctx.fillText(totalText, totalX, y);
  const totalW = ctx.measureText(totalText).width;

  ctx.strokeStyle = P.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(totalX, y + 40);
  ctx.lineTo(totalX + totalW, y + 40);
  ctx.stroke();

  // ---- Settled line (on its own row, green check + bold text) ----
  if (isSettled) {
    y += 60;
    const checkSize = 40;
    _drawCheckmark(ctx, PAD, y, checkSize, P.in);
    ctx.fillStyle = P.in;
    ctx.font = "800 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(lang === "th" ? "เคลียร์แล้ว" : "Settled", PAD + checkSize + 14, y + 4);
  }

  // ---- Export as PNG Blob ----
  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

// Rounded-rect path helper (no fill/stroke — caller decides).
function _roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Draws a checkmark (no glyph — pure canvas path) centered in a `size`x`size` box
// at top-left (x, y). Used by the share-image "Settled" indicator. Avoids the
// iOS emoji-substitution problem (handover §9 — no Unicode glyphs for icons).
function _drawCheckmark(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size / 7);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.18, y + size * 0.55);
  ctx.lineTo(x + size * 0.42, y + size * 0.78);
  ctx.lineTo(x + size * 0.85, y + size * 0.25);
  ctx.stroke();
  ctx.restore();
}

// Truncates `str` with an ellipsis so its rendered width <= maxW.
// `ctx.font` must be set before calling.
function _clipText(ctx, str, maxW) {
  if (ctx.measureText(str).width <= maxW) return str;
  const ell = "…";
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(str.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo) + ell;
}

// Share one or more debt records as PNGs via the system share sheet.
// Multiple records always go oldest-first (date asc, createdAt asc) so the
// receiver reads the history in chronological order; filenames get an index
// prefix so name-sorted galleries keep that order too.
// Falls back to per-file downloads only when Web Share with files is
// genuinely unsupported.
let _debtShareBusy = false;
async function shareDebtRecords(debtList) {
  const list = (debtList || []).filter((d) => d && d.id);
  if (!list.length || _debtShareBusy) return;
  _debtShareBusy = true;
  try {
    loadStore();
    const peopleById = {};
    for (const p of (store.settings.people || [])) peopleById[p.id] = p;
    const defaultCurrency = (store.settings.defaultCurrency || "THB");
    const userName = (store.profile && store.profile.displayName) || "Me";
    const debtShareLanguage = store.settings.debtShareLanguage || "en";

    const ordered = list.slice().sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)
    );

    // Render sequentially — each card is a full-size canvas; parallel rendering
    // of a big selection would spike memory on iOS.
    const files = [];
    for (let i = 0; i < ordered.length; i++) {
      const debt = ordered[i];
      const person = peopleById[debt.personId]
        || { name: "(deleted person)", color: "#888", icon: "person" };
      const before = balanceBefore(store.debts || [], debt.id, peopleById);
      let blob;
      try {
        blob = await renderDebtCard(debt, person, before, defaultCurrency, userName, debtShareLanguage);
      } catch (err) {
        console.error("renderDebtCard failed:", err);
        alert("Couldn't generate the image — try again.");
        return;
      }
      if (!blob) return;
      const safeName = (person.name || "person").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
      const prefix = ordered.length > 1 ? String(i + 1).padStart(2, "0") + "-" : "";
      const filename = "debt-" + prefix + safeName + "-" + (debt.date || "record") + ".png";
      files.push(new File([blob], filename, { type: "image/png" }));
    }

    try {
      if (navigator.canShare && navigator.canShare({ files })) {
        // files only — adding title/text causes some iOS targets to save extra files
        await navigator.share({ files });
        return;
      }
      // Share with files genuinely unsupported → download fallback (oldest first).
      files.forEach((f) => _downloadBlob(f, f.name));
    } catch (err) {
      // AbortError = user cancelled the share sheet — stay quiet. Any other
      // failure (expired user gesture after a long render, double-tap): tell
      // the user instead of bursting N surprise downloads.
      if (err && err.name === "AbortError") return;
      alert("Sharing failed — try again or select fewer records.");
    }
  } finally {
    _debtShareBusy = false;
  }
}

// Back-compat wrapper — the per-row share buttons call this with one record.
async function shareDebtRecord(debt) {
  return shareDebtRecords([debt]);
}

// Tiny shared helper for blob downloads (mirrors downloadBackup pattern).
function _downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderPersonHistory(personId) {
  if (!personId) return;
  loadStore();
  const p = (store.settings.people || []).find((x) => x.id === personId);
  if (!p) {
    // Person was deleted while view was open — bounce back to dashboard.
    showView("dashboard");
    return;
  }
  document.getElementById("phName").textContent = p.name;
  const phIc = document.getElementById("phIc");
  phIc.style.background = p.color;
  phIc.innerHTML = personIconSvg(p.icon || "person");

  // Outstanding label
  const peopleById = {};
  for (const x of store.settings.people) peopleById[x.id] = x;
  const balances = personBalances(store.debts || [], peopleById);
  const row = balances.get(personId);
  const cur = store.settings.defaultCurrency || "THB";
  const out = document.getElementById("phOutstanding");
  out.classList.remove("is-in", "is-out");
  if (!row || row.direction === "clear") {
    out.textContent = "All clear";
  } else if (row.direction === "they-owe") {
    out.textContent = "They owe you " + fmt(Math.abs(row.outstanding), cur);
    out.classList.add("is-in");
  } else {
    out.textContent = "You owe " + fmt(Math.abs(row.outstanding), cur);
    out.classList.add("is-out");
  }

  // Records list
  const list = document.getElementById("phList");
  const empty = document.getElementById("phEmpty");
  list.innerHTML = "";
  // Personal subset for both rendering AND settlement annotation.
  const personDebts = (store.debts || []).filter((d) => d.personId === personId);
  const settlementMap = annotateSettlements(personDebts);

  // Display order is newest-first (opposite of chronological).
  const rows = personDebts.slice().sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)
  );
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  // Helpers for the row chrome.
  const dirLabel = (t) =>
    t === "lend" ? "Lent" :
    t === "paid-back" ? "Paid back" :
    t === "pay-back" ? "Paid back" :
    "Borrowed";
  const dirClass = (t) => (t === "lend" || t === "pay-back") ? "is-in" : "is-out";
  for (const d of rows) {
    const card = document.createElement("div");
    card.className = "dbt-history-row " + dirClass(d.type);
    const amtStr = fmt(d.convertedAmount != null ? d.convertedAmount : d.amount, cur);
    // Show the original currency+amount only when the record was converted from
    // a different currency than what's displayed.
    const showOrig = d.convertedAmount != null
      && d.convertedCurrency !== d.currency;
    const origLine = showOrig
      ? '<div class="dbt-orig">' + fmt(d.amount, d.currency) + '</div>'
      : (d.rateUnavailable
          ? '<div class="dbt-orig warn">' + fmt(d.amount, d.currency) + ' · rate n/a</div>'
          : '');
    const settled = settlementMap.get(d.id);
    const settledBadge = (settled && settled.settled)
      ? '<span class="dbt-settled">Settled</span>'
      : '';
    card.innerHTML =
      '<span class="dbt-dir">' + dirLabel(d.type) + '</span>' +
      '<div class="dbt-mid">' +
        '<div class="dbt-date">' + formatDate(d.date) + settledBadge + '</div>' +
        (d.notes ? '<div class="dbt-notes">' + escapeHtml(d.notes) + '</div>' : '') +
      '</div>' +
      '<div class="dbt-right">' +
        '<span class="dbt-amt">' + amtStr + '</span>' +
        origLine +
      '</div>' +
      '<button type="button" class="dbt-share" aria-label="Share record">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3v12"/>' +
          '<path d="M7 8l5-5 5 5"/>' +
          '<path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>' +
        '</svg>' +
      '</button>';
    card.addEventListener("click", () => openDebtModal(d));
    const shareBtn = card.querySelector(".dbt-share");
    if (shareBtn) {
      shareBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();   // don't trigger the row's edit handler
        shareDebtRecord(d);
      });
    }
    list.appendChild(card);
  }
}

document.getElementById("phBack")?.addEventListener("click", () => {
  _currentHistoryPersonId = null;
  showView("dashboard");
});

/* ================================================================
   DebtTrakr — View All Records (parallel to MuniTrakr's view-records)
   ================================================================ */

let debtMultiSelect = false;
let debtSelected = new Set();
let debtRecFilter = new Set();      // Set<personId> filtering the list
let lastDbtRows = [];               // currently-visible (post-filter) debt records

function renderDebtRecords() {
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;

  // Top summary cards (mirror dashboard math)
  const balances = personBalances(store.debts || [], peopleById);
  const { totalLend, totalBorrow } = totalsAcrossPeople(balances);
  const cur = store.settings.defaultCurrency || "THB";
  document.getElementById("dbtRecTotalLend").textContent = fmt(totalLend);
  document.getElementById("dbtRecTotalBorrow").textContent = fmt(totalBorrow);
  document.querySelector("#dbtRecCardLend .muted").textContent = "Total Lend · " + cur;
  document.querySelector("#dbtRecCardBorrow .muted").textContent = "Total Borrow · " + cur;
  if (typeof fitText === "function") {
    fitText(document.getElementById("dbtRecTotalLend"), 22, 11);
    fitText(document.getElementById("dbtRecTotalBorrow"), 22, 11);
  }

  // Compute the visible list (filter by selected people if any)
  let rows = (store.debts || []).slice();
  if (debtRecFilter.size) rows = rows.filter((d) => debtRecFilter.has(d.personId));
  // Newest first
  rows.sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)
  );
  lastDbtRows = rows;

  document.getElementById("dbtRecCount").textContent = rows.length;
  document.getElementById("dbtRecFilterBtn").classList.toggle("on", debtRecFilter.size > 0);

  // Settlement annotations for the "Settled" badge in each row
  const settlementMap = annotateSettlements(store.debts || []);

  const wrap = document.getElementById("dbtRecList");
  wrap.classList.toggle("select-mode", debtMultiSelect);
  document.getElementById("dbtRecEmpty").classList.toggle("hidden", rows.length > 0);
  wrap.innerHTML = "";

  // Prune selected ids that fell out of the visible set
  const visibleIds = new Set(rows.map((r) => r.id));
  [...debtSelected].forEach((id) => !visibleIds.has(id) && debtSelected.delete(id));

  const dirLabel = (t) =>
    t === "lend" ? "Lent" :
    t === "paid-back" ? "Paid back" :
    t === "pay-back" ? "Paid back" :
    "Borrowed";
  const dirClass = (t) => (t === "lend" || t === "pay-back") ? "is-in" : "is-out";

  for (const d of rows) {
    const p = peopleById[d.personId];
    const el = document.createElement("div");
    el.className = "rec" + (debtMultiSelect && debtSelected.has(d.id) ? " selected" : "");
    if (debtMultiSelect) {
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "rec-check";
      chk.checked = debtSelected.has(d.id);
      chk.tabIndex = -1;
      el.appendChild(chk);
    }
    const inner = document.createElement("div");
    inner.style.cssText = "display:flex;gap:12px;flex:1;min-width:0;align-items:flex-start";
    const sign = (d.type === "lend" || d.type === "pay-back") ? "+" : "-";
    const amtStr = sign + fmt(d.convertedAmount != null ? d.convertedAmount : d.amount, cur);
    const showOrig = d.convertedAmount != null && d.convertedCurrency !== d.currency;
    const origLine = showOrig
      ? '<div class="rec-orig">' + fmt(d.amount, d.currency) + '</div>'
      : (d.rateUnavailable
          ? '<div class="rec-orig warn">' + fmt(d.amount, d.currency) + ' · rate n/a</div>'
          : '');
    const settled = settlementMap.get(d.id);
    const settledBadge = (settled && settled.settled)
      ? ' <span class="dbt-settled">Settled</span>'
      : '';
    const personName = p ? escapeHtml(p.name) : '(deleted person)';
    const personColor = p ? p.color : '#444';
    const personIcon  = p ? (p.icon || "person") : "person";
    inner.innerHTML =
      '<div class="rec-ico" style="background:' + personColor + '">' +
        personIconSvg(personIcon, "rec-ico-svg") +
      '</div>' +
      '<div class="rec-body">' +
        '<div class="rec-cat">' + personName + '</div>' +
        '<div class="rec-sub"><span class="dbt-dir-inline ' + dirClass(d.type) + '">' + dirLabel(d.type) + '</span>' + settledBadge + '</div>' +
        (d.notes ? '<div class="rec-notes">' + escapeHtml(d.notes) + '</div>' : '') +
      '</div>' +
      '<div class="rec-right">' +
        '<div class="rec-amt ' + ((d.type === "lend" || d.type === "pay-back") ? "amt-in" : "amt-out") + '">' + amtStr + '</div>' +
        origLine +
        '<div class="rec-date">' + formatDate(d.date) + '</div>' +
      '</div>';
    el.appendChild(inner);
    // Share button — only when not in multi-select mode (avoids tap conflicts
    // and visual clutter while the user is bulk-selecting rows to delete).
    if (!debtMultiSelect) {
      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "dbt-share";
      shareBtn.setAttribute("aria-label", "Share record");
      shareBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3v12"/>' +
          '<path d="M7 8l5-5 5 5"/>' +
          '<path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>' +
        '</svg>';
      shareBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        shareDebtRecord(d);
      });
      el.appendChild(shareBtn);
    }
    el.addEventListener("click", () => {
      if (debtMultiSelect) {
        if (debtSelected.has(d.id)) debtSelected.delete(d.id);
        else debtSelected.add(d.id);
        el.classList.toggle("selected", debtSelected.has(d.id));
        const c = el.querySelector(".rec-check");
        if (c) c.checked = debtSelected.has(d.id);
        dbtUpdateSelUI();
      } else {
        openDebtModal(d);
      }
    });
    wrap.appendChild(el);
  }
  dbtUpdateSelUI();
}

function buildDebtFilterMenu() {
  const menu = document.getElementById("dbtRecFilterMenu");
  if (!menu) return;
  loadStore();
  const people = store.settings.people || [];
  if (!people.length) {
    menu.innerHTML = '<div class="muted" style="padding:12px">No people yet.</div>';
    return;
  }
  menu.innerHTML = people.map((p) =>
    '<label class="filter-opt">' +
      '<input type="checkbox" data-id="' + p.id + '" ' + (debtRecFilter.has(p.id) ? "checked" : "") + ' />' +
      '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
      '<span>' + escapeHtml(p.name) + '</span>' +
    '</label>'
  ).join("") +
    '<button type="button" class="filter-clear" id="dbtRecFilterClear">Clear filters</button>';

  menu.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const id = cb.dataset.id;
      if (debtRecFilter.has(id)) debtRecFilter.delete(id);
      else debtRecFilter.add(id);
      renderDebtRecords();
    });
  });
  document.getElementById("dbtRecFilterClear")?.addEventListener("click", () => {
    debtRecFilter.clear();
    buildDebtFilterMenu();
    renderDebtRecords();
  });
  // Keep menu open when clicking labels/checkboxes
  menu.addEventListener("click", (e) => e.stopPropagation());
}

function dbtUpdateSelUI() {
  const n = debtSelected.size;
  const sc = document.getElementById("dbtSelCount");
  if (sc) {
    sc.textContent = n + " selected";
    sc.classList.toggle("hidden", !debtMultiSelect);
  }
  const delBtn = document.getElementById("dbtMsDelete");
  if (delBtn) delBtn.disabled = n === 0;
  const shareBtn = document.getElementById("dbtMsShare");
  if (shareBtn) shareBtn.disabled = n === 0;
  const allBtn = document.getElementById("dbtMsAll");
  if (allBtn) {
    const allSel = lastDbtRows.length > 0 && n === lastDbtRows.length;
    allBtn.classList.toggle("on", allSel);
  }
}

function dbtEnterMulti() {
  debtMultiSelect = true;
  debtSelected.clear();
  renderDebtRecords();
  updateFabs();
}
function dbtExitMulti() {
  debtMultiSelect = false;
  debtSelected.clear();
  renderDebtRecords();
  updateFabs();
}

// Wire entry point + view buttons
document.getElementById("viewAllDebtBtn")?.addEventListener("click", () => showView("debt-records"));
document.getElementById("dbtRecBack")?.addEventListener("click", () => {
  if (debtMultiSelect) { dbtExitMulti(); return; }
  showView("dashboard");
});
document.getElementById("dbtRecFilterBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = document.getElementById("dbtRecFilterMenu");
  if (!menu) return;
  if (menu.classList.contains("hidden")) {
    buildDebtFilterMenu();
    menu.classList.remove("hidden");
  } else {
    menu.classList.add("hidden");
  }
});
// Outside-click closes the filter menu
document.addEventListener("click", (e) => {
  const menu = document.getElementById("dbtRecFilterMenu");
  if (!menu || menu.classList.contains("hidden")) return;
  if (!e.target.closest("#dbtRecFilterMenu") && !e.target.closest("#dbtRecFilterBtn")) {
    menu.classList.add("hidden");
  }
});

// Multi-select wiring
document.getElementById("dbtMultiBtn")?.addEventListener("click", dbtEnterMulti);
document.getElementById("dbtMsCancel")?.addEventListener("click", dbtExitMulti);
document.getElementById("dbtMsAll")?.addEventListener("click", () => {
  const allSel = lastDbtRows.length > 0 && debtSelected.size === lastDbtRows.length;
  debtSelected.clear();
  if (!allSel) lastDbtRows.forEach((r) => debtSelected.add(r.id));
  renderDebtRecords();
});
document.getElementById("dbtMsDelete")?.addEventListener("click", () => {
  if (!debtSelected.size) return;
  if (!confirm("Delete " + debtSelected.size + " debt record(s)? This can't be undone.")) return;
  loadStore();
  store.debts = (store.debts || []).filter((d) => !debtSelected.has(d.id));
  saveStore();
  debtSelected.clear();
  // Stay in multi-select mode but re-render
  renderDebtRecords();
});
document.getElementById("dbtMsShare")?.addEventListener("click", () => {
  if (!debtSelected.size) return;
  // Selection survives the share (non-destructive) — stay in multi-select.
  shareDebtRecords(lastDbtRows.filter((r) => debtSelected.has(r.id)));
});
