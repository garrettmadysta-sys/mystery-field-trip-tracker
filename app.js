/* Mystery Field Trip Tracker
   - Local-only storage
   - No AR quiz questions/answers: logs results only
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const STORAGE_KEY = "mystery_trip_tracker_v1";

const defaultState = {
  goalPages: 36,
  deadline: "", // YYYY-MM-DD
  passThreshold: 80,
  boxCost: 25,
  pin: "1234",
  rewards: [
    "Pick dessert 🍨",
    "15 minutes extra screen time 🎮",
    "Choose the family movie 🎬",
    "Stay up 15 minutes later ⏰",
    "Pick dinner helper job 🍝",
    "Trip to the park 🌳",
    "Build something with LEGOs 🧱",
    "Hot chocolate time ☕"
  ],
  sprints: [], // {id, date, pages}
  arTests: [], // {id, date, book, score, passed}
  pendingRewards: [], // {id, date, text, status:"pending"|"approved"}
  points: 0,
  lastSprintDate: "", // YYYY-MM-DD
  streak: 0,
  unlocked: {12:false, 24:false, 36:false}
};

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaultState), ...parsed };
  }catch{
    return structuredClone(defaultState);
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayISO(){
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0,10);
}

function daysUntil(deadlineISO){
  if(!deadlineISO) return null;
  const now = new Date();
  const d = new Date(deadlineISO + "T23:59:59");
  const ms = d - now;
  return Math.ceil(ms / (1000*60*60*24));
}

function computePagesRead(){
  return state.sprints.reduce((sum, s) => sum + Number(s.pages || 0), 0);
}

function computeARCounts(){
  const attempts = state.arTests.length;
  const passed = state.arTests.filter(t => t.passed).length;
  return { attempts, passed };
}

function setDefaultDates(){
  const t = todayISO();
  $("#sprintDate").value = t;
  $("#arDate").value = t;
}

function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

function maybeUpdateStreak(sprintDateISO){
  const last = state.lastSprintDate;
  if(!last){
    state.streak = 1;
  }else{
    const lastD = new Date(last + "T00:00:00");
    const curD  = new Date(sprintDateISO + "T00:00:00");
    const diffDays = Math.round((curD - lastD)/(1000*60*60*24));
    if(diffDays === 0){
      // same day: no streak change
    }else if(diffDays === 1){
      state.streak += 1;
      state.points += 5; // streak bonus
    }else{
      state.streak = 1;
    }
  }
  state.lastSprintDate = sprintDateISO;
}

function unlockMilestonesIfNeeded(){
  const pagesRead = computePagesRead();
  const milestones = [12,24,36];
  for(const m of milestones){
    const key = String(m);
    if(!state.unlocked[key] && pagesRead >= m){
      state.unlocked[key] = true;
      launchConfetti();
    }
  }
}

function pagesPerDayNeeded(){
  const remaining = Math.max(0, state.goalPages - computePagesRead());
  const days = daysUntil(state.deadline);
  if(days === null) return "—";
  if(days <= 0) return remaining === 0 ? "0" : String(remaining);
  return String(Math.ceil(remaining / days));
}

/* ---------------- Confetti (simple canvas particles) ---------------- */
let confettiRunning = false;
function launchConfetti(){
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;

  const count = 160;
  const parts = Array.from({length: count}, () => ({
    x: Math.random()*W,
    y: -20 - Math.random()*H*0.4,
    vx: -2 + Math.random()*4,
    vy: 2 + Math.random()*5,
    r: 3 + Math.random()*4,
    a: Math.random()*Math.PI*2,
    va: -0.2 + Math.random()*0.4
  }));

  const endAt = performance.now() + 1400;
  confettiRunning = true;

  function tick(t){
    if(!confettiRunning) return;
    ctx.clearRect(0,0,W,H);
    for(const p of parts){
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      p.vy += 0.03; // gravity
      if(p.y > H+40) p.y = -20;
      // draw (no fixed colors requested? These are default choices; keep simple)
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fillRect(-p.r, -p.r, p.r*2, p.r*2);
      ctx.restore();
    }
    if(t < endAt) requestAnimationFrame(tick);
    else{
      confettiRunning = false;
      ctx.clearRect(0,0,W,H);
    }
  }
  requestAnimationFrame(tick);
}

