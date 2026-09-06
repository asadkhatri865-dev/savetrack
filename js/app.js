(function () {
  "use strict";

  const STORAGE_KEY = "savetrack.v1";
  const AUTH_KEY = "savetrack.auth.v1";
  const SESSION_KEY = "savetrack.session";
  const IDB_NAME = "savetrack.db";
  const IDB_STORE = "records";
  let idb = null;
  const PAGE_SIZE = 25;
  const EXPENSE_CATEGORIES = ["Food", "Transport", "Bills", "Education", "Shopping", "Other"];
  const INVEST_TYPES = ["Stocks", "Mutual Funds", "Gold", "Crypto", "Other"];
  const HALAL_STOCKS = [
    { symbol: "AAPL", name: "Apple", market: "US", sector: "Technology" },
    { symbol: "MSFT", name: "Microsoft", market: "US", sector: "Technology" },
    { symbol: "GOOGL", name: "Alphabet", market: "US", sector: "Technology" },
    { symbol: "NVDA", name: "NVIDIA", market: "US", sector: "Technology" },
    { symbol: "AVGO", name: "Broadcom", market: "US", sector: "Technology" },
    { symbol: "AMD", name: "AMD", market: "US", sector: "Technology" },
    { symbol: "CSCO", name: "Cisco", market: "US", sector: "Technology" },
    { symbol: "ORCL", name: "Oracle", market: "US", sector: "Technology" },
    { symbol: "TSM", name: "TSMC", market: "US", sector: "Technology" },
    { symbol: "AMAT", name: "Applied Materials", market: "US", sector: "Technology" },
    { symbol: "CAT", name: "Caterpillar", market: "US", sector: "Industrials" },
    { symbol: "NVO", name: "Novo Nordisk", market: "US", sector: "Health" },
    { symbol: "LLY", name: "Eli Lilly", market: "US", sector: "Health" },
    { symbol: "ISRG", name: "Intuitive Surgical", market: "US", sector: "Health" },
    { symbol: "COST", name: "Costco", market: "US", sector: "Retail" },
    { symbol: "HD", name: "Home Depot", market: "US", sector: "Retail" },
    { symbol: "MEBL.KA", name: "Meezan Bank", market: "PK", sector: "Banking" },
    { symbol: "SYS.KA", name: "Systems Limited", market: "PK", sector: "Technology" },
    { symbol: "LUCK.KA", name: "Lucky Cement", market: "PK", sector: "Cement" },
    { symbol: "ENGRO.KA", name: "Engro", market: "PK", sector: "Conglomerate" },
    { symbol: "OGDC.KA", name: "OGDC", market: "PK", sector: "Energy" },
    { symbol: "FFC.KA", name: "Fauji Fertilizer", market: "PK", sector: "Fertilizer" },
  ];
  const STOCK_CACHE_KEY = "savetrack.halal.cache.v1";
  const CURRENCY = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    PKR: "Rs",
    INR: "₹",
    CAD: "$",
    AUD: "$",
  };

  const TITLES = {
    dashboard: ["Dashboard", "Overview of the selected period"],
    income: ["Income", "Record money you received"],
    expenses: ["Expenses", "Record spending by category"],
    history: ["History", "Every expense you have recorded"],
    savings: ["Savings goals", "Track progress toward amounts you set"],
    investments: ["Investments", "Holdings you entered — not live prices"],
    stocks: ["Halal stocks", "Daily prices and 1-month charts — delayed market data"],
    transactions: ["Transactions", "All recorded activity"],
    calculators: ["Calculators", "Estimates only — not financial advice"],
    settings: ["Settings", "Preferences for this browser only"],
  };

  const ADD_LABEL = {
    dashboard: "Add",
    income: "Add income",
    expenses: "Add expense",
    history: "Add expense",
    savings: "New goal",
    investments: "Add investment",
    stocks: "Add",
    transactions: "Add",
    calculators: "Add",
    settings: "Add",
  };

  let state = null;
  let currentUser = null;
  let dashPeriod = "month";
  let investView = "cards";
  let stockQuotes = {};
  let stockFetchSeq = 0;
  let stockSelected = "";
  let stockQuery = "";
  let stockLoading = false;
  let txnPage = 1;
  let searchTimers = {};

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function uid(prefix) {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    return prefix + "_" + id.replace(/-/g, "").slice(0, 16);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function defaultState() {
    return {
      version: 1,
      settings: {
        currency: "USD",
        theme: "light",
        notifications: {
          weeklyExpenseReminder: false,
          goalDateReminder: false,
          permissionAsked: false,
        },
      },
      income: [],
      expenses: [],
      savingsGoals: [],
      investments: [],
      transactions: [],
    };
  }

  function dataKey(username) {
    return STORAGE_KEY + ".user." + String(username || "").toLowerCase();
  }

  function userDbKey(username) {
    return "user:" + String(username || "").toLowerCase();
  }

  function openDatabase() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function () {
          idb = req.result;
          resolve(idb);
        };
        req.onerror = function () {
          idb = null;
          resolve(null);
        };
      } catch (e) {
        idb = null;
        resolve(null);
      }
    });
  }

  function dbGet(key) {
    return new Promise(function (resolve) {
      if (!idb) {
        resolve(null);
        return;
      }
      try {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const rq = tx.objectStore(IDB_STORE).get(key);
        rq.onsuccess = function () {
          resolve(rq.result === undefined ? null : rq.result);
        };
        rq.onerror = function () {
          resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function dbSet(key, value) {
    return new Promise(function (resolve) {
      if (!idb) {
        resolve(false);
        return;
      }
      try {
        const tx = idb.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () {
          resolve(true);
        };
        tx.onerror = function () {
          resolve(false);
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function dbDelete(key) {
    return new Promise(function (resolve) {
      if (!idb) {
        resolve(false);
        return;
      }
      try {
        const tx = idb.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function () {
          resolve(true);
        };
        tx.onerror = function () {
          resolve(false);
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function dbKeys() {
    return new Promise(function (resolve) {
      if (!idb) {
        resolve([]);
        return;
      }
      try {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const rq = tx.objectStore(IDB_STORE).getAllKeys();
        rq.onsuccess = function () {
          resolve(rq.result || []);
        };
        rq.onerror = function () {
          resolve([]);
        };
      } catch (e) {
        resolve([]);
      }
    });
  }

  function newerStamp(a, b) {
    return String((a && a.savedAt) || "") >= String((b && b.savedAt) || "");
  }

  function hydrateDatabase() {
    if (!idb) return Promise.resolve();
    return dbGet("auth")
      .then(function (authDb) {
        let authLs = null;
        try {
          const raw = localStorage.getItem(AUTH_KEY);
          authLs = raw ? JSON.parse(raw) : null;
        } catch (e) {
          authLs = null;
        }
        if (authDb && (!authLs || (authDb.users || []).length >= (authLs.users || []).length)) {
          localStorage.setItem(AUTH_KEY, JSON.stringify(authDb));
        } else if (authLs) {
          return dbSet("auth", authLs);
        }
      })
      .then(function () {
        return dbGet("session");
      })
      .then(function (sessDb) {
        let sessLs = "";
        try {
          sessLs = localStorage.getItem(SESSION_KEY) || "";
        } catch (e) {
          sessLs = "";
        }
        if (sessDb && !sessLs) {
          localStorage.setItem(SESSION_KEY, sessDb);
        } else if (!sessDb && sessLs) {
          return dbSet("session", sessLs);
        }
      })
      .then(function () {
        return dbKeys();
      })
      .then(function (keys) {
        let chain = Promise.resolve();
        (keys || []).forEach(function (key) {
          if (String(key).indexOf("user:") !== 0) return;
          chain = chain.then(function () {
            return dbGet(key).then(function (data) {
              if (!data) return;
              const lsKey = STORAGE_KEY + ".user." + String(key).slice(5);
              const existingRaw = localStorage.getItem(lsKey);
              if (!existingRaw) {
                localStorage.setItem(lsKey, JSON.stringify(data));
                return;
              }
              try {
                const parsed = JSON.parse(existingRaw);
                if (newerStamp(data, parsed)) localStorage.setItem(lsKey, JSON.stringify(data));
                else return dbSet(key, parsed);
              } catch (e) {
                localStorage.setItem(lsKey, JSON.stringify(data));
              }
            });
          });
        });
        return chain;
      })
      .then(function () {
        const prefix = STORAGE_KEY + ".user.";
        const pending = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || k.indexOf(prefix) !== 0) continue;
            pending.push(k);
          }
        } catch (e) {
          return;
        }
        let chain = Promise.resolve();
        pending.forEach(function (k) {
          chain = chain.then(function () {
            const uname = k.slice(prefix.length);
            return dbGet(userDbKey(uname)).then(function (exists) {
              if (exists) return;
              try {
                return dbSet(userDbKey(uname), JSON.parse(localStorage.getItem(k)));
              } catch (err) {
                return;
              }
            });
          });
        });
        return chain;
      })
      .catch(function () {
        return;
      });
  }

  function loadAuth() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return { users: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.users)) return { users: [] };
      return parsed;
    } catch (e) {
      return { users: [] };
    }
  }

  function saveAuth(auth) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    dbSet("auth", auth);
  }

  function bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function hexToBuf(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  async function hashPassword(password, saltHex) {
    const enc = new TextEncoder();
    const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return { salt: bufToHex(salt), hash: bufToHex(bits) };
  }

  function migrateLegacyIfNeeded(username) {
    const userKey = dataKey(username);
    if (localStorage.getItem(userKey)) return;
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(userKey, legacy);
    localStorage.removeItem(STORAGE_KEY);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(dataKey(currentUser));
      if (!raw) {
        state = defaultState();
        saveState();
        return;
      }
      const parsed = JSON.parse(raw);
      state = Object.assign(defaultState(), parsed);
      state.settings = Object.assign(defaultState().settings, parsed.settings || {});
      state.settings.notifications = Object.assign(
        defaultState().settings.notifications,
        (parsed.settings && parsed.settings.notifications) || {}
      );
      ["income", "expenses", "savingsGoals", "investments", "transactions"].forEach(function (k) {
        if (!Array.isArray(state[k])) state[k] = [];
      });
      if (state.settings.theme === "system") {
        state.settings.theme = "light";
        saveState();
      }
    } catch (err) {
      state = defaultState();
      showBannerParseError();
    }
  }

  let parseFailed = false;
  function showBannerParseError() {
    parseFailed = true;
  }

  function saveState() {
    if (parseFailed || !currentUser) return;
    try {
      state.savedAt = nowIso();
      localStorage.setItem(dataKey(currentUser), JSON.stringify(state));
      dbSet(userDbKey(currentUser), state);
    } catch (err) {
      toast("Could not save. Browser storage may be full.", "err");
    }
  }

  function money(n) {
    const sign = n < 0 ? "−" : "";
    const abs = Math.abs(Number(n) || 0);
    const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sign + symbol() + formatted;
  }

  function symbol() {
    return CURRENCY[state.settings.currency] || "$";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const p = iso.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = Number(p[1]) - 1;
    return p[2] + " " + (months[mi] || "") + " " + p[0];
  }

  function pct(n) {
    if (!isFinite(n)) return "—";
    return (Math.round(n * 10) / 10).toFixed(1) + "%";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg, kind) {
    const el = document.createElement("div");
    el.className = "toast " + (kind === "err" ? "err" : "ok");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4000);
  }

  function applyTheme() {
    const pref = (state && state.settings && state.settings.theme) || "light";
    const dark = pref === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    $$("[data-theme-set]").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-theme-set") === pref);
    });
  }

  function syncCurrencyPrefixes() {
    $$("[data-currency-prefix]").forEach(function (el) {
      el.textContent = symbol();
    });
    const sel = $("#setting-currency");
    if (sel) sel.value = state.settings.currency;
  }

  function currentRoute() {
    const h = (location.hash || "#dashboard").replace("#", "");
    return TITLES[h] ? h : "dashboard";
  }

  function navigate(route) {
    if (!currentUser || !state) return;
    if (!TITLES[route]) route = "dashboard";
    $$(".page").forEach(function (p) {
      const on = p.getAttribute("data-page") === route;
      p.hidden = !on;
      p.setAttribute("aria-hidden", on ? "false" : "true");
    });
    $$(".nav-item").forEach(function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-route") === route);
    });
    $("#page-title").textContent = TITLES[route][0];
    $("#page-sub").textContent = TITLES[route][1];
    const add = $("#header-add");
    add.textContent = ADD_LABEL[route] || "Add";
    const hideAdd = route === "settings" || route === "calculators" || route === "stocks";
    add.hidden = hideAdd;
    closeMenu();
    closeSidebar();
    if (route !== "transactions") txnPage = 1;
    render();
  }

  function openSidebar() {
    $("#sidebar").classList.add("is-open");
    $("#overlay").hidden = false;
    $("#hamburger").setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-lock");
  }

  function closeSidebar() {
    $("#sidebar").classList.remove("is-open");
    $("#overlay").hidden = true;
    $("#hamburger").setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-lock");
  }

  function closeMenu() {
    $("#add-menu").hidden = true;
  }

  /* ---------- period helpers ---------- */
  function inPeriod(dateStr, period) {
    const d = new Date(dateStr + "T00:00:00");
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (period === "month") return d.getFullYear() === y && d.getMonth() === m;
    if (period === "year") return d.getFullYear() === y;
    const start = new Date(y, m - 2, 1);
    return d >= start && d <= now;
  }

  function monthKeys(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
        label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()],
      });
    }
    return out;
  }

  function sum(arr, pred) {
    return arr.reduce(function (acc, item) {
      return acc + (pred(item) ? Number(item.amount) || 0 : 0);
    }, 0);
  }

  function metrics(period) {
    const inc = sum(state.income, function (x) {
      return inPeriod(x.date, period);
    });
    const exp = sum(state.expenses, function (x) {
      return inPeriod(x.date, period);
    });
    const totalSavings = state.savingsGoals.reduce(function (a, g) {
      return a + (Number(g.currentAmount) || 0);
    }, 0);
    const totalInvested = state.investments.reduce(function (a, i) {
      return a + (Number(i.investedAmount) || 0);
    }, 0);
    const totalInvestValue = state.investments.reduce(function (a, i) {
      return a + (Number(i.currentValue) || 0);
    }, 0);
    const allInc = state.income.reduce(function (a, x) {
      return a + (Number(x.amount) || 0);
    }, 0);
    const allExp = state.expenses.reduce(function (a, x) {
      return a + (Number(x.amount) || 0);
    }, 0);
    const unallocated = allInc - allExp - totalSavings - totalInvested;
    const balance = totalSavings + totalInvestValue + unallocated;
    let rate = null;
    if (inc > 0) rate = ((inc - exp) / inc) * 100;
    return {
      inc: inc,
      exp: exp,
      totalSavings: totalSavings,
      totalInvested: totalInvested,
      totalInvestValue: totalInvestValue,
      pl: totalInvestValue - totalInvested,
      unallocated: unallocated,
      balance: balance,
      rate: rate,
    };
  }

  /* ---------- CRUD ---------- */
  function validAmount(v, min) {
    const n = Number(v);
    if (!isFinite(n) || n < min) return null;
    return Math.round(n * 100) / 100;
  }

  function validQty(v) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return null;
    return Math.round(n * 1e6) / 1e6;
  }

  function holdingPL(i) {
    const invested = Number(i && i.investedAmount) || 0;
    const current = Number(i && i.currentValue) || 0;
    const d = current - invested;
    const pc = invested > 0 ? (d / invested) * 100 : 0;
    return { invested: invested, current: current, d: d, pc: pc };
  }

  function isShareHolding(i) {
    return !!(i && i.entryType === "shares" && Number(i.shares) > 0);
  }

  function plLabel(d) {
    if (d > 0) return "profit " + money(d);
    if (d < 0) return "loss " + money(d);
    return money(d);
  }

  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const t = tomorrowStr();
    return s <= t;
  }

  function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function addIncome(data) {
    const rec = {
      id: uid("inc"),
      amount: data.amount,
      source: data.source.trim(),
      date: data.date,
      note: (data.note || "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.income.push(rec);
    state.transactions.push({
      id: uid("txn"),
      date: rec.date,
      type: "Income",
      category: rec.source,
      description: rec.note || rec.source,
      amount: rec.amount,
      linkedId: rec.id,
      linkedKind: "income",
    });
    saveState();
    return rec;
  }

  function addExpense(data) {
    const rec = {
      id: uid("exp"),
      amount: data.amount,
      category: data.category,
      date: data.date,
      note: (data.note || "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.expenses.push(rec);
    state.transactions.push({
      id: uid("txn"),
      date: rec.date,
      type: "Expense",
      category: rec.category,
      description: rec.note || rec.category,
      amount: rec.amount,
      linkedId: rec.id,
      linkedKind: "expense",
    });
    saveState();
    return rec;
  }

  function addGoal(data) {
    const rec = {
      id: uid("goal"),
      name: data.name.trim(),
      targetAmount: data.targetAmount,
      currentAmount: data.currentAmount,
      targetDate: data.targetDate,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.savingsGoals.push(rec);
    if (rec.currentAmount > 0) {
      state.transactions.push({
        id: uid("txn"),
        date: todayStr(),
        type: "Savings",
        category: rec.name,
        description: "Opening amount for " + rec.name,
        amount: rec.currentAmount,
        linkedId: rec.id,
        linkedKind: "goal",
      });
    }
    saveState();
    return rec;
  }

  function addToGoal(goalId, amount) {
    const g = state.savingsGoals.find(function (x) {
      return x.id === goalId;
    });
    if (!g) return;
    g.currentAmount = Math.round((Number(g.currentAmount) + amount) * 100) / 100;
    g.updatedAt = nowIso();
    state.transactions.push({
      id: uid("txn"),
      date: todayStr(),
      type: "Savings",
      category: g.name,
      description: "Added to " + g.name,
      amount: amount,
      linkedId: g.id,
      linkedKind: "goal",
    });
    saveState();
  }

  function addInvestment(data) {
    const rec = {
      id: uid("inv"),
      name: data.name.trim(),
      type: data.type,
      entryType: data.entryType === "shares" ? "shares" : "amount",
      shares: data.entryType === "shares" ? data.shares : null,
      buyPrice: data.entryType === "shares" ? data.buyPrice : null,
      currentPrice: data.entryType === "shares" ? data.currentPrice : null,
      investedAmount: data.investedAmount,
      currentValue: data.currentValue,
      date: data.date,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.investments.push(rec);
    state.transactions.push({
      id: uid("txn"),
      date: rec.date,
      type: "Investment",
      category: rec.type,
      description: rec.name,
      amount: rec.investedAmount,
      linkedId: rec.id,
      linkedKind: "investment",
    });
    saveState();
    return rec;
  }

  function updateLinkedTxn(kind, rec) {
    state.transactions.forEach(function (t) {
      if (t.linkedId !== rec.id || t.linkedKind !== kind) return;
      if (kind === "income") {
        t.date = rec.date;
        t.category = rec.source;
        t.description = rec.note || rec.source;
        t.amount = rec.amount;
      } else if (kind === "expense") {
        t.date = rec.date;
        t.category = rec.category;
        t.description = rec.note || rec.category;
        t.amount = rec.amount;
      } else if (kind === "investment") {
        t.date = rec.date;
        t.category = rec.type;
        t.description = rec.name;
        t.amount = rec.investedAmount;
      } else if (kind === "goal") {
        t.category = rec.name;
      }
    });
  }

  function deleteByTransaction(txnId) {
    const t = state.transactions.find(function (x) {
      return x.id === txnId;
    });
    if (!t) return;
    if (t.linkedKind === "income") {
      state.income = state.income.filter(function (x) {
        return x.id !== t.linkedId;
      });
      state.transactions = state.transactions.filter(function (x) {
        return x.linkedId !== t.linkedId || x.linkedKind !== "income";
      });
    } else if (t.linkedKind === "expense") {
      state.expenses = state.expenses.filter(function (x) {
        return x.id !== t.linkedId;
      });
      state.transactions = state.transactions.filter(function (x) {
        return x.linkedId !== t.linkedId || x.linkedKind !== "expense";
      });
    } else if (t.linkedKind === "investment") {
      state.investments = state.investments.filter(function (x) {
        return x.id !== t.linkedId;
      });
      state.transactions = state.transactions.filter(function (x) {
        return x.linkedId !== t.linkedId || x.linkedKind !== "investment";
      });
    } else if (t.linkedKind === "goal") {
      const g = state.savingsGoals.find(function (x) {
        return x.id === t.linkedId;
      });
      if (g) {
        g.currentAmount = Math.max(0, Math.round((g.currentAmount - t.amount) * 100) / 100);
        g.updatedAt = nowIso();
      }
      state.transactions = state.transactions.filter(function (x) {
        return x.id !== t.id;
      });
    }
    saveState();
  }

  function deleteGoal(id) {
    state.savingsGoals = state.savingsGoals.filter(function (g) {
      return g.id !== id;
    });
    state.transactions = state.transactions.filter(function (t) {
      return !(t.linkedKind === "goal" && t.linkedId === id);
    });
    saveState();
  }

  function deleteInvestment(id) {
    state.investments = state.investments.filter(function (i) {
      return i.id !== id;
    });
    state.transactions = state.transactions.filter(function (t) {
      return !(t.linkedKind === "investment" && t.linkedId === id);
    });
    saveState();
  }

  function deleteIncome(id) {
    state.income = state.income.filter(function (x) {
      return x.id !== id;
    });
    state.transactions = state.transactions.filter(function (t) {
      return !(t.linkedKind === "income" && t.linkedId === id);
    });
    saveState();
  }

  function deleteExpense(id) {
    state.expenses = state.expenses.filter(function (x) {
      return x.id !== id;
    });
    state.transactions = state.transactions.filter(function (t) {
      return !(t.linkedKind === "expense" && t.linkedId === id);
    });
    saveState();
  }

  /* ---------- UI pieces ---------- */
  function emptyHtml(title, body, cta, href) {
    return (
      '<div class="empty"><div class="icon-well"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/></svg></div><h3>' +
      escapeHtml(title) +
      "</h3><p>" +
      escapeHtml(body) +
      "</p>" +
      (cta ? '<a class="btn btn-primary" href="' + href + '">' + escapeHtml(cta) + "</a>" : "") +
      "</div>"
    );
  }

  function actionsMenu(kind, id) {
    return (
      '<div class="kebab"><button type="button" class="icon-btn" data-menu="' +
      kind +
      ":" +
      id +
      '" aria-label="Actions">⋯</button></div>'
    );
  }

  function tableAndCards(columns, rows, cardsHtml) {
    if (!rows.length) return "";
    let thead = "<tr>" + columns.map(function (c) {
      return "<th>" + c + "</th>";
    }).join("") + "</tr>";
    return (
      '<div class="table-wrap"><table class="data"><thead>' +
      thead +
      "</thead><tbody>" +
      rows.join("") +
      '</tbody></table></div><div class="row-cards">' +
      cardsHtml +
      "</div>"
    );
  }

  /* ---------- render pages ---------- */
  function renderDashboard() {
    const m = metrics(dashPeriod);
    let rateClass = "muted";
    let rateText = "—";
    if (m.rate !== null) {
      rateText = pct(m.rate);
      if (m.rate >= 20) rateClass = "teal";
      else if (m.rate >= 0) rateClass = "warn";
      else rateClass = "bad";
    }
    const balClass = m.balance < 0 ? "bad" : "navy";
    $("#dash-stats").innerHTML = [
      statCard("Total balance", money(m.balance), balClass, m.unallocated < 0 ? "Spending exceeds recorded income." : "Savings + investments + unallocated cash."),
      statCard("Total savings", money(m.totalSavings), "teal", "Sum of money assigned to goals."),
      statCard("Total investments", money(m.totalInvestValue), "navy", "Current value (you entered)"),
      statCard("Monthly income", money(m.inc), "good", "Income in this period"),
      statCard("Monthly expenses", money(m.exp), "bad", "Expenses in this period"),
      statCard("Savings rate", rateText, rateClass, "Share of income not spent this period. Add income to calculate if shown as —."),
    ].join("");

    renderIncomeExpenseChart();
    renderMoneyFlowChart();
    renderSavingsChart();
    renderDashInvest(m);
    renderDashGoals();
    renderDashRecent();
  }

  function statCard(label, value, cls, hint) {
    return (
      '<article class="stat-card"><div class="stat-label">' +
      escapeHtml(label) +
      '</div><div class="stat-value ' +
      cls +
      '">' +
      escapeHtml(value) +
      '</div><div class="stat-hint">' +
      escapeHtml(hint) +
      "</div></article>"
    );
  }

  function renderIncomeExpenseChart() {
    const months = monthKeys(6);
    const data = months.map(function (mo) {
      const inc = state.income.reduce(function (a, x) {
        return a + (x.date.slice(0, 7) === mo.key ? x.amount : 0);
      }, 0);
      const exp = state.expenses.reduce(function (a, x) {
        return a + (x.date.slice(0, 7) === mo.key ? x.amount : 0);
      }, 0);
      return { label: mo.label, inc: inc, exp: exp };
    });
    const max = Math.max.apply(
      null,
      data.map(function (d) {
        return Math.max(d.inc, d.exp, 1);
      })
    );
    const has = data.some(function (d) {
      return d.inc || d.exp;
    });
    const host = $("#chart-income-expense");
    if (!has) {
      host.innerHTML = emptyHtml("No chart yet", "Add income and expenses to see this chart.", "Add income", "#income");
      return;
    }
    host.innerHTML =
      '<div class="legend"><span><i style="background:var(--chart-income)"></i>Income</span><span><i style="background:var(--chart-expense)"></i>Expenses</span></div><div class="bars">' +
      data
        .map(function (d) {
          const hi = Math.max(8, (d.inc / max) * 150);
          const he = Math.max(8, (d.exp / max) * 150);
          return (
            '<div class="bar-col"><div class="bar-pair"><div class="bar income" style="height:' +
            (d.inc ? hi : 2) +
            'px" title="Income ' +
            money(d.inc) +
            '"></div><div class="bar expense" style="height:' +
            (d.exp ? he : 2) +
            'px" title="Expenses ' +
            money(d.exp) +
            '"></div></div><label>' +
            d.label +
            "</label></div>"
          );
        })
        .join("") +
      '</div><p class="chart-summary">' +
      data
        .map(function (d) {
          return d.label + ": income " + money(d.inc) + ", expenses " + money(d.exp);
        })
        .join(" · ") +
      "</p>";
  }

  function monthFlow(key) {
    const used = state.expenses.reduce(function (a, x) {
      return a + (x.date.slice(0, 7) === key ? x.amount : 0);
    }, 0);
    const saved = state.transactions.reduce(function (a, x) {
      return a + (x.type === "Savings" && x.date.slice(0, 7) === key ? x.amount : 0);
    }, 0);
    const invested = state.transactions.reduce(function (a, x) {
      return a + (x.type === "Investment" && x.date.slice(0, 7) === key ? x.amount : 0);
    }, 0);
    return { used: used, saved: saved, invested: invested };
  }

  function renderMoneyFlowChart() {
    const host = $("#chart-money-flow");
    const months = monthKeys(12);
    const data = months.map(function (mo) {
      const f = monthFlow(mo.key);
      return { label: mo.label, key: mo.key, used: f.used, saved: f.saved, invested: f.invested };
    });
    const has = data.some(function (d) {
      return d.used || d.saved || d.invested;
    });
    const thisMonth = monthFlow(todayStr().slice(0, 7));
    const totals =
      '<div class="flow-totals">' +
      '<div><span>Used this month</span><strong class="amount-neg">' +
      money(thisMonth.used) +
      "</strong></div>" +
      '<div><span>Saved this month</span><strong class="amount-pos">' +
      money(thisMonth.saved) +
      "</strong></div>" +
      "<div><span>Invested this month</span><strong>" +
      money(thisMonth.invested) +
      "</strong></div></div>";
    if (!has) {
      host.innerHTML =
        totals + emptyHtml("No monthly activity yet", "Add expenses, savings, or investments to fill this chart.", "Add expense", "#expenses");
      return;
    }
    const max = Math.max.apply(
      null,
      data.map(function (d) {
        return Math.max(d.used, d.saved, d.invested, 1);
      })
    );
    host.innerHTML =
      totals +
      '<div class="legend"><span><i style="background:var(--chart-expense)"></i>Used</span><span><i style="background:var(--chart-save)"></i>Saved</span><span><i style="background:var(--chart-invest)"></i>Invested</span></div><div class="bars triple">' +
      data
        .map(function (d) {
          function h(v) {
            return v ? Math.max(8, (v / max) * 170) : 2;
          }
          return (
            '<div class="bar-col"><div class="bar-pair">' +
            '<div class="bar used" style="height:' +
            h(d.used) +
            'px" title="Used ' +
            money(d.used) +
            '"></div>' +
            '<div class="bar save" style="height:' +
            h(d.saved) +
            'px" title="Saved ' +
            money(d.saved) +
            '"></div>' +
            '<div class="bar invested" style="height:' +
            h(d.invested) +
            'px" title="Invested ' +
            money(d.invested) +
            '"></div></div><label>' +
            d.label +
            "</label></div>"
          );
        })
        .join("") +
      '</div><p class="chart-summary">' +
      data
        .filter(function (d) {
          return d.used || d.saved || d.invested;
        })
        .map(function (d) {
          return d.label + ": used " + money(d.used) + ", saved " + money(d.saved) + ", invested " + money(d.invested);
        })
        .join(" · ") +
      "</p>";
  }

  function renderSavingsChart() {
    const host = $("#chart-savings");
    const goals = state.savingsGoals;
    if (goals.length) {
      host.innerHTML =
        '<div class="hbars">' +
        goals
          .map(function (g) {
            const p = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
            return (
              '<div class="hbar-row"><span>' +
              escapeHtml(g.name) +
              "<strong>" +
              Math.round(p) +
              "%</strong></span><div class=\"progress\"><i class=\"" +
              (p >= 100 ? "done" : "") +
              '" style="width:' +
              p +
              '%"></i></div></div>'
            );
          })
          .join("") +
        "</div>";
      return;
    }
    const m = metrics(dashPeriod);
    const spent = m.exp;
    const unspent = Math.max(0, m.inc - m.exp);
    const total = spent + unspent;
    if (!m.inc && !m.exp) {
      host.innerHTML = emptyHtml("No savings data", "Add income and expenses, or create a goal.", "New goal", "#savings");
      return;
    }
    const pu = total ? (unspent / total) * 100 : 0;
    host.innerHTML =
      "<p>Unspent vs spent (this period)</p>" +
      '<div class="hbar-row"><span>Unspent<strong>' +
      money(unspent) +
      "</strong></span><div class=\"progress\"><i style=\"width:" +
      pu +
      '%"></i></div></div>' +
      '<p class="chart-summary">Spent ' +
      money(spent) +
      " of " +
      money(m.inc || spent) +
      " recorded income this period.</p>";
  }

  function renderDashInvest(m) {
    const host = $("#dash-invest");
    if (!state.investments.length) {
      host.innerHTML = emptyHtml("No holdings", "Add holdings you already own to track them.", "Add investment", "#investments");
      return;
    }
    const chg = m.totalInvested > 0 ? (m.pl / m.totalInvested) * 100 : null;
    const cls = m.pl > 0 ? "good" : m.pl < 0 ? "bad" : "";
    host.innerHTML =
      '<div class="meta-grid"><div><span>Total invested</span><strong>' +
      money(m.totalInvested) +
      "</strong></div><div><span>Current value</span><strong>" +
      money(m.totalInvestValue) +
      '</strong></div><div><span>Profit / loss</span><strong class="' +
      (m.pl > 0 ? "amount-pos" : m.pl < 0 ? "amount-neg" : "") +
      '">' +
      (m.pl > 0 ? "profit " : m.pl < 0 ? "loss " : "") +
      money(m.pl) +
      "</strong></div><div><span>Change</span><strong class=\"" +
      cls +
      '">' +
      (chg === null ? "—" : (m.pl >= 0 ? "+" : "") + pct(chg)) +
      "</strong></div></div>";
  }

  function renderDashGoals() {
    const host = $("#dash-goals");
    const list = state.savingsGoals
      .slice()
      .sort(function (a, b) {
        const pa = a.targetAmount ? a.currentAmount / a.targetAmount : 0;
        const pb = b.targetAmount ? b.currentAmount / b.targetAmount : 0;
        if (pa < 1 && pb >= 1) return -1;
        if (pb < 1 && pa >= 1) return 1;
        return a.targetDate.localeCompare(b.targetDate);
      })
      .slice(0, 3);
    if (!list.length) {
      host.innerHTML = emptyHtml("No goals yet", "Set a savings goal to track progress. This is a tracker, not a recommendation.", "New goal", "#savings");
      return;
    }
    host.innerHTML = list
      .map(function (g) {
        const p = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
        return (
          '<div class="hbar-row" style="margin-bottom:12px"><span>' +
          escapeHtml(g.name) +
          "<strong>" +
          money(g.currentAmount) +
          " / " +
          money(g.targetAmount) +
          "</strong></span><div class=\"progress\"><i style=\"width:" +
          p +
          '%"></i></div></div>'
        );
      })
      .join("");
  }

  function renderDashRecent() {
    const list = state.transactions.slice().sort(cmpDateDesc).slice(0, 8);
    $("#dash-recent").innerHTML = renderTxnCollection(list, false);
  }

  function cmpDateDesc(a, b) {
    return b.date.localeCompare(a.date) || (b.id < a.id ? 1 : -1);
  }

  function renderTxnCollection(list, withActions) {
    if (!list.length) {
      return emptyHtml("No transactions yet", "Add income to start your ledger.", "Add income", "#income");
    }
    const rows = list.map(function (t) {
      const signed =
        t.type === "Income" || t.type === "Savings"
          ? '<span class="amount-pos">+' + money(t.amount) + "</span>"
          : t.type === "Expense"
          ? '<span class="amount-neg">−' + money(t.amount) + "</span>"
          : money(t.amount);
      return (
        "<tr><td>" +
        fmtDate(t.date) +
        "</td><td>" +
        escapeHtml(t.type) +
        "</td><td>" +
        escapeHtml(t.category) +
        "</td><td>" +
        escapeHtml(t.description) +
        '</td><td class="num">' +
        signed +
        "</td>" +
        (withActions ? "<td>" + txnActions(t.id) + "</td>" : "") +
        "</tr>"
      );
    });
    const cards = list
      .map(function (t) {
        const signed =
          t.type === "Expense" ? '<span class="amount-neg">−' + money(t.amount) + "</span>" : '<span class="amount-pos">+' + money(t.amount) + "</span>";
        const amt = t.type === "Investment" ? money(t.amount) : signed;
        return (
          '<div class="row-card"><div class="rc-top"><span class="badge">' +
          escapeHtml(t.type) +
          "</span><strong>" +
          amt +
          '</strong></div><div class="rc-mid">' +
          escapeHtml(t.description) +
          '</div><div class="rc-bot"><span>' +
          fmtDate(t.date) +
          "</span><span>" +
          escapeHtml(t.category) +
          "</span>" +
          (withActions ? txnActions(t.id) : "") +
          "</div></div>"
        );
      })
      .join("");
    const cols = withActions
      ? ["DATE", "TYPE", "CATEGORY", "DESCRIPTION", "AMOUNT", ""]
      : ["DATE", "TYPE", "CATEGORY", "DESCRIPTION", "AMOUNT"];
    return tableAndCards(cols, rows, cards);
  }

  function txnActions(id) {
    return (
      '<button type="button" class="icon-btn" data-edit-txn="' +
      id +
      '" aria-label="Edit">✎</button>' +
      '<button type="button" class="icon-btn" data-del-txn="' +
      id +
      '" aria-label="Delete">✕</button>'
    );
  }

  function filterBySearchDate(items, q, from, to, textFn) {
    q = (q || "").trim().toLowerCase();
    return items.filter(function (x) {
      if (from && x.date < from) return false;
      if (to && x.date > to) return false;
      if (q && textFn(x).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function renderIncomePage() {
    const q = $("#income-search").value;
    const from = $("#income-from").value;
    const to = $("#income-to").value;
    const items = filterBySearchDate(state.income.slice().sort(cmpDateDesc), q, from, to, function (x) {
      return x.source + " " + (x.note || "");
    });
    const dl = $("#income-sources");
    const sources = [];
    state.income.forEach(function (x) {
      if (sources.indexOf(x.source) === -1) sources.push(x.source);
    });
    dl.innerHTML = sources
      .map(function (s) {
        return "<option value=\"" + escapeHtml(s) + "\">";
      })
      .join("");
    if (!state.income.length) {
      $("#income-list").innerHTML = emptyHtml("No income recorded yet", "Add your first income record using the form.", "", "#");
      return;
    }
    if (!items.length) {
      $("#income-list").innerHTML = emptyHtml("No income matches", "Clear search or date filters.", "", "#");
      return;
    }
    const total = items.reduce(function (a, x) {
      return a + x.amount;
    }, 0);
    const rows = items.map(function (x) {
      return (
        "<tr><td>" +
        fmtDate(x.date) +
        "</td><td>" +
        escapeHtml(x.source) +
        "</td><td>" +
        escapeHtml(x.note || "—") +
        '</td><td class="num amount-pos">' +
        money(x.amount) +
        "</td><td>" +
        '<button type="button" class="icon-btn" data-edit-income="' +
        x.id +
        '" aria-label="Edit">✎</button>' +
        '<button type="button" class="icon-btn" data-del-income="' +
        x.id +
        '" aria-label="Delete">✕</button></td></tr>'
      );
    });
    const cards = items
      .map(function (x) {
        return (
          '<div class="row-card"><div class="rc-top"><strong>' +
          escapeHtml(x.source) +
          '</strong><span class="amount-pos">' +
          money(x.amount) +
          '</span></div><div class="rc-mid">' +
          escapeHtml(x.note || "No note") +
          '</div><div class="rc-bot"><span>' +
          fmtDate(x.date) +
          '</span><span><button type="button" class="icon-btn" data-edit-income="' +
          x.id +
          '">✎</button><button type="button" class="icon-btn" data-del-income="' +
          x.id +
          '">✕</button></span></div></div>'
        );
      })
      .join("");
    $("#income-list").innerHTML =
      tableAndCards(["DATE", "SOURCE", "NOTE", "AMOUNT", ""], rows, cards) +
      '<div class="table-foot">Total this view: ' +
      money(total) +
      "</div>";
  }

  function renderExpensePage() {
    const q = $("#expense-search").value;
    const cat = $("#expense-category").value;
    const from = $("#expense-from").value;
    const to = $("#expense-to").value;
    $("#expense-chips").innerHTML =
      '<button type="button" class="chip' +
      (cat === "" ? " is-on" : "") +
      '" data-chip="">All</button>' +
      EXPENSE_CATEGORIES.map(function (c) {
        return (
          '<button type="button" class="chip' +
          (cat === c ? " is-on" : "") +
          '" data-chip="' +
          c +
          '">' +
          c +
          "</button>"
        );
      }).join("");
    let items = filterBySearchDate(state.expenses.slice().sort(cmpDateDesc), q, from, to, function (x) {
      return x.category + " " + (x.note || "");
    });
    if (cat) {
      items = items.filter(function (x) {
        return x.category === cat;
      });
    }
    if (!state.expenses.length) {
      $("#expense-list").innerHTML = emptyHtml("No expenses yet", "Add your first expense using the form.", "", "#");
      return;
    }
    if (!items.length) {
      $("#expense-list").innerHTML = emptyHtml("No expenses match", "Clear filters to see all expenses.", "", "#");
      return;
    }
    const total = items.reduce(function (a, x) {
      return a + x.amount;
    }, 0);
    const rows = items.map(function (x) {
      const slug = x.category.toLowerCase();
      return (
        "<tr><td>" +
        fmtDate(x.date) +
        '</td><td><span class="badge"><i class="dot dot-' +
        slug +
        '"></i>' +
        escapeHtml(x.category) +
        "</span></td><td>" +
        escapeHtml(x.note || "—") +
        '</td><td class="num amount-neg">' +
        money(x.amount) +
        "</td><td>" +
        '<button type="button" class="icon-btn" data-edit-expense="' +
        x.id +
        '" aria-label="Edit">✎</button>' +
        '<button type="button" class="icon-btn" data-del-expense="' +
        x.id +
        '" aria-label="Delete">✕</button></td></tr>'
      );
    });
    const cards = items
      .map(function (x) {
        return (
          '<div class="row-card"><div class="rc-top"><span class="badge">' +
          escapeHtml(x.category) +
          '</span><span class="amount-neg">' +
          money(x.amount) +
          '</span></div><div class="rc-mid">' +
          escapeHtml(x.note || "No note") +
          '</div><div class="rc-bot"><span>' +
          fmtDate(x.date) +
          '</span><span><button type="button" class="icon-btn" data-edit-expense="' +
          x.id +
          '">✎</button><button type="button" class="icon-btn" data-del-expense="' +
          x.id +
          '">✕</button></span></div></div>'
        );
      })
      .join("");
    $("#expense-list").innerHTML =
      tableAndCards(["DATE", "CATEGORY", "NOTE", "AMOUNT", ""], rows, cards) +
      '<div class="table-foot">Total this view: ' +
      money(total) +
      "</div>";
  }

  function renderHistoryPage() {
    const q = $("#history-search").value;
    const cat = $("#history-category").value;
    const from = $("#history-from").value;
    const to = $("#history-to").value;
    let items = filterBySearchDate(state.expenses.slice().sort(cmpDateDesc), q, from, to, function (x) {
      return x.category + " " + (x.note || "");
    });
    if (cat) {
      items = items.filter(function (x) {
        return x.category === cat;
      });
    }
    const host = $("#history-list");
    if (!state.expenses.length) {
      host.innerHTML = emptyHtml("No expense history yet", "Add an expense to start your history.", "Add expense", "#expenses");
      return;
    }
    if (!items.length) {
      host.innerHTML = emptyHtml("No expenses match", "Clear filters to see your full history.", "", "#");
      return;
    }
    const groups = [];
    items.forEach(function (x) {
      const key = x.date.slice(0, 7);
      let g = groups.find(function (n) {
        return n.key === key;
      });
      if (!g) {
        g = { key: key, items: [] };
        groups.push(g);
      }
      g.items.push(x);
    });
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    host.innerHTML = groups
      .map(function (g) {
        const parts = g.key.split("-");
        const title = monthNames[Number(parts[1]) - 1] + " " + parts[0];
        const sum = g.items.reduce(function (a, x) {
          return a + x.amount;
        }, 0);
        const rows = g.items.map(function (x) {
          return (
            "<tr><td>" +
            fmtDate(x.date) +
            '</td><td><span class="badge"><i class="dot dot-' +
            x.category.toLowerCase() +
            '"></i>' +
            escapeHtml(x.category) +
            "</span></td><td>" +
            escapeHtml(x.note || "—") +
            '</td><td class="num amount-neg">' +
            money(x.amount) +
            "</td><td>" +
            '<button type="button" class="icon-btn" data-edit-expense="' +
            x.id +
            '" aria-label="Edit">✎</button>' +
            '<button type="button" class="icon-btn" data-del-expense="' +
            x.id +
            '" aria-label="Delete">✕</button></td></tr>'
          );
        });
        const cards = g.items
          .map(function (x) {
            return (
              '<div class="row-card"><div class="rc-top"><span class="badge">' +
              escapeHtml(x.category) +
              '</span><span class="amount-neg">' +
              money(x.amount) +
              '</span></div><div class="rc-mid">' +
              escapeHtml(x.note || "No note") +
              '</div><div class="rc-bot"><span>' +
              fmtDate(x.date) +
              '</span><span><button type="button" class="icon-btn" data-edit-expense="' +
              x.id +
              '">✎</button><button type="button" class="icon-btn" data-del-expense="' +
              x.id +
              '">✕</button></span></div></div>'
            );
          })
          .join("");
        return (
          '<div class="month-group"><h3>' +
          escapeHtml(title) +
          " · used " +
          money(sum) +
          "</h3>" +
          tableAndCards(["DATE", "CATEGORY", "NOTE", "AMOUNT", ""], rows, cards) +
          "</div>"
        );
      })
      .join("");
  }

  function goalProgress(g) {
    if (!g.targetAmount) return 0;
    return Math.round((g.currentAmount / g.targetAmount) * 1000) / 10;
  }

  function renderSavingsPage() {
    const total = state.savingsGoals.reduce(function (a, g) {
      return a + g.currentAmount;
    }, 0);
    $("#savings-stats").innerHTML =
      statCard("Total saved toward goals", money(total), "teal", "Sum of current amounts") +
      statCard("Active goals", String(state.savingsGoals.length), "navy", "Goals you created");
    const host = $("#goals-grid");
    if (!state.savingsGoals.length) {
      host.innerHTML = emptyHtml(
        "No goals yet",
        "Set a savings goal to track progress. This is a tracker, not a recommendation.",
        "",
        "#"
      );
      return;
    }
    host.innerHTML = state.savingsGoals
      .map(function (g) {
        const p = goalProgress(g);
        const bar = Math.min(100, p);
        const remaining = Math.max(0, g.targetAmount - g.currentAmount);
        const overdue = g.targetDate < todayStr() && p < 100;
        const over = g.currentAmount > g.targetAmount;
        return (
          '<article class="goal-card"><h3>' +
          escapeHtml(g.name) +
          '</h3><div class="meta-grid"><div><span>Target</span><strong>' +
          money(g.targetAmount) +
          "</strong></div><div><span>Saved</span><strong>" +
          money(g.currentAmount) +
          "</strong></div><div><span>Remaining</span><strong>" +
          money(remaining) +
          "</strong></div><div><span>Target date</span><strong>" +
          fmtDate(g.targetDate) +
          '</strong></div></div><div class="progress"><i class="' +
          (bar >= 100 ? "done" : "") +
          '" style="width:' +
          bar +
          '%"></i></div><div class="progress-label"><span>' +
          (bar >= 100 ? "Complete" : Math.round(bar) + "%") +
          "</span>" +
          (over ? "<span>Exceeds target</span>" : "") +
          "</div>" +
          (overdue ? '<p class="warn-text">Target date passed</p>' : "") +
          '<div class="btn-row" style="margin-top:16px"><button type="button" class="btn btn-primary btn-sm" data-add-save="' +
          g.id +
          '">Add savings</button><button type="button" class="btn btn-secondary btn-sm" data-edit-goal="' +
          g.id +
          '">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-del-goal="' +
          g.id +
          '">Delete</button></div></article>'
        );
      })
      .join("");
  }

  function renderInvestmentsPage() {
    const invested = state.investments.reduce(function (a, i) {
      return a + holdingPL(i).invested;
    }, 0);
    const current = state.investments.reduce(function (a, i) {
      return a + holdingPL(i).current;
    }, 0);
    const pl = current - invested;
    const chg = invested > 0 ? (pl / invested) * 100 : null;
    $("#invest-stats").innerHTML =
      statCard("Total invested", money(invested), "navy", "Buy cost of holdings you entered") +
      statCard("Current portfolio value", money(current), "navy", "Shares × current price, or value you typed") +
      statCard("Profit / loss", plLabel(pl), pl > 0 ? "good" : pl < 0 ? "bad" : "muted", "Current value minus what you invested") +
      statCard("Percentage change", chg === null ? "—" : pct(chg), pl > 0 ? "good" : pl < 0 ? "bad" : "muted", "Based on your numbers");
    const host = $("#invest-list");
    if (!state.investments.length) {
      host.innerHTML = emptyHtml(
        "No investments yet",
        "Add holdings you already own to track them. SaveTrack does not recommend investments.",
        "",
        "#"
      );
      return;
    }
    if (investView === "cards") {
      host.innerHTML =
        '<div class="card-grid">' +
        state.investments
          .map(function (i) {
            const pl = holdingPL(i);
            const shareRows = isShareHolding(i)
              ? '<div><span>Shares</span><strong>' +
                String(i.shares) +
                "</strong></div><div><span>Buy price</span><strong>" +
                money(i.buyPrice) +
                "</strong></div><div><span>Current price</span><strong>" +
                money(i.currentPrice) +
                "</strong></div>"
              : "";
            return (
              '<article class="invest-card"><h3>' +
              escapeHtml(i.name) +
              '</h3><span class="badge">' +
              escapeHtml(i.type) +
              (isShareHolding(i) ? " · shares" : " · amount") +
              '</span><div class="meta-grid" style="margin-top:12px">' +
              shareRows +
              "<div><span>Invested</span><strong>" +
              money(pl.invested) +
              "</strong></div><div><span>Current value</span><strong>" +
              money(pl.current) +
              "</strong></div><div><span>Date</span><strong>" +
              fmtDate(i.date) +
              '</strong></div><div><span>Profit / loss</span><strong class="' +
              (pl.d > 0 ? "amount-pos" : pl.d < 0 ? "amount-neg" : "") +
              '">' +
              plLabel(pl.d) +
              " (" +
              pct(pl.pc) +
              ")</strong></div></div><div class=\"btn-row\" style=\"margin-top:12px\"><button type=\"button\" class=\"btn btn-secondary btn-sm\" data-edit-inv=\"" +
              i.id +
              '">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-del-inv="' +
              i.id +
              '">Delete</button></div></article>'
            );
          })
          .join("") +
        "</div>";
      return;
    }
    const rows = state.investments.map(function (i) {
      const pl = holdingPL(i);
      return (
        "<tr><td>" +
        escapeHtml(i.name) +
        "</td><td>" +
        escapeHtml(i.type) +
        '</td><td class="num">' +
        (isShareHolding(i) ? String(i.shares) : "—") +
        '</td><td class="num">' +
        (isShareHolding(i) ? money(i.buyPrice) : "—") +
        '</td><td class="num">' +
        (isShareHolding(i) ? money(i.currentPrice) : "—") +
        '</td><td class="num">' +
        money(pl.invested) +
        '</td><td class="num">' +
        money(pl.current) +
        "</td><td>" +
        fmtDate(i.date) +
        '</td><td class="num ' +
        (pl.d > 0 ? "amount-pos" : pl.d < 0 ? "amount-neg" : "") +
        '">' +
        plLabel(pl.d) +
        "</td><td class=\"num\">" +
        pct(pl.pc) +
        "</td><td><button type=\"button\" class=\"icon-btn\" data-edit-inv=\"" +
        i.id +
        '">✎</button><button type="button" class="icon-btn" data-del-inv="' +
        i.id +
        '">✕</button></td></tr>'
      );
    });
    host.innerHTML = tableAndCards(
      ["NAME", "TYPE", "SHARES", "BUY", "PRICE", "INVESTED", "CURRENT", "DATE", "P/L", "%", ""],
      rows,
      state.investments
        .map(function (i) {
          const pl = holdingPL(i);
          return (
            '<div class="row-card"><div class="rc-top"><strong>' +
            escapeHtml(i.name) +
            "</strong>" +
            '<span class="' +
            (pl.d > 0 ? "amount-pos" : pl.d < 0 ? "amount-neg" : "") +
            '">' +
            plLabel(pl.d) +
            '</span></div><div class="rc-mid">' +
            escapeHtml(i.type) +
            (isShareHolding(i) ? " · " + String(i.shares) + " shares" : "") +
            '</div><div class="rc-bot"><span>' +
            fmtDate(i.date) +
            '</span><span><button type="button" class="icon-btn" data-edit-inv="' +
            i.id +
            '">✎</button></span></div></div>'
          );
        })
        .join("")
    );
  }

  function quoteMoney(n, code) {
    const map = { USD: "$", PKR: "Rs", EUR: "€", GBP: "£" };
    const s = map[code] || (code ? code + " " : "$");
    const sign = n < 0 ? "−" : "";
    const abs = Math.abs(Number(n) || 0);
    return sign + s + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function sparkline(series, w, h) {
    const vals = (series || []).map(function (p) {
      return p.c;
    }).filter(function (n) {
      return n != null && isFinite(n);
    });
    if (vals.length < 2) return '<span class="caption">No chart</span>';
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const span = max - min || 1;
    const pts = vals
      .map(function (v, i) {
        const x = (i / (vals.length - 1)) * w;
        const y = h - 3 - ((v - min) / span) * (h - 6);
        return x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    const up = vals[vals.length - 1] >= vals[0];
    return (
      '<svg class="spark" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" width="' +
      w +
      '" height="' +
      h +
      '" aria-hidden="true"><polyline fill="none" stroke="' +
      (up ? "var(--success)" : "var(--danger)") +
      '" stroke-width="2" points="' +
      pts +
      '"/></svg>'
    );
  }

  function dailyBarChart(series, w, h) {
    if (!series || series.length < 2) return '<p class="caption">Not enough daily prices to draw a chart.</p>';
    const vals = series.map(function (p) {
      return p.c;
    });
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const span = max - min || 1;
    const slot = (w - 8) / series.length;
    const bw = Math.max(1.5, slot - 1);
    let bars = "";
    series.forEach(function (p, i) {
      const prev = i ? series[i - 1].c : p.c;
      const x = 4 + i * slot;
      const bh = Math.max(2, ((p.c - min) / span) * (h - 22));
      const y = h - 16 - bh;
      bars +=
        '<rect x="' +
        x.toFixed(1) +
        '" y="' +
        y.toFixed(1) +
        '" width="' +
        bw.toFixed(1) +
        '" height="' +
        bh.toFixed(1) +
        '" rx="1" fill="' +
        (p.c >= prev ? "var(--success)" : "var(--danger)") +
        '"/>';
    });
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function lab(p) {
      const d = new Date(p.t * 1000);
      return d.getDate() + " " + months[d.getMonth()];
    }
    const first = series[0];
    const last = series[series.length - 1];
    return (
      '<svg class="daily-bars" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" width="100%" height="' +
      h +
      '" role="img" aria-label="Daily closing prices">' +
      bars +
      '<text x="4" y="' +
      (h - 4) +
      '" font-size="10" fill="currentColor">' +
      lab(first) +
      '</text><text x="' +
      (w - 4) +
      '" y="' +
      (h - 4) +
      '" font-size="10" text-anchor="end" fill="currentColor">' +
      lab(last) +
      "</text></svg>"
    );
  }

  function parseYahooChart(data) {
    const res = data && data.chart && data.chart.result && data.chart.result[0];
    if (!res) return null;
    const meta = res.meta || {};
    const ts = res.timestamp || [];
    const q0 = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
    const closes = q0.close || [];
    const series = [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] == null || !isFinite(closes[i])) continue;
      series.push({ t: ts[i], c: Number(closes[i]) });
    }
    if (!series.length) return null;
    const last = series[series.length - 1].c;
    const prev = series.length > 1 ? series[series.length - 2].c : Number(meta.chartPreviousClose) || last;
    const first = series[0].c;
    return {
      price: last,
      prev: prev,
      dayChg: last - prev,
      dayPct: prev ? ((last - prev) / prev) * 100 : 0,
      monthChg: last - first,
      monthPct: first ? ((last - first) / first) * 100 : 0,
      currency: meta.currency || "USD",
      series: series,
      error: "",
    };
  }

  function fetchWithTimeout(url, ms) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, ms || 8000);
    const opts = ctrl ? { signal: ctrl.signal } : {};
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("http");
      return r.json();
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function fetchYahooChart(symbol) {
    const yurl =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?interval=1d&range=1mo";
    function fromPayload(data) {
      if (typeof data === "string") data = JSON.parse(data);
      if (data && typeof data.contents === "string") data = JSON.parse(data.contents);
      const parsed = parseYahooChart(data);
      if (!parsed) throw new Error("parse");
      return parsed;
    }
    return fetchWithTimeout("https://api.allorigins.win/get?url=" + encodeURIComponent(yurl), 10000).then(fromPayload);
  }

  function parseTwelveSeries(data) {
    if (!data || !data.values || !data.values.length) return null;
    const rows = data.values.slice().reverse();
    const series = [];
    rows.forEach(function (r) {
      const n = Number(r.close);
      if (!isFinite(n)) return;
      const d = new Date(String(r.datetime).slice(0, 10) + "T00:00:00Z");
      series.push({ t: Math.floor(d.getTime() / 1000), c: n });
    });
    if (!series.length) return null;
    const last = series[series.length - 1].c;
    const prev = series.length > 1 ? series[series.length - 2].c : last;
    const first = series[0].c;
    return {
      price: last,
      prev: prev,
      dayChg: last - prev,
      dayPct: prev ? ((last - prev) / prev) * 100 : 0,
      monthChg: last - first,
      monthPct: first ? ((last - first) / first) * 100 : 0,
      currency: (data.meta && data.meta.currency) || "USD",
      series: series,
      error: "",
    };
  }

  function loadStockCache() {
    try {
      const raw = localStorage.getItem(STOCK_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.quotes) stockQuotes = parsed.quotes;
    } catch (e) {
      /* ignore */
    }
  }

  function saveStockCache() {
    try {
      localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify({ at: Date.now(), quotes: stockQuotes }));
    } catch (e) {
      /* ignore */
    }
  }

  function filteredHalalStocks() {
    const q = String(stockQuery || "").trim().toLowerCase();
    if (!q) return HALAL_STOCKS.slice();
    return HALAL_STOCKS.filter(function (s) {
      return (s.symbol + " " + s.name + " " + s.market + " " + s.sector).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderStockFocus() {
    const card = $("#stock-focus-card");
    const title = $("#stock-focus-title");
    const chart = $("#stock-focus-chart");
    if (!card || !chart) return;
    const co = HALAL_STOCKS.find(function (s) {
      return s.symbol === stockSelected;
    });
    const q = stockSelected ? stockQuotes[stockSelected] : null;
    if (!co || !q || !q.series) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const up = q.monthChg >= 0;
    title.textContent = co.name + " (" + co.symbol + ") — daily closes";
    chart.innerHTML =
      '<div class="meta-grid"><div><span>Last close</span><strong>' +
      quoteMoney(q.price, q.currency) +
      '</strong></div><div><span>Today vs yesterday</span><strong class="' +
      (q.dayChg > 0 ? "amount-pos" : q.dayChg < 0 ? "amount-neg" : "") +
      '">' +
      (q.dayChg > 0 ? "profit " : q.dayChg < 0 ? "loss " : "") +
      quoteMoney(q.dayChg, q.currency) +
      " (" +
      pct(q.dayPct) +
      ')</strong></div><div><span>~1 month</span><strong class="' +
      (up ? "amount-pos" : "amount-neg") +
      '">' +
      (up ? "profit " : "loss ") +
      quoteMoney(q.monthChg, q.currency) +
      " (" +
      pct(q.monthPct) +
      ")</strong></div></div>" +
      dailyBarChart(q.series, 640, 180);
  }

  function renderHalalStocksPage() {
    loadStockCache();
    const search = $("#stock-search");
    if (search && search.value !== stockQuery) search.value = stockQuery;
    const list = filteredHalalStocks();
    const quotes = list
      .map(function (s) {
        return stockQuotes[s.symbol];
      })
      .filter(function (q) {
        return q && q.price;
      });
    const upN = quotes.filter(function (q) {
      return q.dayChg > 0;
    }).length;
    const downN = quotes.filter(function (q) {
      return q.dayChg < 0;
    }).length;
    $("#stock-market-stats").innerHTML =
      statCard("Companies listed", String(HALAL_STOCKS.length), "navy", "Illustrative list only") +
      statCard("Quotes loaded", String(quotes.length) + " / " + String(list.length), "navy", "Delayed market data") +
      statCard("In profit today", String(upN), "good", "Close higher than previous day") +
      statCard("In loss today", String(downN), "bad", "Close lower than previous day");
    const host = $("#stock-list");
    if (!list.length) {
      host.innerHTML = emptyHtml("No match", "Try another company or symbol.", "", "#");
      renderStockFocus();
      return;
    }
    host.innerHTML =
      '<div class="stock-grid">' +
      list
        .map(function (s) {
          const q = stockQuotes[s.symbol];
          const selected = stockSelected === s.symbol ? " is-selected" : "";
          if (!q) {
            return (
              '<article class="stock-card' +
              selected +
              '" data-stock-open="' +
              escapeHtml(s.symbol) +
              '"><div class="stock-top"><div><h3>' +
              escapeHtml(s.name) +
              '</h3><span class="badge">' +
              escapeHtml(s.symbol) +
              " · " +
              escapeHtml(s.market) +
              '</span></div><strong class="stock-px">…</strong></div><p class="caption">Loading daily price…</p></article>'
            );
          }
          if (q.error && !q.price) {
            return (
              '<article class="stock-card' +
              selected +
              '" data-stock-open="' +
              escapeHtml(s.symbol) +
              '"><div class="stock-top"><div><h3>' +
              escapeHtml(s.name) +
              '</h3><span class="badge">' +
              escapeHtml(s.symbol) +
              '</span></div></div><p class="caption">Could not load this quote. Try Refresh prices.</p></article>'
            );
          }
          const up = q.dayChg > 0;
          const down = q.dayChg < 0;
          return (
            '<article class="stock-card' +
            selected +
            (up ? " is-up" : down ? " is-down" : "") +
            '" data-stock-open="' +
            escapeHtml(s.symbol) +
            '"><div class="stock-top"><div><h3>' +
            escapeHtml(s.name) +
            '</h3><span class="badge">' +
            escapeHtml(s.symbol) +
            " · " +
            escapeHtml(s.sector) +
            '</span></div><strong class="stock-px">' +
            quoteMoney(q.price, q.currency) +
            '</strong></div><div class="stock-row"><span class="' +
            (up ? "amount-pos" : down ? "amount-neg" : "") +
            '">' +
            (up ? "Profit " : down ? "Loss " : "Flat ") +
            quoteMoney(q.dayChg, q.currency) +
            " (" +
            pct(q.dayPct) +
            ")</span>" +
            sparkline(q.series, 120, 36) +
            '</div><div class="btn-row"><button type="button" class="btn btn-secondary btn-sm" data-stock-open="' +
            escapeHtml(s.symbol) +
            '">Daily graph</button><button type="button" class="btn btn-primary btn-sm" data-stock-add="' +
            escapeHtml(s.symbol) +
            '">Add to investments</button></div></article>'
          );
        })
        .join("") +
      "</div>";
    renderStockFocus();
    const haveAny = HALAL_STOCKS.some(function (s) {
      return stockQuotes[s.symbol] && stockQuotes[s.symbol].price;
    });
    if (!haveAny && !stockLoading) refreshHalalQuotes(false);
  }

  function refreshHalalQuotes(force) {
    stockLoading = true;
    const status = $("#stock-status");
    if (status) status.textContent = "Loading delayed daily prices…";
    const seq = ++stockFetchSeq;
    function runQueue(items, limit, worker) {
      let i = 0;
      const runners = [];
      function next() {
        if (i >= items.length) return Promise.resolve();
        const cur = items[i++];
        return Promise.resolve(worker(cur)).then(next);
      }
      for (let n = 0; n < limit; n++) runners.push(next());
      return Promise.all(runners);
    }
    return runQueue(HALAL_STOCKS, 1, function (s) {
      if (!force && stockQuotes[s.symbol] && stockQuotes[s.symbol].price && Date.now() - (stockQuotes[s.symbol].at || 0) < 15 * 60 * 1000) {
        return Promise.resolve();
      }
      return fetchYahooChart(s.symbol)
        .then(function (q) {
          if (seq !== stockFetchSeq) return;
          q.at = Date.now();
          stockQuotes[s.symbol] = q;
          if (currentRoute() === "stocks") renderHalalStocksPage();
        })
        .catch(function () {
          if (seq !== stockFetchSeq) return;
          if (!stockQuotes[s.symbol] || !stockQuotes[s.symbol].price) {
            stockQuotes[s.symbol] = { error: "unavailable", at: Date.now() };
          }
        })
        .then(function () {
          return new Promise(function (resolve) {
            setTimeout(resolve, 350);
          });
        });
    }).then(function () {
      if (seq !== stockFetchSeq) return;
      stockLoading = false;
      saveStockCache();
      const ok = HALAL_STOCKS.filter(function (s) {
        return stockQuotes[s.symbol] && stockQuotes[s.symbol].price;
      }).length;
      if (status) {
        status.textContent =
          ok > 0
            ? "Showing delayed daily closes for " + ok + " companies. Green = profit vs yesterday. Red = loss. Not live. Not a recommendation."
            : "Could not reach the quote server from this host. Open SaveTrack on http://127.0.0.1 or try Refresh again. GitHub Pages may block some market APIs.";
      }
      if (currentRoute() === "stocks") renderHalalStocksPage();
    });
  }

  function renderTransactionsPage() {
    const q = $("#txn-search").value;
    const type = $("#txn-type").value;
    const from = $("#txn-from").value;
    const to = $("#txn-to").value;
    const sort = $("#txn-sort").value;
    let list = state.transactions.slice();
    list = filterBySearchDate(list, q, from, to, function (x) {
      return x.type + " " + x.category + " " + x.description;
    });
    if (type) {
      list = list.filter(function (x) {
        return x.type === type;
      });
    }
    list.sort(function (a, b) {
      if (sort === "date-asc") return a.date.localeCompare(b.date);
      if (sort === "amount-desc") return b.amount - a.amount;
      if (sort === "amount-asc") return a.amount - b.amount;
      if (sort === "type") return a.type.localeCompare(b.type) || b.date.localeCompare(a.date);
      return cmpDateDesc(a, b);
    });
    const chips = [];
    if (q) chips.push("Search");
    if (type) chips.push(type);
    if (from) chips.push("From " + fmtDate(from));
    if (to) chips.push("To " + fmtDate(to));
    $("#txn-chips").innerHTML = chips
      .map(function (c) {
        return '<span class="chip is-on">' + escapeHtml(c) + "</span>";
      })
      .join("");
    if (!state.transactions.length) {
      $("#txn-list").innerHTML = emptyHtml("No transactions yet", "Add income or expenses to fill this ledger.", "Add income", "#income");
      return;
    }
    if (!list.length) {
      $("#txn-list").innerHTML = emptyHtml("No transactions match", "Clear filters.", "", "#");
      return;
    }
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (txnPage > totalPages) txnPage = totalPages;
    const slice = list.slice((txnPage - 1) * PAGE_SIZE, txnPage * PAGE_SIZE);
    let html = renderTxnCollection(slice, true);
    if (list.length > PAGE_SIZE) {
      html +=
        '<div class="pager"><button type="button" class="btn btn-secondary" id="txn-prev"' +
        (txnPage === 1 ? " disabled" : "") +
        ">Previous</button><span>Page " +
        txnPage +
        " of " +
        totalPages +
        '</span><button type="button" class="btn btn-secondary" id="txn-next"' +
        (txnPage === totalPages ? " disabled" : "") +
        ">Next</button></div>";
    }
    $("#txn-list").innerHTML = html;
  }

  function renderSettings() {
    $("#setting-currency").value = state.settings.currency;
    $("#note-weekly").checked = !!state.settings.notifications.weeklyExpenseReminder;
    $("#note-goals").checked = !!state.settings.notifications.goalDateReminder;
    $("#settings-user").textContent =
      "Signed in as " + currentUser + ". Logging out hides this screen only. Your records stay in the on-device database until you reset them.";
    applyTheme();
    if (parseFailed) {
      $("#note-status").textContent = "Saved data could not be read. Use Reset all data if you want to start over. The app will not overwrite the stored file until then.";
    }
    const stamp = document.getElementById("data-status");
    if (stamp) {
      const saved = state.savedAt ? fmtDate(String(state.savedAt).slice(0, 10)) : "";
      stamp.textContent = saved
        ? "On-device database last saved " + saved + ". Sign in with the same username after logout to see these records."
        : "On-device database is ready. Records stay saved after you close the site or log out.";
    }
  }

  function render() {
    if (!state) return;
    syncCurrencyPrefixes();
    applyTheme();
    const route = currentRoute();
    if (route === "dashboard") renderDashboard();
    if (route === "income") renderIncomePage();
    if (route === "expenses") renderExpensePage();
    if (route === "history") renderHistoryPage();
    if (route === "savings") renderSavingsPage();
    if (route === "investments") renderInvestmentsPage();
    if (route === "stocks") renderHalalStocksPage();
    if (route === "transactions") renderTransactionsPage();
    if (route === "settings") renderSettings();
    $$("input[name=date]").forEach(function (el) {
      if (!el.value) el.value = todayStr();
    });
  }

  /* ---------- modal ---------- */
  let modalOnClose = null;

  function openModal(title, bodyHtml, footHtml, onClose) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHtml;
    $("#modal-foot").innerHTML = footHtml || "";
    $("#modal-root").hidden = false;
    modalOnClose = onClose || null;
    const first = $("#modal-body input, #modal-body select, #modal-body textarea, #modal-foot button");
    if (first) first.focus();
  }

  function closeModal() {
    $("#modal-root").hidden = true;
    if (modalOnClose) modalOnClose();
    modalOnClose = null;
  }

  function confirmDialog(message, onYes) {
    openModal(
      "Confirm",
      "<p>" + escapeHtml(message) + "</p>",
      '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="button" class="btn btn-danger" id="modal-ok">Delete</button>'
    );
    $("#modal-cancel").onclick = closeModal;
    $("#modal-ok").onclick = function () {
      closeModal();
      onYes();
    };
  }

  function amountField(name, label) {
    return (
      '<label class="field"><span>' +
      label +
      '</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="' +
      name +
      '" type="number" min="0" step="0.01" required /></div></label>'
    );
  }

  function goalFormHtml(g) {
    return (
      '<form id="modal-form">' +
      '<label class="field"><span>Goal name <em>Required</em></span><input name="name" maxlength="40" required value="' +
      escapeHtml(g && g.name ? g.name : "") +
      '" /></label>' +
      '<label class="field"><span>Target amount</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="targetAmount" type="number" min="0.01" step="0.01" required value="' +
      (g ? g.targetAmount : "") +
      '" /></div></label>' +
      '<label class="field"><span>Current amount</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="currentAmount" type="number" min="0" step="0.01" required value="' +
      (g ? g.currentAmount : "0") +
      '" /></div></label>' +
      '<label class="field"><span>Target date</span><input name="targetDate" type="date" required value="' +
      (g ? g.targetDate : "") +
      '" /></label></form>'
    );
  }

  function investFormHtml(i) {
    const opts = INVEST_TYPES.map(function (t) {
      return "<option" + (i && i.type === t ? " selected" : "") + ">" + t + "</option>";
    }).join("");
    const shareMode = !i || isShareHolding(i) || i.entryType === "shares";
    return (
      '<form id="modal-form"><p class="caption">Shares: profit = (current price − buy price) × shares. Amount: enter totals. Not live prices.</p>' +
      '<label class="field"><span>Investment name</span><input name="name" required maxlength="60" value="' +
      escapeHtml(i && i.name ? i.name : "") +
      '" /></label>' +
      '<label class="field"><span>Type</span><select name="type" required><option value="">Select type</option>' +
      opts +
      "</select></label>" +
      '<div class="field"><span>How to enter</span><div class="segmented" id="invest-entry-type">' +
      '<button type="button" data-entry="shares"' +
      (shareMode ? ' class="is-on"' : "") +
      ">Shares</button>" +
      '<button type="button" data-entry="amount"' +
      (shareMode ? "" : ' class="is-on"') +
      ">Amount</button></div></div>" +
      '<input type="hidden" name="entryType" id="invest-entry-value" value="' +
      (shareMode ? "shares" : "amount") +
      '" />' +
      '<div id="invest-shares-fields"' +
      (shareMode ? "" : " hidden") +
      ">" +
      '<label class="field"><span>Shares</span><input name="shares" type="number" min="0.000001" step="any" value="' +
      (i && i.shares != null ? i.shares : "") +
      '" placeholder="100" /></label>' +
      '<label class="field"><span>Buy price (per share)</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="buyPrice" type="number" min="0.01" step="0.01" value="' +
      (i && i.buyPrice != null ? i.buyPrice : "") +
      '" placeholder="100" /></div></label>' +
      '<label class="field"><span>Current price (per share)</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="currentPrice" type="number" min="0" step="0.01" value="' +
      (i && i.currentPrice != null ? i.currentPrice : "") +
      '" placeholder="110" /></div><small class="caption">You typed this price. Not a live quote.</small></label></div>' +
      '<div id="invest-amount-fields"' +
      (shareMode ? " hidden" : "") +
      ">" +
      '<label class="field"><span>Invested amount</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="investedAmount" type="number" min="0.01" step="0.01" value="' +
      (i && !shareMode ? i.investedAmount : "") +
      '" /></div></label>' +
      '<label class="field"><span>Current value</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="currentValue" type="number" min="0" step="0.01" value="' +
      (i && !shareMode ? i.currentValue : "") +
      '" /></div><small class="caption">You entered this figure. Not live market data.</small></label></div>' +
      '<label class="field"><span>Date</span><input name="date" type="date" required value="' +
      (i ? i.date : todayStr()) +
      '" /></label></form>'
    );
  }

  function setInvestEntryMode(mode) {
    const sharesOn = mode === "shares";
    const val = $("#invest-entry-value");
    if (val) val.value = sharesOn ? "shares" : "amount";
    $$("#invest-entry-type [data-entry]").forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-entry") === (sharesOn ? "shares" : "amount"));
    });
    const sf = $("#invest-shares-fields");
    const af = $("#invest-amount-fields");
    if (sf) sf.hidden = !sharesOn;
    if (af) af.hidden = sharesOn;
    updateInvestProfitPreview();
  }

  function updateInvestProfitPreview() {
    const box = $("#invest-profit-preview");
    if (!box) return;
    const form = $("#modal-form");
    if (!form) return;
    const mode = ($("#invest-entry-value") && $("#invest-entry-value").value) || "shares";
    let invested = null;
    let current = null;
    if (mode === "shares") {
      const shares = validQty(form.shares && form.shares.value);
      const buy = validAmount(form.buyPrice && form.buyPrice.value, 0.01);
      const price = validAmount(form.currentPrice && form.currentPrice.value, 0);
      if (!shares || !buy || price === null) {
        box.hidden = true;
        return;
      }
      invested = Math.round(shares * buy * 100) / 100;
      current = Math.round(shares * price * 100) / 100;
    } else {
      invested = validAmount(form.investedAmount && form.investedAmount.value, 0.01);
      current = validAmount(form.currentValue && form.currentValue.value, 0);
      if (!invested || current === null) {
        box.hidden = true;
        return;
      }
    }
    const d = current - invested;
    const pc = invested > 0 ? (d / invested) * 100 : 0;
    box.hidden = false;
    box.className = "profit-preview" + (d > 0 ? " is-gain" : d < 0 ? " is-loss" : "");
    box.innerHTML =
      "<span>Estimated profit / loss</span><strong class=\"" +
      (d > 0 ? "amount-pos" : d < 0 ? "amount-neg" : "") +
      '">' +
      plLabel(d) +
      "</strong><p>Invested " +
      money(invested) +
      " · now " +
      money(current) +
      " · " +
      pct(pc) +
      "</p>";
  }

  function readInvestmentForm(form) {
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const type = String(fd.get("type") || "");
    const date = String(fd.get("date") || "");
    const entryType = String(fd.get("entryType") || "amount") === "shares" ? "shares" : "amount";
    if (!name || INVEST_TYPES.indexOf(type) === -1 || !validDate(date)) return null;
    if (entryType === "shares") {
      const shares = validQty(fd.get("shares"));
      const buyPrice = validAmount(fd.get("buyPrice"), 0.01);
      const currentPrice = validAmount(fd.get("currentPrice"), 0);
      if (!shares || !buyPrice || currentPrice === null) return null;
      const investedAmount = Math.round(shares * buyPrice * 100) / 100;
      const currentValue = Math.round(shares * currentPrice * 100) / 100;
      if (!investedAmount) return null;
      return {
        name: name,
        type: type,
        date: date,
        entryType: "shares",
        shares: shares,
        buyPrice: buyPrice,
        currentPrice: currentPrice,
        investedAmount: investedAmount,
        currentValue: currentValue,
      };
    }
    const investedAmount = validAmount(fd.get("investedAmount"), 0.01);
    const currentValue = validAmount(fd.get("currentValue"), 0);
    if (!investedAmount || currentValue === null) return null;
    return {
      name: name,
      type: type,
      date: date,
      entryType: "amount",
      shares: null,
      buyPrice: null,
      currentPrice: null,
      investedAmount: investedAmount,
      currentValue: currentValue,
    };
  }

  function openGoalModal(existing) {
    openModal(
      existing ? "Edit goal" : "New goal",
      goalFormHtml(existing),
      '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="submit" form="modal-form" class="btn btn-primary">Save</button>'
    );
    $("#modal-cancel").onclick = closeModal;
    $("#modal-form").onsubmit = function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get("name") || "").trim();
      const target = validAmount(fd.get("targetAmount"), 0.01);
      const current = validAmount(fd.get("currentAmount"), 0);
      const date = String(fd.get("targetDate") || "");
      if (!name || !target || current === null || !date) {
        toast("Check the goal fields.", "err");
        return;
      }
      if (existing) {
        existing.name = name;
        existing.targetAmount = target;
        existing.currentAmount = current;
        existing.targetDate = date;
        existing.updatedAt = nowIso();
        updateLinkedTxn("goal", existing);
        saveState();
        toast("Goal updated");
      } else {
        addGoal({ name: name, targetAmount: target, currentAmount: current, targetDate: date });
        toast("Goal created");
      }
      closeModal();
      render();
    };
  }

  function openInvestModal(existing) {
    openModal(
      existing ? "Edit investment" : "Add investment",
      investFormHtml(existing),
      '<div class="profit-preview" id="invest-profit-preview" hidden></div><button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="submit" form="modal-form" class="btn btn-primary">Save</button>'
    );
    $("#modal-cancel").onclick = closeModal;
    $$("#invest-entry-type [data-entry]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setInvestEntryMode(btn.getAttribute("data-entry"));
      });
    });
    ["shares", "buyPrice", "currentPrice", "investedAmount", "currentValue"].forEach(function (name) {
      const el = $("#modal-form [name=\"" + name + "\"]");
      if (!el) return;
      el.addEventListener("input", updateInvestProfitPreview);
      el.addEventListener("change", updateInvestProfitPreview);
    });
    updateInvestProfitPreview();
    $("#modal-form").onsubmit = function (e) {
      e.preventDefault();
      const payload = readInvestmentForm(e.target);
      if (!payload) {
        toast("Check the investment fields.", "err");
        return;
      }
      if (existing) {
        existing.name = payload.name;
        existing.type = payload.type;
        existing.entryType = payload.entryType;
        existing.shares = payload.shares;
        existing.buyPrice = payload.buyPrice;
        existing.currentPrice = payload.currentPrice;
        existing.investedAmount = payload.investedAmount;
        existing.currentValue = payload.currentValue;
        existing.date = payload.date;
        existing.updatedAt = nowIso();
        updateLinkedTxn("investment", existing);
        saveState();
        toast("Investment updated");
      } else {
        addInvestment(payload);
        toast("Investment added");
      }
      closeModal();
      render();
    };
  }

  function openAddSavings(goal) {
    openModal(
      "Add savings to " + goal.name,
      '<form id="modal-form"><label class="field"><span>Amount to add</span><div class="amount-wrap"><span class="currency-prefix">' +
        symbol() +
        '</span><input name="amount" type="number" min="0.01" step="0.01" required /></div></label></form>',
      '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="submit" form="modal-form" class="btn btn-primary">Save</button>'
    );
    $("#modal-cancel").onclick = closeModal;
    $("#modal-form").onsubmit = function (e) {
      e.preventDefault();
      const amt = validAmount(new FormData(e.target).get("amount"), 0.01);
      if (!amt) {
        toast("Enter an amount greater than zero.", "err");
        return;
      }
      addToGoal(goal.id, amt);
      toast(goalProgress(goal) >= 100 ? "Goal reached (as you recorded)." : "Goal updated");
      closeModal();
      render();
    };
  }

  function incomeFormHtml(x) {
    return (
      '<form id="modal-form">' +
      '<label class="field"><span>Amount</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="amount" type="number" min="0.01" step="0.01" required value="' +
      (x ? x.amount : "") +
      '" /></div></label>' +
      '<label class="field"><span>Income source</span><input name="source" maxlength="60" required value="' +
      escapeHtml(x ? x.source : "") +
      '" /></label>' +
      '<label class="field"><span>Date</span><input name="date" type="date" required value="' +
      (x ? x.date : todayStr()) +
      '" /></label>' +
      '<label class="field"><span>Note</span><textarea name="note" maxlength="200">' +
      escapeHtml(x ? x.note : "") +
      "</textarea></label></form>"
    );
  }

  function expenseFormHtml(x) {
    const opts = EXPENSE_CATEGORIES.map(function (c) {
      return "<option" + (x && x.category === c ? " selected" : "") + ">" + c + "</option>";
    }).join("");
    return (
      '<form id="modal-form">' +
      '<label class="field"><span>Amount</span><div class="amount-wrap"><span class="currency-prefix">' +
      symbol() +
      '</span><input name="amount" type="number" min="0.01" step="0.01" required value="' +
      (x ? x.amount : "") +
      '" /></div></label>' +
      '<label class="field"><span>Category</span><select name="category" required><option value="">Select</option>' +
      opts +
      "</select></label>" +
      '<label class="field"><span>Date</span><input name="date" type="date" required value="' +
      (x ? x.date : todayStr()) +
      '" /></label>' +
      '<label class="field"><span>Note</span><textarea name="note" maxlength="200">' +
      escapeHtml(x ? x.note : "") +
      "</textarea></label></form>"
    );
  }

  function openIncomeModal(existing) {
    openModal(
      existing ? "Edit income" : "Add income",
      incomeFormHtml(existing),
      '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="submit" form="modal-form" class="btn btn-primary">Save</button>'
    );
    $("#modal-cancel").onclick = closeModal;
    $("#modal-form").onsubmit = function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = readIncome(fd);
      if (!payload) return;
      if (existing) {
        existing.amount = payload.amount;
        existing.source = payload.source;
        existing.date = payload.date;
        existing.note = payload.note;
        existing.updatedAt = nowIso();
        updateLinkedTxn("income", existing);
        saveState();
        toast("Income updated");
      } else {
        addIncome(payload);
        toast("Income added");
      }
      closeModal();
      render();
    };
  }

  function openExpenseModal(existing) {
    openModal(
      existing ? "Edit expense" : "Add expense",
      expenseFormHtml(existing),
      '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="submit" form="modal-form" class="btn btn-primary">Save</button>'
    );
    $("#modal-cancel").onclick = closeModal;
    $("#modal-form").onsubmit = function (e) {
      e.preventDefault();
      const payload = readExpense(new FormData(e.target));
      if (!payload) return;
      if (existing) {
        existing.amount = payload.amount;
        existing.category = payload.category;
        existing.date = payload.date;
        existing.note = payload.note;
        existing.updatedAt = nowIso();
        updateLinkedTxn("expense", existing);
        saveState();
        toast("Expense updated");
      } else {
        addExpense(payload);
        toast("Expense added");
      }
      closeModal();
      render();
    };
  }

  function readIncome(fd, form) {
    const amount = validAmount(fd.get("amount"), 0.01);
    const source = String(fd.get("source") || "").trim();
    const date = String(fd.get("date") || "");
    const note = String(fd.get("note") || "").trim();
    let ok = true;
    if (form) {
      setErr(form, "amount", amount ? "" : "Enter an amount greater than zero.");
      setErr(form, "source", source && source.length <= 60 ? "" : "Enter a source (1–60 characters).");
      setErr(form, "date", validDate(date) ? "" : "Enter a valid date (not far in the future).");
    }
    if (!amount || !source || source.length > 60 || !validDate(date)) {
      if (!form) toast("Check the income fields.", "err");
      ok = false;
    }
    if (!ok) return null;
    return { amount: amount, source: source, date: date, note: note };
  }

  function readExpense(fd, form) {
    const amount = validAmount(fd.get("amount"), 0.01);
    const category = String(fd.get("category") || "");
    const date = String(fd.get("date") || "");
    const note = String(fd.get("note") || "").trim();
    if (form) {
      setErr(form, "amount", amount ? "" : "Enter an amount greater than zero.");
      setErr(form, "category", EXPENSE_CATEGORIES.indexOf(category) !== -1 ? "" : "Choose a category.");
      setErr(form, "date", validDate(date) ? "" : "Enter a valid date (not far in the future).");
    }
    if (!amount || EXPENSE_CATEGORIES.indexOf(category) === -1 || !validDate(date)) {
      if (!form) toast("Check the expense fields.", "err");
      return null;
    }
    return { amount: amount, category: category, date: date, note: note };
  }

  function setErr(form, name, msg) {
    const input = form.querySelector('[name="' + name + '"]');
    if (input) input.classList.toggle("is-invalid", !!msg);
    const err = form.querySelector('[data-err="' + name + '"]');
    if (err) err.textContent = msg || "";
  }

  function handleHeaderAdd() {
    const route = currentRoute();
    if (route === "dashboard" || route === "transactions") {
      const menu = $("#add-menu");
      menu.hidden = !menu.hidden;
      return;
    }
    if (route === "income") {
      const field = $("#form-income [name=amount]");
      if (field) field.focus();
    } else if (route === "expenses" || route === "history") {
      const field = $("#form-expense [name=amount]");
      if (route === "history") {
        openExpenseModal(null);
        return;
      }
      if (field) field.focus();
    }
    else if (route === "savings") openGoalModal(null);
    else if (route === "investments") openInvestModal(null);
    else if (route === "stocks") refreshHalalQuotes(true);
  }

  function findTxn(id) {
    return state.transactions.find(function (t) {
      return t.id === id;
    });
  }

  function editFromTxn(id) {
    const t = findTxn(id);
    if (!t) return;
    if (t.linkedKind === "income") {
      openIncomeModal(
        state.income.find(function (x) {
          return x.id === t.linkedId;
        })
      );
    } else if (t.linkedKind === "expense") {
      openExpenseModal(
        state.expenses.find(function (x) {
          return x.id === t.linkedId;
        })
      );
    } else if (t.linkedKind === "investment") {
      openInvestModal(
        state.investments.find(function (x) {
          return x.id === t.linkedId;
        })
      );
    } else if (t.linkedKind === "goal") {
      openGoalModal(
        state.savingsGoals.find(function (x) {
          return x.id === t.linkedId;
        })
      );
    }
  }

  /* ---------- calculators ---------- */
  function monthsBetween(from, to) {
    const a = new Date(from + "T00:00:00");
    const b = new Date(to + "T00:00:00");
    const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    const dayFrac = (b.getDate() - a.getDate()) / 30;
    return months + dayFrac;
  }

  function compoundFuture(p, pmt, annualPct, years) {
    const n = Math.round(years * 12);
    const r = annualPct / 100 / 12;
    if (n <= 0) return p;
    if (Math.abs(r) < 1e-12) return p + pmt * n;
    const growth = Math.pow(1 + r, n);
    return p * growth + pmt * ((growth - 1) / r);
  }

  /* ---------- notifications ---------- */
  function maybeNotify() {
    const n = state.settings.notifications;
    if (!n.weeklyExpenseReminder && !n.goalDateReminder) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const key = "savetrack.v1.notify";
    let meta = {};
    try {
      meta = JSON.parse(localStorage.getItem(key) || "{}");
    } catch (e) {
      meta = {};
    }
    const today = todayStr();
    if (n.weeklyExpenseReminder) {
      const last = meta.weekly || "";
      const lastDate = last ? new Date(last + "T00:00:00") : new Date(0);
      const diff = (new Date(today + "T00:00:00") - lastDate) / 86400000;
      if (diff >= 7) {
        new Notification("SaveTrack", { body: "Reminder to log expenses this week. Tracking only — not advice." });
        meta.weekly = today;
      }
    }
    if (n.goalDateReminder) {
      const due = state.savingsGoals.filter(function (g) {
        const p = goalProgress(g);
        return g.targetDate <= today && p < 100;
      });
      if (due.length && meta.goals !== today) {
        new Notification("SaveTrack", {
          body: due.length + " goal(s) have a target date on or before today (as you recorded).",
        });
        meta.goals = today;
      }
    }
    localStorage.setItem(key, JSON.stringify(meta));
  }

  async function enableNotificationsIfNeeded() {
    const n = state.settings.notifications;
    if (!n.weeklyExpenseReminder && !n.goalDateReminder) return;
    if (!("Notification" in window)) {
      $("#note-status").textContent = "This browser does not support notifications.";
      return;
    }
    if (Notification.permission === "granted") {
      $("#note-status").textContent = "";
      maybeNotify();
      return;
    }
    if (Notification.permission === "denied") {
      $("#note-status").textContent = "Enable notifications in browser settings to receive reminders.";
      return;
    }
    const perm = await Notification.requestPermission();
    state.settings.notifications.permissionAsked = true;
    saveState();
    if (perm !== "granted") {
      $("#note-status").textContent = "Enable in browser settings to receive reminders.";
    } else {
      $("#note-status").textContent = "";
      maybeNotify();
    }
  }

  /* ---------- events ---------- */
  function debounce(name, fn) {
    clearTimeout(searchTimers[name]);
    searchTimers[name] = setTimeout(fn, 200);
  }

  function bind() {
    window.addEventListener("hashchange", function () {
      if (!currentUser) return;
      navigate(currentRoute());
    });
    $("#hamburger").addEventListener("click", openSidebar);
    $("#sidebar-close").addEventListener("click", closeSidebar);
    $("#overlay").addEventListener("click", closeSidebar);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeSidebar();
        closeMenu();
        if (!$("#modal-root").hidden) closeModal();
      }
    });
    $("#header-add").addEventListener("click", function (e) {
      e.stopPropagation();
      handleHeaderAdd();
    });
    document.addEventListener("click", function () {
      closeMenu();
    });
    $("#add-menu").addEventListener("click", function (e) {
      e.stopPropagation();
      const btn = e.target.closest("[data-add]");
      if (!btn) return;
      closeMenu();
      const k = btn.getAttribute("data-add");
      if (k === "income") openIncomeModal(null);
      if (k === "expense") openExpenseModal(null);
      if (k === "goal") openGoalModal(null);
      if (k === "investment") openInvestModal(null);
    });
    $$("[data-theme-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!state) return;
        state.settings.theme = btn.getAttribute("data-theme-set");
        saveState();
        applyTheme();
      });
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
    $("#dash-period").addEventListener("click", function (e) {
      const b = e.target.closest("[data-period]");
      if (!b) return;
      dashPeriod = b.getAttribute("data-period");
      $$("#dash-period button").forEach(function (x) {
        x.classList.toggle("is-on", x === b);
      });
      renderDashboard();
    });
    $("#form-income").addEventListener("submit", function (e) {
      e.preventDefault();
      const payload = readIncome(new FormData(e.target), e.target);
      if (!payload) return;
      addIncome(payload);
      e.target.reset();
      e.target.querySelector('[name="date"]').value = todayStr();
      toast("Income added");
      render();
    });
    $("#form-expense").addEventListener("submit", function (e) {
      e.preventDefault();
      const payload = readExpense(new FormData(e.target), e.target);
      if (!payload) return;
      addExpense(payload);
      e.target.reset();
      e.target.querySelector('[name="date"]').value = todayStr();
      toast("Expense added");
      render();
    });
    ["income-search", "income-from", "income-to"].forEach(function (id) {
      $("#" + id).addEventListener("input", function () {
        debounce("inc", renderIncomePage);
      });
      $("#" + id).addEventListener("change", renderIncomePage);
    });
    ["expense-search", "expense-category", "expense-from", "expense-to"].forEach(function (id) {
      $("#" + id).addEventListener("input", function () {
        debounce("exp", renderExpensePage);
      });
      $("#" + id).addEventListener("change", renderExpensePage);
    });
    ["history-search", "history-category", "history-from", "history-to"].forEach(function (id) {
      $("#" + id).addEventListener("input", function () {
        debounce("hist", renderHistoryPage);
      });
      $("#" + id).addEventListener("change", renderHistoryPage);
    });
    $("#history-clear").addEventListener("click", function () {
      $("#history-search").value = "";
      $("#history-category").value = "";
      $("#history-from").value = "";
      $("#history-to").value = "";
      renderHistoryPage();
    });
    $("#expense-chips").addEventListener("click", function (e) {
      const b = e.target.closest("[data-chip]");
      if (!b) return;
      $("#expense-category").value = b.getAttribute("data-chip");
      renderExpensePage();
    });
    $("#invest-view").addEventListener("click", function (e) {
      const b = e.target.closest("[data-view]");
      if (!b) return;
      investView = b.getAttribute("data-view");
      $$("#invest-view button").forEach(function (x) {
        x.classList.toggle("is-on", x === b);
      });
      renderInvestmentsPage();
    });
    $("#stock-refresh").addEventListener("click", function () {
      refreshHalalQuotes(true);
    });
    $("#stock-search").addEventListener("input", function () {
      stockQuery = $("#stock-search").value;
      debounce("stk", function () {
        if (currentRoute() === "stocks") renderHalalStocksPage();
      });
    });
    ["txn-search", "txn-type", "txn-sort", "txn-from", "txn-to"].forEach(function (id) {
      $("#" + id).addEventListener("input", function () {
        txnPage = 1;
        debounce("txn", renderTransactionsPage);
      });
      $("#" + id).addEventListener("change", function () {
        txnPage = 1;
        renderTransactionsPage();
      });
    });
    $("#txn-clear").addEventListener("click", function () {
      $("#txn-search").value = "";
      $("#txn-type").value = "";
      $("#txn-sort").value = "date-desc";
      $("#txn-from").value = "";
      $("#txn-to").value = "";
      txnPage = 1;
      renderTransactionsPage();
    });
    document.addEventListener("click", function (e) {
      if (e.target.id === "txn-prev") {
        txnPage = Math.max(1, txnPage - 1);
        renderTransactionsPage();
      }
      if (e.target.id === "txn-next") {
        txnPage += 1;
        renderTransactionsPage();
      }
      const ei = e.target.closest("[data-edit-income]");
      if (ei) {
        const rec = state.income.find(function (x) {
          return x.id === ei.getAttribute("data-edit-income");
        });
        openIncomeModal(rec);
      }
      const di = e.target.closest("[data-del-income]");
      if (di) {
        confirmDialog("Delete this income record? This cannot be undone.", function () {
          deleteIncome(di.getAttribute("data-del-income"));
          toast("Deleted.");
          render();
        });
      }
      const ee = e.target.closest("[data-edit-expense]");
      if (ee) {
        openExpenseModal(
          state.expenses.find(function (x) {
            return x.id === ee.getAttribute("data-edit-expense");
          })
        );
      }
      const de = e.target.closest("[data-del-expense]");
      if (de) {
        confirmDialog("Delete this expense? This cannot be undone.", function () {
          deleteExpense(de.getAttribute("data-del-expense"));
          toast("Deleted.");
          render();
        });
      }
      const ag = e.target.closest("[data-add-save]");
      if (ag) {
        openAddSavings(
          state.savingsGoals.find(function (x) {
            return x.id === ag.getAttribute("data-add-save");
          })
        );
      }
      const eg = e.target.closest("[data-edit-goal]");
      if (eg) {
        openGoalModal(
          state.savingsGoals.find(function (x) {
            return x.id === eg.getAttribute("data-edit-goal");
          })
        );
      }
      const dg = e.target.closest("[data-del-goal]");
      if (dg) {
        confirmDialog("Delete this goal and its savings transactions? This cannot be undone.", function () {
          deleteGoal(dg.getAttribute("data-del-goal"));
          toast("Deleted.");
          render();
        });
      }
      const ev = e.target.closest("[data-edit-inv]");
      if (ev) {
        openInvestModal(
          state.investments.find(function (x) {
            return x.id === ev.getAttribute("data-edit-inv");
          })
        );
      }
      const dv = e.target.closest("[data-del-inv]");
      if (dv) {
        confirmDialog("Delete this investment? This cannot be undone.", function () {
          deleteInvestment(dv.getAttribute("data-del-inv"));
          toast("Deleted.");
          render();
        });
      }
      const sa = e.target.closest("[data-stock-add]");
      if (sa) {
        const sym = sa.getAttribute("data-stock-add");
        const co = HALAL_STOCKS.find(function (s) {
          return s.symbol === sym;
        });
        const q = stockQuotes[sym];
        if (!co) return;
        openInvestModal({
          name: co.name + " (" + co.symbol + ")",
          type: "Stocks",
          entryType: "shares",
          buyPrice: q && q.price ? Math.round(q.price * 100) / 100 : "",
          currentPrice: q && q.price ? Math.round(q.price * 100) / 100 : "",
        });
        return;
      }
      const so = e.target.closest("[data-stock-open]");
      if (so) {
        stockSelected = so.getAttribute("data-stock-open");
        if (currentRoute() === "stocks") renderHalalStocksPage();
      }
      const et = e.target.closest("[data-edit-txn]");
      if (et) editFromTxn(et.getAttribute("data-edit-txn"));
      const dt = e.target.closest("[data-del-txn]");
      if (dt) {
        const t = findTxn(dt.getAttribute("data-del-txn"));
        confirmDialog("Delete this " + (t ? t.type.toLowerCase() : "transaction") + "? This cannot be undone.", function () {
          deleteByTransaction(dt.getAttribute("data-del-txn"));
          toast("Deleted.");
          render();
        });
      }
    });
    $("#setting-currency").addEventListener("change", function () {
      state.settings.currency = $("#setting-currency").value;
      saveState();
      render();
    });
    $("#note-weekly").addEventListener("change", function () {
      state.settings.notifications.weeklyExpenseReminder = $("#note-weekly").checked;
      saveState();
      enableNotificationsIfNeeded();
    });
    $("#note-goals").addEventListener("change", function () {
      state.settings.notifications.goalDateReminder = $("#note-goals").checked;
      saveState();
      enableNotificationsIfNeeded();
    });
    $("#export-data").addEventListener("click", function () {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "savetrack-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Export downloaded");
    });
    $("#reset-data").addEventListener("click", function () {
      openModal(
        "Reset all data",
        '<p>This cannot be undone. Type RESET to confirm.</p><label class="field"><span>Confirmation</span><input id="reset-type" type="text" autocomplete="off" /></label>',
        '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button><button type="button" class="btn btn-danger" id="modal-ok">Reset</button>'
      );
      $("#modal-cancel").onclick = closeModal;
      $("#modal-ok").onclick = function () {
        if ($("#reset-type").value.trim() !== "RESET") {
          toast("Type RESET to confirm.", "err");
          return;
        }
        parseFailed = false;
        state = defaultState();
        saveState();
        closeModal();
        toast("All data cleared");
        location.hash = "#dashboard";
        navigate("dashboard");
      };
    });
    $("#modal-backdrop").addEventListener("click", closeModal);
    $("#modal-x").addEventListener("click", closeModal);
    $("#calc-monthly").addEventListener("submit", function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const inc = Number(fd.get("income")) || 0;
      const exp = Number(fd.get("expenses")) || 0;
      const left = inc - exp;
      const rate = inc > 0 ? ((inc - exp) / inc) * 100 : null;
      const out = $("#calc-monthly-out");
      out.hidden = false;
      out.innerHTML =
        (left < 0
          ? "<span>Estimated overspend</span><strong class=\"amount-neg\">" + money(left) + "</strong>"
          : "<span>Estimated amount left</span><strong class=\"amount-pos\">" + money(left) + "</strong>") +
        "<p>Estimated savings rate: " +
        (rate === null ? "—" : pct(rate)) +
        "</p><p class=\"caption\">Estimate only. Not financial advice.</p>";
    });
    $("#prefill-month").addEventListener("click", function () {
      const m = metrics("month");
      $("#calc-monthly [name=income]").value = m.inc.toFixed(2);
      $("#calc-monthly [name=expenses]").value = m.exp.toFixed(2);
    });
    $("#calc-compound").addEventListener("submit", function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const p = Number(fd.get("principal")) || 0;
      const pmt = Number(fd.get("pmt")) || 0;
      const rate = Number(fd.get("rate"));
      const years = Number(fd.get("years"));
      if (!isFinite(rate) || !years) {
        toast("Enter a rate and years.", "err");
        return;
      }
      const fv = compoundFuture(p, pmt, rate, years);
      const contrib = p + pmt * Math.round(years * 12);
      const out = $("#calc-compound-out");
      out.hidden = false;
      out.innerHTML =
        "<span>Estimated future value</span><strong>" +
        money(fv) +
        "</strong><p>Estimated total contributed: " +
        money(contrib) +
        "</p><p class=\"caption\">Estimate assumes monthly compounding and a constant rate you typed. Real returns vary and can be negative. Not financial advice. Not a prediction of returns.</p>";
    });
    $("#calc-goal").addEventListener("submit", function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const target = Number(fd.get("target")) || 0;
      const saved = Number(fd.get("saved")) || 0;
      const date = String(fd.get("date") || "");
      const months = monthsBetween(todayStr(), date);
      const out = $("#calc-goal-out");
      out.hidden = false;
      if (months < 1) {
        out.innerHTML = '<p class="amount-neg">Choose a target date at least about one month ahead.</p>';
        return;
      }
      const need = Math.max(0, target - saved) / months;
      out.innerHTML =
        "<span>Estimated monthly saving needed</span><strong>" +
        money(need) +
        "</strong><p>About " +
        months.toFixed(1) +
        " months remaining. Remaining: " +
        money(Math.max(0, target - saved)) +
        '</p><p class="caption">Estimate only. Ignores inflation, interest, and income changes. Not financial advice.</p>';
    });
  }

  function readSavedSession() {
    try {
      const fromLocal = localStorage.getItem(SESSION_KEY);
      if (fromLocal) return fromLocal;
      const fromSession = sessionStorage.getItem(SESSION_KEY);
      if (fromSession) {
        localStorage.setItem(SESSION_KEY, fromSession);
        sessionStorage.removeItem(SESSION_KEY);
        return fromSession;
      }
    } catch (e) {
      return "";
    }
    return "";
  }

  function persistSession(username) {
    try {
      localStorage.setItem(SESSION_KEY, username);
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
    dbSet("session", username);
  }

  function clearSavedSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
    dbDelete("session");
  }

  function restoreSession() {
    const saved = String(readSavedSession() || "").trim();
    if (!saved) {
      showAuth();
      return;
    }
    const user = loadAuth().users.find(function (u) {
      return u.username.toLowerCase() === saved.toLowerCase();
    });
    if (!user) {
      clearSavedSession();
      showAuth();
      return;
    }
    enterApp(user.username);
  }

  function showAuth() {
    currentUser = null;
    state = null;
    clearSavedSession();
    document.body.classList.add("is-locked");
    $("#app").hidden = true;
    $("#auth-screen").hidden = false;
    $("#login-err").textContent = "";
    $("#register-err").textContent = "";
    document.documentElement.setAttribute("data-theme", "light");
    applyTheme();
    const users = loadAuth().users;
    setAuthTab(users.length ? "login" : "register");
    const first = $("#form-login [name=username]");
    if (first && !users.length) {
      $("#form-register [name=username]").focus();
    } else if ($("#form-login [name=username]")) {
      $("#form-login [name=username]").focus();
    }
  }

  function setAuthTab(tab) {
    $$("[data-auth-tab]").forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-auth-tab") === tab);
    });
    $("#form-login").hidden = tab !== "login";
    $("#form-register").hidden = tab !== "register";
    $("#auth-heading").textContent = tab === "login" ? "Sign in" : "Create account";
  }

  function enterApp(username) {
    currentUser = username;
    persistSession(username);
    parseFailed = false;
    migrateLegacyIfNeeded(username);
    loadState();
    document.body.classList.remove("is-locked");
    $("#auth-screen").hidden = true;
    $("#app").hidden = false;
    $("#whoami").textContent = username + " · this device only";
    $("#signed-in").textContent = "Signed in as " + username;
    applyTheme();
    navigate(currentRoute());
    maybeNotify();
  }

  function logout() {
    if (state) saveState();
    showAuth();
    $("#form-login").reset();
    $("#form-register").reset();
  }

  function bindAuth() {
    $$("[data-auth-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setAuthTab(btn.getAttribute("data-auth-tab"));
      });
    });
    $("#form-login").addEventListener("submit", function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = String(fd.get("username") || "").trim();
      const password = String(fd.get("password") || "");
      const err = $("#login-err");
      err.textContent = "";
      const user = loadAuth().users.find(function (u) {
        return u.username.toLowerCase() === username.toLowerCase();
      });
      if (!user) {
        err.textContent = "No account with that username on this device.";
        return;
      }
      hashPassword(password, user.salt).then(function (result) {
        if (result.hash !== user.hash) {
          err.textContent = "Username or password is incorrect.";
          return;
        }
        enterApp(user.username);
      }).catch(function () {
        err.textContent = "This browser cannot check the password. Open SaveTrack over http://localhost or a normal https site.";
      });
    });
    $("#form-register").addEventListener("submit", function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = String(fd.get("username") || "").trim();
      const password = String(fd.get("password") || "");
      const confirm = String(fd.get("confirm") || "");
      const err = $("#register-err");
      err.textContent = "";
      if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
        err.textContent = "Username must be 3–24 letters, numbers, or underscores.";
        return;
      }
      if (password.length < 4) {
        err.textContent = "Use at least 4 characters. Do not reuse a bank password.";
        return;
      }
      if (password !== confirm) {
        err.textContent = "Passwords do not match.";
        return;
      }
      const auth = loadAuth();
      const taken = auth.users.some(function (u) {
        return u.username.toLowerCase() === username.toLowerCase();
      });
      if (taken) {
        err.textContent = "That username already exists on this device.";
        return;
      }
      hashPassword(password).then(function (result) {
        auth.users.push({
          username: username,
          salt: result.salt,
          hash: result.hash,
          createdAt: nowIso(),
        });
        saveAuth(auth);
        enterApp(username);
      }).catch(function () {
        err.textContent = "This browser cannot create a password lock. Use Chrome or Edge with a local server (not a restricted file page).";
      });
    });
    $("#logout-btn").addEventListener("click", logout);
    $("#logout-btn-2").addEventListener("click", logout);
  }

  bind();
  bindAuth();
  document.documentElement.setAttribute("data-theme", "light");

  function flushSave() {
    if (currentUser && state && !parseFailed) saveState();
  }

  window.addEventListener("pagehide", flushSave);
  window.addEventListener("beforeunload", flushSave);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushSave();
  });

  openDatabase()
    .then(function () {
      return hydrateDatabase();
    })
    .then(function () {
      restoreSession();
    })
    .catch(function () {
      restoreSession();
    });
})();
