/* ============================================================
 *  おてつだいアプリ
 *  - お手伝い項目をタップするとカウント＆金額が積み上がる
 *  - こうもくごとに へいじつえん・やすみびえん を ちがえられる (タップした日が やすみびなら やすみびえん)
 *  - 月が変わると自動的に集計をリセット (過去分は履歴へ)
 *  - データはブラウザの localStorage に保存
 * ============================================================ */

/** ふるいきろくだけ: きほん(へいじつ)えん から やすみびを だいたい9わりで さいけいさんするとき */
const LEGACY_HOLIDAY_RATE = 0.9;

const STORAGE_KEY = "otetsudai-app-v1";
const FAMILY_GATE_KEY = "otetsudai-family-unlocked";

// かぞくだけで つかうための「あいことば」
// ここを かえてから push すると、家族以外は ひらきにくくなります。
const FAMILY_PASSCODE = "青森旅行";

/** こうもくリストを あたらしい デフォルトに そろえるときの版 */
const CHORE_SCHEMA_VERSION = 2;

// デフォルトのお手伝い項目 (やすみび=ユーザー指定、へいじつは だいたい ÷0.9 の四捨五入で そろえた)
const DEFAULT_CHORES = [
  { id: "c1", emoji: "🍽️", name: "おさらあらい", priceHoliday: 100, priceWeekday: 111, showDualPrice: false },
  { id: "c2", emoji: "👕", name: "せんたくものを\nかたづける", priceHoliday: 50, priceWeekday: 56, showDualPrice: true },
  { id: "c3", emoji: "🌀", name: "かんそうきに\nいれる", priceHoliday: 20, priceWeekday: 22, showDualPrice: true },
  { id: "c5", emoji: "🛁", name: "おふろそうじ", priceHoliday: 150, priceWeekday: 167, showDualPrice: false },
  { id: "c7", emoji: "👟", name: "くつをそろえる", priceHoliday: 10, priceWeekday: 11, showDualPrice: false },
  { id: "c8", emoji: "🐱", name: "ペットの\nおせわ", priceHoliday: 100, priceWeekday: 111, showDualPrice: false },
  { id: "c9", emoji: "🍳", name: "おりょうりの\nおてつだい", priceHoliday: 50, priceWeekday: 56, showDualPrice: false },
];