/* ---------------- Rendering ---------------- */
function renderProgress(){
  const read = computePagesRead();
  const goal = state.goalPages;
  const remaining = Math.max(0, goal - read);
  const pct = goal ? clamp((read/goal)*100, 0, 100) : 0;

  $("#pagesRead").textContent = String(read);
  $("#pagesGoal").textContent = String(goal);
  $("#pagesRemaining").textContent = String(remaining);
  $("#progressFill").style.width = pct + "%";
  $(".progressbar").setAttribute("aria-valuenow", String(Math.round(pct)));

  $("#deadlinePill").textContent = state.deadline ? `Deadline: ${state.deadline}` : "Deadline: —";
  $("#perDay").textContent = pagesPerDayNeeded();
  $("#streak").textContent = `${state.streak} 🔥`;
  $("#points").textContent = `${state.points} ⭐`;

  const b12 = $("#badge12");
  const b24 = $("#badge24");
  const b36 = $("#badge36");
  b12.classList.toggle("unlocked", !!state.unlocked["12"]);
  b24.classList.toggle("unlocked", !!state.unlocked["24"]);
  b36.classList.toggle("unlocked", !!state.unlocked["36"]);
}

function renderSprints(){
  const el = $("#sprintList");
  el.innerHTML = "";
  const items = [...state.sprints].sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  if(items.length === 0){
    el.innerHTML = `<div class="hint">No sprints yet. Add one above to start your mission!</div>`;
    return;
  }
  for(const s of items){
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div>
        <strong>${s.pages} pages</strong>
        <div class="meta">${s.date}</div>
      </div>
      <button class="btn btn-ghost" data-del-sprint="${s.id}" type="button">Delete</button>
    `;
    el.appendChild(row);
  }
}

function renderAR(){
  const {attempts, passed} = computeARCounts();
  $("#attemptCount").textContent = `${attempts} 📚`;
  $("#passedCount").textContent = `${passed} ✅`;
  $("#passThresholdText").textContent = `${state.passThreshold}%`;

  const el = $("#arList");
  el.innerHTML = "";
  const items = [...state.arTests].sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  if(items.length === 0){
    el.innerHTML = `<div class="hint">No AR tests logged yet. Log one after you finish a book or section.</div>`;
    return;
  }
  for(const t of items){
    const tag = t.passed ? `<span class="tag pass">PASS</span>` : `<span class="tag fail">TRY AGAIN</span>`;
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(t.book)}</strong>
        <div class="meta">${t.date} • Score: ${t.score}%</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        ${tag}
        <button class="btn btn-ghost" data-del-ar="${t.id}" type="button">Delete</button>
      </div>
    `;
    el.appendChild(row);
  }
}

function renderRewards(){
  $("#boxCostText").textContent = String(state.boxCost);

  const el = $("#rewardList");
  el.innerHTML = "";

  const pending = state.pendingRewards.filter(r => r.status === "pending");
  const approved = state.pendingRewards.filter(r => r.status === "approved");

  const makeRow = (label, tagText) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(label)}</strong>
        <div class="meta">${tagText}</div>
      </div>
      <span class="tag">${tagText.includes("Pending") ? "PENDING" : "APPROVED"}</span>
    `;
    return row;
  };

  // Show rewards list (configurable) plus pending/approved history
  const listHeader = document.createElement("div");
  listHeader.className = "hint";
  listHeader.textContent = "Rewards you can win (Parent can edit):";
  el.appendChild(listHeader);

  state.rewards.forEach((r) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div><strong>${escapeHtml(r)}</strong><div class="meta">In the Mystery Box pool 🎁</div></div><span class="tag">REWARD</span>`;
    el.appendChild(row);
  });

  const sep = document.createElement("div");
  sep.className = "hint";
  sep.style.marginTop = "10px";
  sep.textContent = "Mystery Box history:";
  el.appendChild(sep);

  if(state.pendingRewards.length === 0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No Mystery Boxes opened yet.";
    el.appendChild(empty);
    return;
  }

  pending.forEach(p => el.appendChild(makeRow(p.text, `Pending parent approval • ${p.date}`)));
  approved.forEach(a => el.appendChild(makeRow(a.text, `Approved • ${a.date}`)));
}

