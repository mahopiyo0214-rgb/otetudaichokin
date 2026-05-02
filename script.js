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
  return computeMonthBreakdown(monthKey).total;
}

function getPayout(monthKey) {
  const p = state.monthPayouts[monthKey];
  if (!p) return { received: false, receivedAt: null, amountSnapshot: null };
  return {
    received: !!p.received,
    receivedAt: p.receivedAt != null ? p.receivedAt : null,
    amountSnapshot: p.amountSnapshot != null ? p.amountSnapshot : null,
  };
}

function setPayoutReceived(monthKey, total) {
  state.monthPayouts[monthKey] = {
    received: true,
    receivedAt: Date.now(),
    amountSnapshot: total,
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
    if (!getPayout(k).received) return k;
  }
  return null;
}

function fillInvoiceModal(monthKey, opts = {}) {
  const { total, detailHtml } = computeMonthBreakdown(monthKey);
  const payout = getPayout(monthKey);
  $("#invoiceModal").dataset.targetMonth = monthKey;
  $("#invoiceMonthLine").textContent = `${formatMonthLabel(monthKey)} せいきゅう`;
  $("#invoiceTotal").textContent = formatYen(total);
  $("#invoiceDetail").innerHTML = detailHtml || "<div>（ないようなし）</div>";
  const lead = $("#invoiceLead");
  if (opts.isAuto) {
    lead.textContent = `${formatMonthLabel(monthKey)}のおてつだいおきゅうりょうが、まだのこっています。おかあさんに、このせいきゅうしょをみせてね。`;
  } else {
    lead.textContent = `${formatMonthLabel(monthKey)}のせいきゅうしょです。`;
  }
  const stamp = $("#invoiceStamp");
  const note = $("#invoiceNote");
  if (payout.received) {
    stamp.innerHTML =
      `<span class="invoice-stamp-paid">にゅうきんずみ</span>` +
      `<span class="invoice-stamp-date">${formatYen(payout.amountSnapshot ?? total)} をきろく（${formatReceivedDate(payout.receivedAt)}）</span>`;
    note.textContent = "このつきのおきゅうりょうは、もらいおわっています。";
  } else {
    stamp.innerHTML = `<span class="invoice-stamp-wait">みにゅうきん（まち）</span>`;
    note.textContent = "おかねをうけとったら「おかねをもらった」をおしてね。";
  }
  $("#invoiceReceivedBtn").hidden = payout.received;
  $("#invoiceLaterBtn").hidden = payout.received;
  $("#invoiceCloseBtn").hidden = !payout.received;
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
      const { total, count, detailHtml } = computeMonthBreakdown(k);
      const payout = getPayout(k);
      let payoutRow = "";
      if (total > 0 || payout.received) {
        if (payout.received) {
          payoutRow = `<div class="history-payout">
            <span class="payout-badge payout-badge-ok">にゅうきんずみ</span>
            <span class="payout-meta">${formatYen(payout.amountSnapshot ?? total)} ・ ${formatReceivedDate(payout.receivedAt)}</span>
            <button type="button" class="btn-invoice-link" data-open-invoice="${k}">せいきゅうしょ</button>
          </div>`;
        } else {
          payoutRow = `<div class="history-payout">
            <span class="payout-badge payout-badge-wait">みにゅうきん（まち）</span>
            <button type="button" class="btn-invoice-link" data-open-invoice="${k}">せいきゅうしょをみる</button>
          </div>`;
        }
      }
      return `
        <div class="history-month">
          <h3>${formatMonthLabel(k)}</h3>
          <div class="history-month-summary">
            <span>ぜんぶで ${count}かい</span>
            <span class="money">${formatYen(total)}</span>
          </div>
          <div class="history-month-detail">${detailHtml}</div>
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

  $("#invoiceReceivedBtn").addEventListener("click", () => {
    const mk = $("#invoiceModal").dataset.targetMonth;
    if (!mk) return;
    const { total } = computeMonthBreakdown(mk);
    if (total <= 0) {
      $("#invoiceModal").hidden = true;
      return;
    }
    setPayoutReceived(mk, total);
    showToast("おかねをもらったことをきろくしたよ！");
    $("#invoiceModal").hidden = true;
    renderAll();
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
setupEvents();
renderAll();
queueMicrotask(() => maybeAutoOpenInvoice());
