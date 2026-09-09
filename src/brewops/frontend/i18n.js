// BrewOps i18n — flat dictionary, no build step, no dependencies.

const TRANSLATIONS = {
  en: {
    tagline: "Office coffee fleet — telemetry & operations",
    tile_total_brews: "brews total",
    tile_brews_today: "brews on last active day",
    tile_machines: "machines",
    hdg_per_drink: "Per drink",
    hdg_brews_over_time: "Brews over time",
    hdg_machines: "Machines",
    hdg_log_brew: "Log a brew",
    hdg_log_maintenance: "Log maintenance",
    hint_log_brew: "For machines that don't report their own events — looking at you, Old Faithful.",
    label_machine: "Machine",
    label_drink: "Drink",
    label_when: "When",
    label_note: "Note",
    label_type: "Type",
    btn_log_brew: "Log brew",
    btn_log_maintenance: "Log maintenance",
    placeholder_note: "optional",
    aria_timeline: "Brews per day",
    opt_descale: "Descale",
    opt_refill: "Refill",
    opt_repair: "Repair",
    opt_error: "Error",
    telemetry: "telemetry",
    manual_log: "manual log",
    never: "never",
    no_maintenance_on_record: "none on record",
    last_maintenance_prefix: "Last maintenance: {v}",
    maintenance_on: "{type} on {date}",
    recent_errors_prefix: "Recent errors: {v}",
    brews_last_suffix: "{n} brews · last {when}",
    tooltip_day: "{day}: {n} brews",
    logged_ok: "Logged.",
  },
  zh: {
    tagline: "办公室咖啡机队 — 遥测与运维",
    tile_total_brews: "总冲煮次数",
    tile_brews_today: "最近活跃日冲煮次数",
    tile_machines: "咖啡机数量",
    hdg_per_drink: "按饮品统计",
    hdg_brews_over_time: "冲煮趋势",
    hdg_machines: "咖啡机",
    hdg_log_brew: "记录冲煮",
    hdg_log_maintenance: "记录维护",
    hint_log_brew: "适用于不会自动上报数据的咖啡机 —— 说的就是 Old Faithful。",
    label_machine: "咖啡机",
    label_drink: "饮品",
    label_when: "时间",
    label_note: "备注",
    label_type: "类型",
    btn_log_brew: "提交冲煮记录",
    btn_log_maintenance: "提交维护记录",
    placeholder_note: "选填",
    aria_timeline: "每日冲煮次数",
    opt_descale: "除垢",
    opt_refill: "补充耗材",
    opt_repair: "维修",
    opt_error: "故障",
    telemetry: "遥测上报",
    manual_log: "手动记录",
    never: "从未",
    no_maintenance_on_record: "暂无记录",
    last_maintenance_prefix: "最近维护：{v}",
    maintenance_on: "{type}（{date}）",
    recent_errors_prefix: "近期故障：{v}",
    brews_last_suffix: "{n} 次冲煮 · 最近 {when}",
    tooltip_day: "{day}：{n} 次冲煮",
    logged_ok: "已记录。",
  },
};

// DB-sourced enum -> display label, keyed by machine-readable value (never displayed as-is).
const MAINTENANCE_LABELS = {
  en: { descale: "Descale", refill: "Refill", repair: "Repair", error: "Error" },
  zh: { descale: "除垢", refill: "补充耗材", repair: "维修", error: "故障" },
};

// Drink display-name overrides. Kept in English for both languages, per product
// decision (drink names read as product names, not translated menu copy).
// Set to true and fill in DRINK_LABELS_ZH to switch this on later.
const TRANSLATE_DRINK_NAMES = false;
const DRINK_LABELS_ZH = {};

let currentLang = localStorage.getItem("brewops-lang") === "zh" ? "zh" : "en";

function t(key, vars) {
  let s = (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || TRANSLATIONS.en[key] || key;
  if (vars) {
    for (const k in vars) {
      s = s.replace(`{${k}}`, vars[k]);
    }
  }
  return s;
}

function maintenanceLabel(type) {
  return (MAINTENANCE_LABELS[currentLang] || MAINTENANCE_LABELS.en)[type] || type;
}

function drinkLabel(name, apiLabel) {
  if (TRANSLATE_DRINK_NAMES && currentLang === "zh" && DRINK_LABELS_ZH[name]) {
    return DRINK_LABELS_ZH[name];
  }
  return apiLabel;
}

function applyTranslations() {
  document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === currentLang);
  });
}

function setLang(lang) {
  currentLang = lang === "zh" ? "zh" : "en";
  localStorage.setItem("brewops-lang", currentLang);
  applyTranslations();
  if (typeof rerenderDashboard === "function") rerenderDashboard();
  if (typeof refillDrinkSelect === "function") refillDrinkSelect();
}

document.addEventListener("DOMContentLoaded", () => {
  applyTranslations();
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  });
});