function renderBackup(){
  $("#exportArea").value = "";
}

function renderAll(){
  renderProgress();
  renderSprints();
  renderAR();
  renderRewards();
  renderBackup();
  // Parent settings text updates
  $("#passThresholdText").textContent = `${state.passThreshold}%`;
}

/* ---------------- Events ---------------- */
function setupTabs(){
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");

      $$(".panel").forEach(p => p.classList.remove("is-active"));
      $("#tab-" + btn.dataset.tab).classList.add("is-active");
    });
  });
}

function setupSprintForm(){
  $("#sprintForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = $("#sprintDate").value || todayISO();
    const pages = Number($("#sprintPages").value);
    if(!Number.isFinite(pages) || pages <= 0) return;

    state.sprints.push({ id: uid(), date, pages });
    state.points += pages; // 1 point per page
    maybeUpdateStreak(date);
    unlockMilestonesIfNeeded();

    $("#sprintPages").value = "";
    saveState();
  });

  $("#sprintList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del-sprint]");
    if(!btn) return;
    const id = btn.getAttribute("data-del-sprint");
    const sprint = state.sprints.find(s => s.id === id);
    if(!sprint) return;

    // Remove and subtract points for those pages (keep it simple)
    state.sprints = state.sprints.filter(s => s.id !== id);
    state.points = Math.max(0, state.points - Number(sprint.pages || 0));
    saveState();
  });

  $("#clearSprints").addEventListener("click", () => {
    if(!confirm("Clear all reading sprints?")) return;
    state.sprints = [];
    state.unlocked = {"12":false,"24":false,"36":false};
    state.streak = 0;
    state.lastSprintDate = "";
    saveState();
  });
}

function setupARForm(){
  $("#arForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = $("#arDate").value || todayISO();
    const book = $("#arBook").value.trim();
    const score = Number($("#arScore").value);
    if(!book) return;
    if(!Number.isFinite(score)) return;

    const passed = score >= state.passThreshold;
    state.arTests.push({ id: uid(), date, book, score, passed });
    if(passed) state.points += 20;

    $("#arBook").value = "";
    $("#arScore").value = "";
    if(passed) launchConfetti();
    saveState();
  });

  $("#arList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del-ar]");
    if(!btn) return;
    const id = btn.getAttribute("data-del-ar");
    const test = state.arTests.find(t => t.id === id);
    if(!test) return;

    state.arTests = state.arTests.filter(t => t.id !== id);
    if(test.passed) state.points = Math.max(0, state.points - 20);
    saveState();
  });

  $("#clearAR").addEventListener("click", () => {
    if(!confirm("Clear all AR test logs?")) return;
    state.arTests = [];
    saveState();
  });
}

