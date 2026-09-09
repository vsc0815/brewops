// BrewOps frontend — vanilla JS, no dependencies, no build step.

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

// ---- dashboard ----

function renderDrinkBars(perDrink) {
  const container = document.getElementById("drink-bars");
  container.innerHTML = "";
  const max = Math.max(1, ...perDrink.map((d) => d.count));
  for (const drink of perDrink) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = drinkLabel(drink.name, drink.label);

    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.width = `${(drink.count / max) * 100}%`;
    track.appendChild(fill);

    const count = document.createElement("span");
    count.className = "bar-count";
    count.textContent = drink.count;

    row.append(label, track, count);
    container.appendChild(row);
  }
}

function renderTimeline(perDay) {
  const svg = document.getElementById("timeline");
  svg.innerHTML = "";
  if (perDay.length === 0) return;
  const width = 600;
  const height = 130;
  const max = Math.max(...perDay.map((d) => d.count));
  const barWidth = width / perDay.length;
  perDay.forEach((day, i) => {
    const barHeight = (day.count / max) * (height - 10);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", i * barWidth);
    rect.setAttribute("y", height - barHeight);
    rect.setAttribute("width", Math.max(0.5, barWidth - 0.6));
    rect.setAttribute("height", barHeight);
    rect.setAttribute("class", "timeline-bar");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = t("tooltip_day", { day: day.day, n: day.count });
    rect.appendChild(title);
    svg.appendChild(rect);
  });
}

function renderMachineCards(healths) {
  const container = document.getElementById("machine-cards");
  container.innerHTML = "";
  for (const m of healths) {
    const card = document.createElement("div");
    card.className = "card";

    const maintenance = m.last_maintenance
      ? t("maintenance_on", {
          type: maintenanceLabel(m.last_maintenance.type),
          date: m.last_maintenance.timestamp.slice(0, 10),
        })
      : t("no_maintenance_on_record");

    const name = document.createElement("h3");
    name.textContent = m.name;

    const badge = document.createElement("p");
    badge.className = "badge";
    badge.textContent = m.has_telemetry ? t("telemetry") : t("manual_log");

    const brewLine = document.createElement("p");
    brewLine.textContent = t("brews_last_suffix", {
      n: m.brew_count,
      when: m.last_brew ? m.last_brew.slice(0, 16) : t("never"),
    });

    const maintenanceLine = document.createElement("p");
    maintenanceLine.textContent = t("last_maintenance_prefix", { v: maintenance });

    card.append(name, badge, brewLine, maintenanceLine);

    if (m.recent_errors.length) {
      const errorsLine = document.createElement("p");
      errorsLine.className = "errors";
      const summary = m.recent_errors
        .map((e) => `${e.error_code || "?"} (${e.timestamp.slice(0, 10)})`)
        .join(", ");
      errorsLine.textContent = t("recent_errors_prefix", { v: summary });
      card.appendChild(errorsLine);
    }

    container.appendChild(card);
  }
}

let lastStats = null;
let lastHealths = null;

async function loadDashboard() {
  const stats = await fetchJSON("/api/stats");
  lastStats = stats;
  document.getElementById("total-brews").textContent = stats.total_brews;
  const lastDay = stats.per_day[stats.per_day.length - 1];
  document.getElementById("brews-today").textContent = lastDay ? lastDay.count : 0;
  renderDrinkBars(stats.per_drink);
  renderTimeline(stats.per_day);

  const machines = await fetchJSON("/api/machines");
  document.getElementById("machine-count").textContent = machines.length;
  const healths = await Promise.all(machines.map((m) => fetchJSON(`/api/machines/${m.id}`)));
  lastHealths = healths;
  renderMachineCards(healths);
}

function rerenderDashboard() {
  if (lastStats) {
    renderDrinkBars(lastStats.per_drink);
    renderTimeline(lastStats.per_day);
  }
  if (lastHealths) renderMachineCards(lastHealths);
}

// ---- forms ----

function localNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16); // datetime-local format
}

function fillSelect(select, items, valueKey, labelKey, transform) {
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item[valueKey];
    option.textContent = transform ? transform(item) : item[labelKey];
    select.appendChild(option);
  }
}

let lastDrinks = null;

function refillDrinkSelect() {
  if (!lastDrinks) return;
  fillSelect(document.getElementById("brew-drink"), lastDrinks, "name", "label", (d) => drinkLabel(d.name, d.label));
}

async function setupForms() {
  const machines = await fetchJSON("/api/machines");
  const drinks = await fetchJSON("/api/drink-types");
  lastDrinks = drinks;
  fillSelect(document.getElementById("brew-machine"), machines, "id", "name");
  refillDrinkSelect();
  fillSelect(document.getElementById("maintenance-machine"), machines, "id", "name");
  document.getElementById("brew-timestamp").value = localNow();
  document.getElementById("maintenance-timestamp").value = localNow();

  document.getElementById("brew-form").addEventListener("submit", (event) =>
    submitForm(event, "/api/brews", "brew-message", () => ({
      machine_id: Number(document.getElementById("brew-machine").value),
      drink_type: document.getElementById("brew-drink").value,
      timestamp: document.getElementById("brew-timestamp").value,
    }))
  );

  document.getElementById("maintenance-form").addEventListener("submit", (event) =>
    submitForm(event, "/api/maintenance", "maintenance-message", () => ({
      machine_id: Number(document.getElementById("maintenance-machine").value),
      type: document.getElementById("maintenance-type").value,
      timestamp: document.getElementById("maintenance-timestamp").value,
      note: document.getElementById("maintenance-note").value || null,
    }))
  );
}

async function submitForm(event, url, messageId, buildPayload) {
  event.preventDefault();
  const message = document.getElementById(messageId);
  message.textContent = "";
  message.className = "message";
  try {
    await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    message.textContent = t("logged_ok");
    message.classList.add("ok");
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
}

loadDashboard().catch((error) => {
  document.getElementById("total-brews").textContent = "!";
  console.error("Dashboard failed to load:", error);
});
setupForms().catch((error) => console.error("Form setup failed:", error));