// ===== データ管理 =====
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isFamilyUnlocked() {
  try {
    return localStorage.getItem(FAMILY_GATE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function setFamilyUnlocked() {
  try {
    localStorage.setItem(FAMILY_GATE_KEY, "1");
  } catch (_) {
    // ignore
  }
}

function setupFamilyGate(startApp) {
  const gate = document.querySelector("#familyGate");
  if (!gate) {
    startApp();
    return;
  }

  if (isFamilyUnlocked()) {
    gate.hidden = true;
    startApp();
    return;
  }

  const input = document.querySelector("#gateInput");
  const ok = document.querySelector("#gateOk");
  const err = document.querySelector("#gateError");
  gate.hidden = false;

  function tryUnlock() {
    const v = (input && input.value ? input.value : "").trim();
    if (v && v === FAMILY_PASSCODE) {
      setFamilyUnlocked();
      gate.hidden = true;
      startApp();
      return;
    }
    if (err) err.hidden = false;
    if (input) input.select();
  }

  if (input) {
    input.addEventListener("input", () => {
      if (err) err.hidden = true;
    });
    input.addEventListener("keydown", (e) => {
      // 日本語へんかんちゅうの Enter（へんかんかくてい）では はんていしない
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        tryUnlock();
      }
    });
    queueMicrotask(() => input.focus());
  }
  if (ok) ok.addEventListener("click", tryUnlock);
}

let state = loadState() || {
  chores: DEFAULT_CHORES.map((c) => ({ ...c })),
  // records: { [monthKey "YYYY-MM"]: [{ id, choreId, ts, amount? }] }
  // amount は そのときの きんがく (円)。ない古いきろくは ts と いまの きほんから さいけいさん
  records: {},
  choreSchemaVersion: CHORE_SCHEMA_VERSION,
  /** つきごとの にゅうきん: { "YYYY-MM": { received, receivedAt, amountSnapshot } } */
  monthPayouts: {},
};

if (!state.monthPayouts) state.monthPayouts = {};

if (state.choreSchemaVersion == null) state.choreSchemaVersion = 1;
if (state.choreSchemaVersion < CHORE_SCHEMA_VERSION) {
  state.chores = DEFAULT_CHORES.map((c) => ({ ...c }));
  state.choreSchemaVersion = CHORE_SCHEMA_VERSION;
  saveState();
}

// 以前の デフォルト (いぬ) から ねこ に そろえる
(function migratePetEmoji() {
  const pet = state.chores && state.chores.find((c) => c.id === "c8");
  if (pet && pet.emoji === "🐶") {
    pet.emoji = "🐱";
    saveState();
  }
})();

// ===== ユーティリティ =====
function nowMonthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  return `${y}ねん ${parseInt(m, 10)}がつ`;
}

/** そのつきの ごうけいえん・かいすう・しょうさい HTML */
function computeMonthBreakdown(monthKey) {
  const recs = state.records[monthKey] || [];
  let total = 0;
  const byChore = {};
  for (const r of recs) {
    const c = getChoreById(r.choreId);
    if (!c) continue;
    const y = yenForRecord(r);
    total += y;
    if (!byChore[c.id]) byChore[c.id] = { count: 0, sumYen: 0 };
    byChore[c.id].count += 1;
    byChore[c.id].sumYen += y;
  }
  const detailHtml = Object.entries(byChore)
    .map(([cid, agg]) => {
      const c = getChoreById(cid);
      if (!c) return "";
      return `<div>${escapeHtml(c.emoji)} ${escapeHtml(c.name.replace(/\n/g, " "))} <span class="amount">× ${agg.count}かい (${formatYen(agg.sumYen)})</span></div>`;
    })
    .join("");
  return { total, count: recs.length, detailHtml };
}

function getMonthTotalYen(monthKey) {
  return billTotalYen(monthKey);
}

/**
 * monthPayouts のデータを「部分入金」対応の形にそろえる。
 * 新形式: { payments: [{ amount, ts }], waived: number, waivedAt: ts|null }
 * 旧形式: { received, receivedAt, amountSnapshot } は payments 1件に変換。
 */
function normalizePayout(monthKey) {
  let p = state.monthPayouts[monthKey];
  if (!p) p = {};
  if (!Array.isArray(p.payments)) {
    p.payments = [];
    if (p.received) {
      p.payments.push({
        amount: p.amountSnapshot != null ? p.amountSnapshot : 0,
        ts: p.receivedAt != null ? p.receivedAt : Date.now(),
      });
    }
  }
  if (typeof p.waived !== "number") p.waived = 0;
  if (p.waivedAt === undefined) p.waivedAt = null;
  if (typeof p.carried !== "number") p.carried = 0; // この月から つぎの月へ くりこした額
  if (p.carriedAt === undefined) p.carriedAt = null;
  state.monthPayouts[monthKey] = p;
  return p;
}

/** monthKey を delta か月 ずらす（年またぎ対応） */
function shiftMonthKey(monthKey, delta) {
  let [y, m] = monthKey.split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** つぎの月の「ひょうじよう」ラベル（くりこし先） */
function nextMonthLabel(monthKey) {
  return formatMonthLabel(shiftMonthKey(monthKey, 1));
}

/** せんげつから この月へ くりこされてきた額 */
function carryInYen(monthKey) {
  const prev = state.monthPayouts[shiftMonthKey(monthKey, -1)];
  return prev && typeof prev.carried === "number" ? prev.carried : 0;
}

/** お手伝いだけの合計（くりこしをふくまない） */
function choreTotalYen(monthKey) {
  return computeMonthBreakdown(monthKey).total;
}

/** せいきゅう合計＝お手伝い合計＋せんげつからのくりこし */
function billTotalYen(monthKey) {
  return choreTotalYen(monthKey) + carryInYen(monthKey);
}

/** そのつきの 入金じょうきょう（合計・もらったぶん・チャラ・くりこし・のこり・せいさんずみか） */
function getPayoutInfo(monthKey) {
  const carryIn = carryInYen(monthKey);
  const choreTotal = choreTotalYen(monthKey);
  const total = choreTotal + carryIn;
  const p = normalizePayout(monthKey);
  const paid = p.payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const waived = Number(p.waived) || 0;
  const carried = Number(p.carried) || 0;
  const remaining = Math.max(0, total - paid - waived - carried);
  const hasActivity = paid > 0 || waived > 0 || carried > 0;
  const settled = hasActivity && remaining <= 0;
  let lastTs = null;
  if (p.payments.length) lastTs = p.payments[p.payments.length - 1].ts;
  else if (p.carriedAt != null) lastTs = p.carriedAt;
  else if (p.waivedAt != null) lastTs = p.waivedAt;
  return { total, choreTotal, carryIn, paid, waived, carried, remaining, settled, hasActivity, payments: p.payments, lastTs };
}

/** いちぶ（または ぜんぶ）の にゅうきんを きろくする */
function addPayment(monthKey, amount) {
  const amt = Math.max(0, Math.round(Number(amount) || 0));
  if (amt <= 0) return;
  const p = normalizePayout(monthKey);
  p.payments.push({ amount: amt, ts: Date.now() });
  saveState();
}

/** のこりを「おまけ」でチャラにして せいさんずみにする */
function waiveRemainder(monthKey) {
  const info = getPayoutInfo(monthKey);
  if (info.remaining <= 0) return;
  const p = normalizePayout(monthKey);
  p.waived = (Number(p.waived) || 0) + info.remaining;
  p.waivedAt = Date.now();
  saveState();
}

/** のこりを つぎの月へ くりこす（つぎの月の せいきゅうに のる） */
function carryRemainder(monthKey) {
  const info = getPayoutInfo(monthKey);
  if (info.remaining <= 0) return;
  const p = normalizePayout(monthKey);
  p.carried = (Number(p.carried) || 0) + info.remaining;
  p.carriedAt = Date.now();
  saveState();
}

/** この月の 入金きろくを すべて けして やりなおす（くりこしも かいじょ） */
function resetPayout(monthKey) {
  state.monthPayouts[monthKey] = {
    payments: [],
    waived: 0,
    waivedAt: null,
    carried: 0,
    carriedAt: null,
  };
  saveState();
}

function formatReceivedDate(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}がつ${d.getDate()}にち ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** いまよりまえのつきで、きんがくがのこっていて、まだにゅうきんしていない さいしんの1つき */
function findFirstUnpaidPastMonth() {
  const cur = nowMonthKey();
  const keys = Object.keys(state.records)
    .filter((k) => k < cur && getMonthTotalYen(k) > 0)
    .sort()
    .reverse();
  for (const k of keys) {
    if (!getPayoutInfo(k).settled) return k;
  }
  return null;
}

/** キリのよい にゅうきんこうほ（のこりから 1000/500/100 きざみで きりさげ） */
function quickPayCandidates(remaining) {
  const set = new Set();
  if (remaining > 0) set.add(remaining);
  for (const step of [1000, 500, 100]) {
    const v = Math.floor(remaining / step) * step;
    if (v > 0) set.add(v);
  }
  return Array.from(set)
    .filter((v) => v > 0 && v <= remaining)
    .sort((a, b) => b - a)
    .slice(0, 4);
}

function fillInvoiceModal(monthKey, opts = {}) {
  const { detailHtml } = computeMonthBreakdown(monthKey);
  const info = getPayoutInfo(monthKey);
  const total = info.total;
  $("#invoiceModal").dataset.targetMonth = monthKey;
  $("#invoiceMonthLine").textContent = `${formatMonthLabel(monthKey)} せいきゅう`;
  $("#invoiceTotal").textContent = formatYen(total);
  let detail = detailHtml || "<div>（ないようなし）</div>";
  if (info.carryIn > 0) {
    detail += `<div class="invoice-carryin">↩︎ せんげつからの くりこし <span class="amount">${formatYen(info.carryIn)}</span></div>`;
  }
  $("#invoiceDetail").innerHTML = detail;
  const lead = $("#invoiceLead");
  if (opts.isAuto) {
    lead.textContent = `${formatMonthLabel(monthKey)}のおてつだいおきゅうりょうが、まだのこっています。おかあさんに、このせいきゅうしょをみせてね。`;
  } else {
    lead.textContent = `${formatMonthLabel(monthKey)}のせいきゅうしょです。`;
  }

  // もらったぶん・チャラ・のこり の行
  const paidLine = $("#invoicePaidLine");
  if (info.hasActivity) {
    const parts = [];
    if (info.paid > 0) parts.push(`<span class="paid-chip paid-chip-got">もらった ${formatYen(info.paid)}</span>`);
    if (info.carried > 0) parts.push(`<span class="paid-chip paid-chip-carry">${nextMonthLabel(monthKey)}へ くりこし ${formatYen(info.carried)}</span>`);
    if (info.waived > 0) parts.push(`<span class="paid-chip paid-chip-waive">おまけ ${formatYen(info.waived)}</span>`);
    if (info.remaining > 0) parts.push(`<span class="paid-chip paid-chip-left">のこり ${formatYen(info.remaining)}</span>`);
    paidLine.innerHTML = parts.join("");
    paidLine.hidden = false;
  } else {
    paidLine.innerHTML = "";
    paidLine.hidden = true;
  }

  const stamp = $("#invoiceStamp");
  const note = $("#invoiceNote");
  if (info.settled) {
    const extra = [];
    if (info.carried > 0) extra.push(`${nextMonthLabel(monthKey)}へ ${formatYen(info.carried)}`);
    if (info.waived > 0) extra.push(`おまけ ${formatYen(info.waived)}`);
    const extraText = extra.length ? `（${extra.join("・")}）` : "";
    stamp.innerHTML =
      `<span class="invoice-stamp-paid">せいさんずみ</span>` +
      `<span class="invoice-stamp-date">もらった ${formatYen(info.paid)}${extraText}・${formatReceivedDate(info.lastTs)}</span>`;
    note.textContent = "このつきのおきゅうりょうは、せいさんおわっています。";
  } else if (info.paid > 0) {
    stamp.innerHTML =
      `<span class="invoice-stamp-part">いちぶ にゅうきん</span>` +
      `<span class="invoice-stamp-date">のこり ${formatYen(info.remaining)}</span>`;
    note.textContent = "のこりを もらったら、また きんがくを いれて「もらった」をおしてね。";
  } else {
    stamp.innerHTML = `<span class="invoice-stamp-wait">みにゅうきん（まち）</span>`;
    note.textContent = "おかねをうけとったら、きんがくをいれて「もらった」をおしてね。";
  }

  // 金額入力（デフォルトはのこり）・キリよくボタン
  const payRow = $("#invoicePayRow");
  const payInput = $("#invoicePayInput");
  const quick = $("#invoiceQuick");
  payRow.hidden = info.settled || total <= 0;
  if (!payRow.hidden) {
    payInput.value = String(info.remaining);
    payInput.max = String(info.remaining);
    quick.innerHTML = quickPayCandidates(info.remaining)
      .map((v) => `<button type="button" class="quick-amt" data-amt="${v}">${formatYen(v)}</button>`)
      .join("");
  } else {
    quick.innerHTML = "";
  }

  $("#invoiceReceivedBtn").hidden = info.settled || total <= 0;
  $("#invoiceCarryBtn").hidden = info.settled || total <= 0 || info.remaining <= 0;
  $("#invoiceWaiveBtn").hidden = info.settled || total <= 0 || info.remaining <= 0;
  $("#invoiceLaterBtn").hidden = info.settled;
  $("#invoiceCloseBtn").hidden = !info.settled;
  // まちがえたときの やりなおし（なにか きろくが あるときだけ）
  $("#invoiceRedoBtn").hidden = !info.hasActivity;
}

function openInvoiceModal(monthKey, opts = {}) {
  fillInvoiceModal(monthKey, opts);
  $("#invoiceModal").hidden = false;
}

function maybeAutoOpenInvoice() {
  if (!$("#invoiceModal").hidden) return;
  const mk = findFirstUnpaidPastMonth();
  if (!mk) return;
  openInvoiceModal(mk, { isAuto: true });
}

function formatYen(n) {
  return "¥" + n.toLocaleString("ja-JP");
}

function uid() {
  return "x" + Math.random().toString(36).slice(2, 9);
}

function getChoreById(id) {
  return state.chores.find((c) => c.id === id);
}

function getCurrentRecords() {
  const key = nowMonthKey();
  if (!state.records[key]) state.records[key] = [];
  return state.records[key];
}

/** 土曜・日曜 */
function isWeekendDate(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** 日本の しゅくじつ (振替・国民の休日をふくむ)。japanese-holidays がないときは false */
function isJapanesePublicHoliday(ts) {
  if (typeof JapaneseHolidays === "undefined" || !JapaneseHolidays.isHolidayAt) return false;
  return !!JapaneseHolidays.isHolidayAt(new Date(ts), true);
}

/** やすみび ちょうかの日: 土日 または 日本の祝日カレンダー上の休み */
function isDiscountPricingDay(ts) {
  const d = new Date(ts);
  if (isWeekendDate(d)) return true;
  return isJapanesePublicHoliday(ts);
}

function chorePriceHoliday(chore) {
  if (chore.priceHoliday != null) return Math.max(0, chore.priceHoliday);
  if (typeof chore.price === "number") return Math.round(chore.price * LEGACY_HOLIDAY_RATE);
  return 0;
}

function chorePriceWeekday(chore) {
  if (chore.priceWeekday != null) return Math.max(0, chore.priceWeekday);
  if (typeof chore.price === "number") return chore.price;
  return 0;
}

/** こうもくと タップした日時 から その1かいの きんがく(円) */
function yenForTap(chore, ts) {
  return isDiscountPricingDay(ts) ? chorePriceHoliday(chore) : chorePriceWeekday(chore);
}

/** きろく1件の きんがく。あたらしいきろくは amount あり、ふるいきろくは さいけいさん */
function yenForRecord(r) {
  const chore = getChoreById(r.choreId);
  if (!chore) return 0;
  if (typeof r.amount === "number" && !Number.isNaN(r.amount)) return r.amount;
  return yenForTap(chore, r.ts);
}

/** カードに かく きんがくの HTML（へいじつ→休日の順で オレンジ行をそろえる） */
function formatChoreCardPrices(chore) {
  const h = chorePriceHoliday(chore);
  const w = chorePriceWeekday(chore);
  return `<div class="chore-price-dual">
    <div class="chore-price-row"><span class="chore-price-label">へいじつ</span><span class="chore-price-num">${formatYen(w)}</span></div>
    <div class="chore-price-row"><span class="chore-price-label">休日</span><span class="chore-price-num">${formatYen(h)}</span></div>
  </div>`;
}

// ===== 描画 =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function renderMonthLabel() {
  $("#monthLabel").textContent = formatMonthLabel(nowMonthKey()) + " の おてつだい";
}

function renderSummary() {
  const records = getCurrentRecords();
  const totalCount = records.length;
  let totalMoney = 0;
  for (const r of records) {
    totalMoney += yenForRecord(r);
  }
  $("#totalCount").innerHTML = `${totalCount}<span class="unit">かい</span>`;
  $("#totalMoney").textContent = formatYen(totalMoney);
}

function renderChores() {
  const grid = $("#choresGrid");
  grid.innerHTML = "";
  const records = getCurrentRecords();
  const countByChore = {};
  for (const r of records) {
    countByChore[r.choreId] = (countByChore[r.choreId] || 0) + 1;
  }

  for (const chore of state.chores) {
    const count = countByChore[chore.id] || 0;
    // 外側は button にしない（内側のマイナスと二重になり、タップが加算に化けるのを防ぐ）
    const card = document.createElement("div");
    card.className = "chore-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.choreId = chore.id;
    card.innerHTML = `
      ${count > 0 ? `<button type="button" class="undo-btn" data-undo="${chore.id}" aria-label="1かい けす">−</button>` : ""}
      <span class="chore-count-badge ${count === 0 ? "hidden" : ""}">${count}</span>
      <div class="chore-emoji">${escapeHtml(chore.emoji || "✨")}</div>
      <div class="chore-name">${escapeHtml(chore.name)}</div>
      ${formatChoreCardPrices(chore)}
    `;
    grid.appendChild(card);
  }
}

function renderRecent() {
  const ul = $("#recentList");
  const records = getCurrentRecords()
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);

  if (records.length === 0) {
    ul.innerHTML = `<li class="recent-empty">まだ なにも やってないよ。さいしょの 1かい を おしてみよう！</li>`;
    return;
  }

  ul.innerHTML = "";
  for (const r of records) {
    const chore = getChoreById(r.choreId);
    if (!chore) continue;
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="r-emoji">${escapeHtml(chore.emoji)}</span>
      <span class="r-name">${escapeHtml(chore.name.replace(/\n/g, " "))}</span>
      <span class="r-time">${formatTime(r.ts)}</span>
      <span class="r-price">${formatYen(yenForRecord(r))}</span>
    `;
    ul.appendChild(li);
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${hh}:${mm}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderAll() {
  renderMonthLabel();
  renderSummary();
  renderChores();
  renderRecent();
}

// ===== 操作 =====
function addRecord(choreId) {
  const chore = getChoreById(choreId);
  if (!chore) return;
  const ts = Date.now();
  const amount = yenForTap(chore, ts);
  const records = getCurrentRecords();
  records.push({ id: uid(), choreId, ts, amount });
  saveState();
  renderAll();
  const d = new Date(ts);
  let dayTag = "（へいじつ）";
  if (isDiscountPricingDay(ts)) {
    if (isWeekendDate(d)) dayTag = "（休日）";
    else dayTag = "（しゅくじつ）";
  }
  showToast(`${chore.emoji} ${chore.name.replace(/\n/g, "")} ＋${formatYen(amount)}${dayTag}`);
}

function undoLastFor(choreId) {
  const records = getCurrentRecords();
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].choreId === choreId) {
      records.splice(i, 1);
      saveState();
      renderAll();
      showToast("1かい けしたよ");
      return;
    }
  }
}

let toastTimer = null;
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1400);
}

// ===== 履歴 =====
function openHistory() {
  const body = $("#historyBody");
  const months = Object.keys(state.records).sort().reverse();
  if (months.length === 0 || months.every((k) => state.records[k].length === 0)) {
    body.innerHTML = `<div class="history-empty">まだ きろくが ないよ。</div>`;
    $("#historyModal").hidden = false;
    return;
  }

  body.innerHTML = months
    .filter((k) => state.records[k].length > 0)
    .map((k) => {
      const recs = state.records[k];
      const { count, detailHtml } = computeMonthBreakdown(k);
      const info = getPayoutInfo(k);
      const total = info.total;
      let payoutRow = "";
      if (total > 0 || info.hasActivity) {
        if (info.settled) {
          const extra = [];
          if (info.carried > 0) extra.push(`${nextMonthLabel(k)}へ ${formatYen(info.carried)}`);
          if (info.waived > 0) extra.push(`おまけ ${formatYen(info.waived)}`);
          const extraText = extra.length ? `（${extra.join("・")}）` : "";
          payoutRow = `<div class="history-payout">
            <span class="payout-badge payout-badge-ok">せいさんずみ</span>
            <span class="payout-meta">もらった ${formatYen(info.paid)}${extraText} ・ ${formatReceivedDate(info.lastTs)}</span>
            <button type="button" class="btn-invoice-link" data-open-invoice="${k}">せいきゅうしょ</button>
          </div>`;
        } else if (info.paid > 0) {
          payoutRow = `<div class="history-payout">
            <span class="payout-badge payout-badge-part">いちぶ にゅうきん</span>
            <span class="payout-meta">もらった ${formatYen(info.paid)} ・ のこり ${formatYen(info.remaining)}</span>
            <button type="button" class="btn-invoice-link" data-open-invoice="${k}">せいきゅうしょをみる</button>
          </div>`;
        } else {
          payoutRow = `<div class="history-payout">
            <span class="payout-badge payout-badge-wait">みにゅうきん（まち）</span>
            <button type="button" class="btn-invoice-link" data-open-invoice="${k}">せいきゅうしょをみる</button>
          </div>`;
        }
      }
      const carryInNote = info.carryIn > 0
        ? `<div class="history-carryin">↩︎ せんげつからの くりこし ${formatYen(info.carryIn)} ふくむ</div>`
        : "";
      return `
        <div class="history-month">
          <h3>${formatMonthLabel(k)}</h3>
          <div class="history-month-summary">
            <span>ぜんぶで ${count}かい</span>
            <span class="money">${formatYen(total)}</span>
          </div>
          <div class="history-month-detail">${detailHtml}</div>
          ${carryInNote}
          ${payoutRow}
        </div>
      `;
    })
    .join("");

  $("#historyModal").hidden = false;
}

// ===== 設定 =====
function openSettings() {
  renderSettingsList();
  $("#settingsModal").hidden = false;
}

function renderSettingsList() {
  const list = $("#settingsList");
  list.innerHTML = "";
  for (const chore of state.chores) {
    const row = document.createElement("div");
    row.className = "setting-row";
    row.dataset.id = chore.id;
    row.innerHTML = `
      <input class="emoji-input" type="text" maxlength="4" value="${escapeHtml(chore.emoji)}" data-field="emoji" />
      <input type="text" value="${escapeHtml(chore.name.replace(/\n/g, " "))}" data-field="name" placeholder="なまえ" />
      <label class="price-field"><span class="price-field-label">休日</span>
        <input class="price-input" type="number" min="0" step="10" value="${chorePriceHoliday(chore)}" data-field="priceHoliday" />
      </label>
      <label class="price-field"><span class="price-field-label">へいじつ</span>
        <input class="price-input" type="number" min="0" step="10" value="${chorePriceWeekday(chore)}" data-field="priceWeekday" />
      </label>
      <button class="delete-row" data-delete="${chore.id}" aria-label="けす">×</button>
    `;
    list.appendChild(row);
  }
}

function applySettingsFromUI() {
  const rows = $$("#settingsList .setting-row");
  const next = [];
  rows.forEach((row) => {
    const id = row.dataset.id;
    const emoji = row.querySelector('[data-field="emoji"]').value.trim() || "✨";
    const name = row.querySelector('[data-field="name"]').value.trim() || "おてつだい";
    const priceHoliday = Math.max(0, parseInt(row.querySelector('[data-field="priceHoliday"]').value, 10) || 0);
    const priceWeekday = Math.max(0, parseInt(row.querySelector('[data-field="priceWeekday"]').value, 10) || 0);
    const prev = state.chores.find((c) => c.id === id);
    next.push({
      id,
      emoji,
      name,
      priceHoliday,
      priceWeekday,
      showDualPrice: !!(prev && prev.showDualPrice),
    });
  });
  state.chores = next;
  saveState();
  renderAll();
}

// ===== 確認ダイアログ =====
function confirmAsk(message, onOk) {
  $("#confirmText").textContent = message;
  $("#confirmModal").hidden = false;
  const ok = $("#confirmOk");
  const cancel = $("#confirmCancel");
  const close = () => { $("#confirmModal").hidden = true; };
  const handler = () => { close(); onOk(); cleanup(); };
  const cancelHandler = () => { close(); cleanup(); };
  function cleanup() {
    ok.removeEventListener("click", handler);
    cancel.removeEventListener("click", cancelHandler);
  }
  ok.addEventListener("click", handler);
  cancel.addEventListener("click", cancelHandler);
}

// ===== イベント =====
function setupEvents() {
  // お手伝いカード タップ（マイナスは button で、カードは div のため加算とぶつからない）
  $("#choresGrid").addEventListener("click", (e) => {
    const undo = e.target.closest(".undo-btn");
    if (undo) {
      e.preventDefault();
      e.stopPropagation();
      const id = undo.getAttribute("data-undo");
      if (id) undoLastFor(id);
      return;
    }
    const card = e.target.closest(".chore-card");
    if (card && card.dataset.choreId) addRecord(card.dataset.choreId);
  });

  $("#choresGrid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".chore-card");
    if (!card || !card.dataset.choreId) return;
    if (e.target.closest(".undo-btn")) return;
    e.preventDefault();
    addRecord(card.dataset.choreId);
  });

  // ヘッダーのボタン
  $("#historyBtn").addEventListener("click", openHistory);
  $("#settingsBtn").addEventListener("click", openSettings);

  // りれきから せいきゅうしょ
  document.addEventListener("click", (e) => {
    const inv = e.target.closest("[data-open-invoice]");
    if (!inv) return;
    const mk = inv.getAttribute("data-open-invoice");
    if (!mk) return;
    $("#historyModal").hidden = true;
    openInvoiceModal(mk, { isAuto: false });
  });

  // キリよくボタン → 入力欄にセット
  $("#invoiceQuick").addEventListener("click", (e) => {
    const b = e.target.closest(".quick-amt");
    if (!b) return;
    const v = parseInt(b.dataset.amt, 10);
    if (!Number.isNaN(v)) $("#invoicePayInput").value = String(v);
  });

  $("#invoiceReceivedBtn").addEventListener("click", () => {
    const mk = $("#invoiceModal").dataset.targetMonth;
    if (!mk) return;
    const info = getPayoutInfo(mk);
    if (info.total <= 0) {
      $("#invoiceModal").hidden = true;
      return;
    }
    let amt = Math.max(0, Math.round(Number($("#invoicePayInput").value) || 0));
    if (amt <= 0) {
      showToast("きんがくを いれてね");
      return;
    }
    if (amt > info.remaining) amt = info.remaining; // のこり以上は うけとらない
    addPayment(mk, amt);
    const after = getPayoutInfo(mk);
    if (after.settled) {
      showToast(`${formatYen(amt)} もらった！ぜんぶ せいさんできたよ`);
      fillInvoiceModal(mk, { isAuto: false });
    } else {
      showToast(`${formatYen(amt)} もらった！のこり ${formatYen(after.remaining)}`);
      fillInvoiceModal(mk, { isAuto: false });
    }
    renderAll();
  });

  $("#invoiceCarryBtn").addEventListener("click", () => {
    const mk = $("#invoiceModal").dataset.targetMonth;
    if (!mk) return;
    const info = getPayoutInfo(mk);
    if (info.remaining <= 0) return;
    confirmAsk(`のこり ${formatYen(info.remaining)} を ${nextMonthLabel(mk)} に くりこしますか？`, () => {
      const amt = info.remaining;
      carryRemainder(mk);
      showToast(`のこり ${formatYen(amt)} を ${nextMonthLabel(mk)} に くりこしたよ`);
      fillInvoiceModal(mk, { isAuto: false });
      renderAll();
    });
  });

  $("#invoiceWaiveBtn").addEventListener("click", () => {
    const mk = $("#invoiceModal").dataset.targetMonth;
    if (!mk) return;
    const info = getPayoutInfo(mk);
    if (info.remaining <= 0) return;
    confirmAsk(`のこり ${formatYen(info.remaining)} を おまけ（チャラ）にしますか？`, () => {
      const amt = info.remaining;
      waiveRemainder(mk);
      showToast(`のこり ${formatYen(amt)} を おまけにしたよ`);
      fillInvoiceModal(mk, { isAuto: false });
      renderAll();
    });
  });

  $("#invoiceRedoBtn").addEventListener("click", () => {
    const mk = $("#invoiceModal").dataset.targetMonth;
    if (!mk) return;
    confirmAsk("この月の にゅうきんきろくを ぜんぶ けして やりなおしますか？（くりこしも かいじょされます）", () => {
      resetPayout(mk);
      showToast("にゅうきんきろくを やりなおせるよ");
      fillInvoiceModal(mk, { isAuto: false });
      renderAll();
    });
  });

  $("#invoiceLaterBtn").addEventListener("click", () => {
    $("#invoiceModal").hidden = true;
  });

  // モーダル閉じる
  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-close");
      // 設定モーダルを閉じるときは入力内容を反映
      if (id === "settingsModal") applySettingsFromUI();
      $("#" + id).hidden = true;
    });
  });
  // モーダル外側クリックで閉じる
  $$(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m) {
        if (m.id === "settingsModal") applySettingsFromUI();
        m.hidden = true;
      }
    });
  });

  // 設定: 行削除 / 入力反映
  $("#settingsList").addEventListener("click", (e) => {
    const del = e.target.closest("[data-delete]");
    if (del) {
      const id = del.dataset.delete;
      confirmAsk("このこうもくを けしますか？", () => {
        state.chores = state.chores.filter((c) => c.id !== id);
        saveState();
        renderSettingsList();
        renderAll();
      });
    }
  });
  $("#settingsList").addEventListener("input", () => applySettingsFromUI());

  // 設定: 追加
  $("#addChoreBtn").addEventListener("click", () => {
    state.chores.push({
      id: uid(),
      emoji: "✨",
      name: "あたらしい おてつだい",
      priceHoliday: 30,
      priceWeekday: 34,
      showDualPrice: false,
    });
    saveState();
    renderSettingsList();
    renderAll();
  });

  // 設定: 今月をリセット
  $("#resetMonthBtn").addEventListener("click", () => {
    confirmAsk("こんげつの きろくを ぜんぶ けしますか？", () => {
      state.records[nowMonthKey()] = [];
      saveState();
      renderAll();
    });
  });

  // 設定: 全初期化
  $("#resetAllBtn").addEventListener("click", () => {
    confirmAsk("ほんとうに ぜんぶ しょきか しますか？", () => {
      state = {
        chores: DEFAULT_CHORES.map((c) => ({ ...c })),
        records: {},
        choreSchemaVersion: CHORE_SCHEMA_VERSION,
        monthPayouts: {},
      };
      saveState();
      renderSettingsList();
      renderAll();
      $("#settingsModal").hidden = true;
    });
  });

  // 月が変わったら自動更新 (1分ごとにチェック)
  let lastMonth = nowMonthKey();
  setInterval(() => {
    const now = nowMonthKey();
    if (now !== lastMonth) {
      lastMonth = now;
      renderAll();
      queueMicrotask(() => maybeAutoOpenInvoice());
    }
  }, 60 * 1000);

  // 画面に戻ってきたとき (タブ切り替え後など) に再描画
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderAll();
  });
}

// ===== 起動 =====
function startApp() {
  if (startApp._started) return;
  startApp._started = true;
  setupEvents();
  renderAll();
  queueMicrotask(() => maybeAutoOpenInvoice());
}

setupFamilyGate(startApp);