function setupRewards(){
  $("#openBox").addEventListener("click", () => {
    const cost = Number(state.boxCost || 25);
    if(state.points < cost){
      $("#rewardResult").textContent = `Not enough points yet! You need ${cost - state.points} more ⭐`;
      return;
    }
    if(!state.rewards.length){
      $("#rewardResult").textContent = `No rewards set. Ask a parent to add some in Parent Mode.`;
      return;
    }
    state.points -= cost;
    const pick = state.rewards[Math.floor(Math.random()*state.rewards.length)];
    const entry = { id: uid(), date: todayISO(), text: pick, status: "pending" };
    state.pendingRewards.unshift(entry);
    $("#rewardResult").textContent = `🎁 You won: ${pick} (Pending parent approval)`;
    launchConfetti();
    saveState();
  });

  $("#approveAll").addEventListener("click", () => {
    // This should ideally be in Parent Mode, but keeping it easy:
    const hasPending = state.pendingRewards.some(r => r.status === "pending");
    if(!hasPending){
      $("#rewardResult").textContent = "No pending rewards right now.";
      return;
    }
    if(!confirm("Mark ALL pending rewards as approved?")) return;
    state.pendingRewards = state.pendingRewards.map(r => r.status === "pending" ? {...r, status:"approved"} : r);
    $("#rewardResult").textContent = "✅ Pending rewards approved!";
    saveState();
  });
}

function setupBackup(){
  $("#exportBtn").addEventListener("click", async () => {
    const data = JSON.stringify(state, null, 2);
    $("#exportArea").value = data;

    // Attempt copy for convenience
    try{
      await navigator.clipboard.writeText(data);
    }catch{ /* ignore */ }
  });

  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    try{
      const parsed = JSON.parse(text);
      state = { ...structuredClone(defaultState), ...parsed };
      saveState();
      alert("Imported!");
    }catch{
      alert("That file didn't look like valid JSON export data.");
    }finally{
      e.target.value = "";
    }
  });
}

function setupParentMode(){
  const dialog = $("#parentDialog");

  $("#parentBtn").addEventListener("click", () => {
    // reset view
    $("#pinStep").classList.remove("hidden");
    $("#settingsStep").classList.add("hidden");
    $("#pinInput").value = "";
    dialog.showModal();
  });

  $("#unlockBtn").addEventListener("click", () => {
    const pin = $("#pinInput").value.trim();
    if(pin !== String(state.pin || "1234")){
      alert("Wrong PIN.");
      return;
    }
    // populate settings
    $("#setGoal").value = state.goalPages;
    $("#setDeadline").value = state.deadline;
    $("#setPass").value = state.passThreshold;
    $("#setBoxCost").value = state.boxCost;
    $("#setPin").value = "";
    $("#setRewards").value = state.rewards.join("\n");

    $("#pinStep").classList.add("hidden");
    $("#settingsStep").classList.remove("hidden");
  });

  $("#saveSettings").addEventListener("click", () => {
    const goal = Number($("#setGoal").value);
    const deadline = $("#setDeadline").value;
    const pass = Number($("#setPass").value);
    const boxCost = Number($("#setBoxCost").value);
    const newPin = $("#setPin").value.trim();

    if(Number.isFinite(goal) && goal > 0) state.goalPages = Math.floor(goal);
    state.deadline = deadline || "";
    state.passThreshold = clamp(pass || 80, 0, 100);
    state.boxCost = clamp(boxCost || 25, 1, 500);

    const rewardsText = $("#setRewards").value.trim();
    state.rewards = rewardsText ? rewardsText.split("\n").map(s => s.trim()).filter(Boolean) : [];

    if(newPin) state.pin = newPin;

    saveState();
    alert("Saved!");
  });

  $("#lockBtn").addEventListener("click", () => {
    dialog.close();
  });
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------------- Service Worker ---------------- */
function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try{
      await navigator.serviceWorker.register("./service-worker.js");
    }catch{
      // ignore
    }
  });
}

/* ---------------- Init ---------------- */
let state = loadState();

function init(){
  setupTabs();
  setDefaultDates();
  setupSprintForm();
  setupARForm();
  setupRewards();
  setupBackup();
  setupParentMode();
  registerSW();

  // helpful defaults
  if(!state.deadline){
    // set a default deadline 7 days from today (easy starting point)
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60 * 1000);
    state.deadline = local.toISOString().slice(0,10);
    saveState();
  }else{
    renderAll();
  }

  unlockMilestonesIfNeeded();
  renderAll();
}

init();
