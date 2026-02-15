/* Eli's Mystery Field Trip Tracker */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const STORAGE_KEY = "eli_trip_tracker_v2";

const defaultState = {
  dailyTarget: 36, deadline: "", totalGoal: 0, passThreshold: 80, arRequired: 0,
  pin: "1234",
  boxCosts: { treats: 12, mom: 25, dad: 25 },
  rewards: {
    treats: ["Sucker 🍭","Pick the snack 🍿","Choose the music during reading 🎵","Blanket fort reading 🏕️","Sticker / small prize ⭐","10 min YouTube (approved) 📺","10 min Nintendo 🎮","Dad/Mom tells a funny story 😂","2-minute victory dance break 💃"],
    mom: ["15 min Mom time (no distractions) 💛","Mom + you pick 3 YouTube videos and watch together 📺","Mom plays a game with you (your choice) 🎲","Mom helps you build something small 🧱","Mom walk + treat 🚶‍♀️🍦"],
    dad: ["15 min Dad time (no distractions) 🎮","VR mission with Dad 🥽","Nintendo boss battle with Dad 👾","CrunchLabs bonus build with Dad 🔧","Coding jam with Dad (Scratch / build step) 💻"]
  },
  /* Pre-loaded: Eli read 13 pages on Feb 14 and 6 pages on Feb 15 morning */
  sprints: [
    { id: "eli_feb14a", date: "2026-02-14", pages: 13 },
    { id: "eli_feb15a", date: "2026-02-15", pages: 6 }
  ],
  arTests: [],
  wonRewards: [],
  points: 19, /* 13 + 6 = 19 points from pages */
  lastSprintDate: "2026-02-15",
  streak: 2, /* read yesterday and today = 2 day streak */
  milestonesUnlocked: {},
  dailyBonuses: {}
};

let state;
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const p = JSON.parse(raw);
    const m = structuredClone(defaultState);
    Object.assign(m, p);
    m.boxCosts = { ...defaultState.boxCosts, ...(p.boxCosts || {}) };
    m.rewards = { treats: p.rewards?.treats || defaultState.rewards.treats, mom: p.rewards?.mom || defaultState.rewards.mom, dad: p.rewards?.dad || defaultState.rewards.dad };
    m.milestonesUnlocked = p.milestonesUnlocked || {};
    m.dailyBonuses = p.dailyBonuses || {};
    return m;
  } catch { return structuredClone(defaultState); }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); renderAll(); }
function uid() { return Math.random().toString(36).slice(2,8) + Date.now().toString(36); }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function daysLeft() { if (!state.deadline) return null; return Math.max(0, Math.ceil((new Date(state.deadline+"T23:59:59") - new Date()) / 86400000)); }
function esc(s) { const e = document.createElement("span"); e.textContent = String(s); return e.innerHTML; }

function totalRead() { return state.sprints.reduce((s,x) => s + (Number(x.pages)||0), 0); }
function todayRead() { const t = todayISO(); return state.sprints.filter(s=>s.date===t).reduce((s,x) => s + (Number(x.pages)||0), 0); }
function effectiveGoal() { if (state.totalGoal > 0) return state.totalGoal; const d = daysLeft(); return (d !== null && d > 0) ? state.dailyTarget * d + totalRead() : 0; }
function perDay() { const r = Math.max(0, effectiveGoal() - totalRead()); const d = daysLeft(); return (d === null || d <= 0) ? state.dailyTarget : Math.ceil(r / d); }
function arPassed() { return state.arTests.filter(t=>t.passed).length; }

function getMilestones() {
  const dt = state.dailyTarget || 36;
  const targets = [dt, dt*3, dt*7];
  const g = effectiveGoal();
  if (g > 0 && !targets.includes(g)) targets.push(g);
  return [...new Set(targets)].sort((a,b)=>a-b).slice(0,5).map(p => ({ pages:p, label: p>=1000 ? (p/1000).toFixed(1)+"k" : String(p), unlocked: !!state.milestonesUnlocked[String(p)] }));
}

function updateStreak(d) {
  const last = state.lastSprintDate;
  if (!last) { state.streak = 1; }
  else {
    const diff = Math.round((new Date(d+"T00:00:00") - new Date(last+"T00:00:00")) / 86400000);
    if (diff === 0) return;
    else if (diff === 1) { state.streak += 1; state.points += 5; }
    else state.streak = 1;
  }
  state.lastSprintDate = d;
}

function checkMilestones() {
  const r = totalRead(); let fired = false;
  for (const m of getMilestones()) {
    const k = String(m.pages);
    if (!state.milestonesUnlocked[k] && r >= m.pages) { state.milestonesUnlocked[k] = true; fired = true; }
  }
  if (fired) launchConfetti();
}

function checkDailyBonus(d) {
  const dp = state.sprints.filter(s=>s.date===d).reduce((s,x)=>s+(Number(x.pages)||0),0);
  if (dp >= state.dailyTarget && !state.dailyBonuses[d]) { state.dailyBonuses[d] = true; state.points += 10; }
}

/* === CONFETTI === */
let confettiOn = false;
function launchConfetti() {
  const c = $("#confetti"), ctx = c.getContext("2d");
  c.width = window.innerWidth; c.height = window.innerHeight;
  const W=c.width, H=c.height;
  const colors = ["#5eabff","#4ade80","#fbbf24","#fb7185","#a78bfa","#fff","#f472b6","#22d3ee"];
  const ps = Array.from({length:140}, () => ({
    x:Math.random()*W, y:-10-Math.random()*H*.3, vx:-3+Math.random()*6, vy:3+Math.random()*5,
    sz:4+Math.random()*6, col:colors[Math.floor(Math.random()*colors.length)],
    rot:Math.random()*Math.PI*2, rs:-0.2+Math.random()*0.4, sh:Math.random()>.5?"r":"c"
  }));
  const end = performance.now()+2000; confettiOn = true;
  function frame(t) {
    if (!confettiOn) return;
    ctx.clearRect(0,0,W,H);
    for (const p of ps) {
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.04; p.rot+=p.rs;
      if (p.y>H+20) p.y=-10;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillStyle=p.col;
      if (p.sh==="r") ctx.fillRect(-p.sz/2,-p.sz/2,p.sz,p.sz*.6);
      else { ctx.beginPath(); ctx.arc(0,0,p.sz/2,0,Math.PI*2); ctx.fill(); }
      ctx.restore();
    }
    if (t<end) requestAnimationFrame(frame); else { confettiOn=false; ctx.clearRect(0,0,W,H); }
  }
  requestAnimationFrame(frame);
}

/* === TIMER === */
let timerInt = null, timerSec = 600, timerTot = 600, timerOn = false, selMin = 10;
const CIRC = 2 * Math.PI * 90;
const msgs = ["You're doing amazing, Eli! 🌟","Keep going, detective! 🕵️","Almost there! 💪","You've got this! 🔥","Reading superstar! ⭐","One page at a time! 📖","You're crushing it! 🏆","So close to the trip! 🚌","Mystery awaits! 🗺️","Pages = points = prizes! 🎁"];

function updateTimer() {
  const m = Math.floor(timerSec/60), s = timerSec%60;
  $("#timerText").textContent = `${m}:${s.toString().padStart(2,"0")}`;
  const prog = timerTot>0 ? (timerTot-timerSec)/timerTot : 0;
  $("#timerRing").style.strokeDasharray = CIRC;
  $("#timerRing").style.strokeDashoffset = CIRC*(1-prog);
  $("#timerRing").style.stroke = timerSec<=30 ? "#fb7185" : timerSec<=60 ? "#fbbf24" : "#5eabff";
}

function startTimer() {
  if (timerOn) return;
  timerSec = selMin*60; timerTot = timerSec; timerOn = true;
  $("#timerStartBtn").classList.add("hidden");
  $("#timerStopBtn").classList.remove("hidden");
  $("#timerDoneSection").classList.add("hidden");
  let mi = Math.floor(Math.random()*msgs.length);
  $("#timerMessage").textContent = msgs[mi];
  updateTimer();
  timerInt = setInterval(() => {
    timerSec--;
    if (timerSec<=0) { timerSec=0; stopTimer(true); return; }
    updateTimer();
    if (timerSec%30===0) { mi=(mi+1)%msgs.length; $("#timerMessage").textContent=msgs[mi]; }
  }, 1000);
}

function stopTimer(done) {
  clearInterval(timerInt); timerInt=null; timerOn=false;
  $("#timerStartBtn").classList.remove("hidden");
  $("#timerStopBtn").classList.add("hidden");
  if (done) {
    $("#timerMessage").textContent = "🔔 Time's up! Great job Eli!";
    $("#timerDoneSection").classList.remove("hidden");
    launchConfetti();
    if (navigator.vibrate) navigator.vibrate([200,100,200]);
  } else {
    $("#timerMessage").textContent = "Ready when you are, Eli! 📚";
    timerSec=selMin*60; timerTot=timerSec; updateTimer();
  }
}

/* === RENDER === */
function renderMission() {
  const done = todayRead(), tgt = state.dailyTarget, rem = Math.max(0,tgt-done);
  $("#missionTarget").innerHTML = `Read <strong>${tgt} pages</strong> today`;
  $("#missionDone").textContent = `${done} done`;
  $("#missionRemaining").textContent = rem>0 ? `${rem} to go` : "✅ Target hit!";
  const b = $("#missionBanner");
  if (done>=tgt) { b.style.borderColor="rgba(74,222,128,.3)"; b.style.background="linear-gradient(135deg,rgba(74,222,128,.12),rgba(94,171,255,.06))"; }
  else { b.style.borderColor="rgba(94,171,255,.15)"; b.style.background="linear-gradient(135deg,rgba(94,171,255,.12),rgba(74,222,128,.08))"; }
}

function renderProgress() {
  const r=totalRead(), g=effectiveGoal();
  $("#totalPagesRead").textContent = r;
  if (g>0) { $("#totalPagesGoalLabel").textContent=`Goal: ${g}`; $("#totalProgressFill").style.width=Math.min(100,r/g*100)+"%"; }
  else { $("#totalPagesGoalLabel").textContent="Goal: set deadline in ⚙️"; $("#totalProgressFill").style.width="0%"; }
  if (state.deadline) { const d=daysLeft(); $("#deadlinePill").textContent = d!==null ? `${d} day${d!==1?'s':''} left` : state.deadline; }
  else $("#deadlinePill").textContent = "No deadline set";
  $("#pagesPerDay").textContent = state.deadline ? perDay() : state.dailyTarget;
  $("#streakVal").textContent = `${state.streak} 🔥`;
  $("#pointsVal").textContent = `${state.points} ⭐`;

  const el = $("#badgesRow"); el.innerHTML = "";
  for (const m of getMilestones()) {
    const d = document.createElement("div"); d.className = "badge-item"+(m.unlocked?" unlocked":"");
    d.innerHTML = `<div class="badge-emoji">${m.unlocked?"🏅":"🔒"}</div><div>${m.label} pg</div>`;
    el.appendChild(d);
  }
}

function renderSprints() {
  const el=$("#sprintList"), items=[...state.sprints].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  if (!items.length) { el.innerHTML='<div class="hint">No reading logged yet. Let\'s go Eli! 🕵️</div>'; return; }
  el.innerHTML="";
  for (const s of items) {
    const d=document.createElement("div"); d.className="list-item";
    d.innerHTML=`<div class="list-item-info"><div class="list-item-title">${s.pages} pages</div><div class="list-item-meta">${s.date}</div></div><button class="btn btn-small btn-ghost" data-del-sprint="${s.id}">✕</button>`;
    el.appendChild(d);
  }
}

function renderAR() {
  const p=arPassed(), a=state.arTests.length, req=state.arRequired||0;
  $("#passThresholdText").textContent=state.passThreshold;
  $("#arPassedCount").textContent=p; $("#arRequiredCount").textContent=req>0?req:"—";
  $("#arPassedStat").textContent=`${p} ✅`; $("#arAttemptStat").textContent=`${a} 📚`;
  if (req>0) { $("#arProgressFill").style.width=Math.min(100,p/req*100)+"%"; $("#arGoalBar").classList.remove("hidden"); }
  else $("#arGoalBar").classList.add("hidden");

  const el=$("#arList"), items=[...state.arTests].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  if (!items.length) { el.innerHTML='<div class="hint">No AR tests yet. Take one at school! 🧠</div>'; return; }
  el.innerHTML="";
  for (const t of items) {
    const tc=t.passed?"tag-pass":"tag-fail", tt=t.passed?"PASS":"TRY AGAIN";
    const d=document.createElement("div"); d.className="list-item";
    d.innerHTML=`<div class="list-item-info"><div class="list-item-title">${esc(t.book)}</div><div class="list-item-meta">${t.date} · ${t.score}%</div></div><div style="display:flex;gap:6px;align-items:center"><span class="tag ${tc}">${tt}</span><button class="btn btn-small btn-ghost" data-del-ar="${t.id}">✕</button></div>`;
    el.appendChild(d);
  }
}

function renderRewards() {
  $("#rewardPointsBadge").textContent=`${state.points} ⭐`;
  $("#treatsCostText").textContent=state.boxCosts.treats;
  $("#momCostText").textContent=state.boxCosts.mom;
  $("#dadCostText").textContent=state.boxCosts.dad;

  const el=$("#wonRewardsList");
  if (!state.wonRewards.length) { el.innerHTML='<div class="hint">No boxes opened yet. Earn points by reading! 📖</div>'; return; }
  el.innerHTML="";
  const sorted=[...state.wonRewards].sort((a,b)=>{ if(a.status==="pending"&&b.status!=="pending")return -1; if(a.status!=="pending"&&b.status==="pending")return 1; return (b.date||"").localeCompare(a.date||""); });
  for (const r of sorted) {
    const tc=r.status==="pending"?"tag-pending":"tag-approved", tt=r.status==="pending"?"PENDING":"APPROVED";
    const emoji=r.tier==="dad"?"🎮":r.tier==="mom"?"💛":"🍬";
    const name=r.tier==="dad"?"Dad Time":r.tier==="mom"?"Mom Time":"Treat";
    const d=document.createElement("div"); d.className="list-item";
    d.innerHTML=`<div class="list-item-info"><div class="list-item-title">${emoji} ${esc(r.text)}</div><div class="list-item-meta">${r.date} · ${name}</div></div><span class="tag ${tc}">${tt}</span>`;
    el.appendChild(d);
  }
}

function renderAll() { renderMission(); renderProgress(); renderSprints(); renderAR(); renderRewards(); }

/* === EVENTS === */
function setupTabs() {
  $$(".tab").forEach(b=>b.addEventListener("click",()=>{
    $$(".tab").forEach(x=>x.classList.remove("is-active")); b.classList.add("is-active");
    $$(".panel").forEach(x=>x.classList.remove("is-active")); $(`#tab-${b.dataset.tab}`).classList.add("is-active");
  }));
}

function setupSprints() {
  $("#sprintDate").value = todayISO();
  $("#sprintForm").addEventListener("submit", e=>{
    e.preventDefault();
    const d=$("#sprintDate").value||todayISO(), p=Number($("#sprintPages").value);
    if (!Number.isFinite(p)||p<=0) return;
    state.sprints.push({id:uid(),date:d,pages:p}); state.points+=p;
    updateStreak(d); checkDailyBonus(d); checkMilestones();
    $("#sprintPages").value=""; save();
  });
  $("#sprintList").addEventListener("click", e=>{
    const b=e.target.closest("[data-del-sprint]"); if(!b) return;
    const id=b.getAttribute("data-del-sprint"), sp=state.sprints.find(s=>s.id===id); if(!sp) return;
    state.sprints=state.sprints.filter(s=>s.id!==id); state.points=Math.max(0,state.points-(Number(sp.pages)||0)); save();
  });
  $("#clearSprints").addEventListener("click", ()=>{
    if (!confirm("Clear ALL reading sprints?")) return;
    state.sprints=[]; state.milestonesUnlocked={}; state.dailyBonuses={}; state.streak=0; state.lastSprintDate=""; save();
  });
}

function setupTimer() {
  $("#timerRing").style.strokeDasharray=CIRC; $("#timerRing").style.strokeDashoffset=0;
  $$(".btn-timer").forEach(b=>b.addEventListener("click",()=>{
    if(timerOn) return; selMin=Number(b.dataset.minutes); timerSec=selMin*60; timerTot=timerSec;
    $$(".btn-timer").forEach(x=>x.classList.remove("active")); b.classList.add("active"); updateTimer();
  }));
  $("#timerStartBtn").addEventListener("click", startTimer);
  $("#timerStopBtn").addEventListener("click", ()=>stopTimer(false));
  $("#timerLogForm").addEventListener("submit", e=>{
    e.preventDefault();
    const p=Number($("#timerLogPages").value); if(!Number.isFinite(p)||p<=0) return;
    const d=todayISO();
    state.sprints.push({id:uid(),date:d,pages:p}); state.points+=p;
    updateStreak(d); checkDailyBonus(d); checkMilestones();
    $("#timerLogPages").value=""; $("#timerDoneSection").classList.add("hidden");
    $("#timerMessage").textContent="Logged! Another sprint, Eli? 📚";
    timerSec=selMin*60; timerTot=timerSec; updateTimer(); save();
  });
  updateTimer();
}

function setupAR() {
  $("#arDate").value = todayISO();
  $("#arForm").addEventListener("submit", e=>{
    e.preventDefault();
    const d=$("#arDate").value||todayISO(), book=$("#arBook").value.trim(), score=Number($("#arScore").value);
    if (!book||!Number.isFinite(score)) return;
    const passed=score>=state.passThreshold;
    state.arTests.push({id:uid(),date:d,book,score,passed});
    if (passed) { state.points+=20; launchConfetti(); if(state.arRequired>0&&arPassed()>=state.arRequired) setTimeout(launchConfetti,800); }
    $("#arBook").value=""; $("#arScore").value=""; save();
  });
  $("#arList").addEventListener("click", e=>{
    const b=e.target.closest("[data-del-ar]"); if(!b) return;
    const id=b.getAttribute("data-del-ar"), t=state.arTests.find(x=>x.id===id); if(!t) return;
    state.arTests=state.arTests.filter(x=>x.id!==id); if(t.passed) state.points=Math.max(0,state.points-20); save();
  });
  $("#clearAR").addEventListener("click", ()=>{ if(!confirm("Clear ALL AR logs?")) return; state.arTests=[]; save(); });
}

function setupRewards() {
  function openBox(tier) {
    const cost=state.boxCosts[tier]||25;
    if (state.points<cost) { $("#boxResult").textContent=`Need ${cost-state.points} more ⭐`; return; }
    const pool=state.rewards[tier]||[];
    if (!pool.length) { $("#boxResult").textContent="No rewards in this box! Ask a parent to add some ⚙️"; return; }
    const boxEl = tier==="dad"?$("#boxDad"):tier==="mom"?$("#boxMom"):$("#boxTreats");
    boxEl.classList.add("opening"); setTimeout(()=>boxEl.classList.remove("opening"),700);
    state.points-=cost;
    const pick=pool[Math.floor(Math.random()*pool.length)];
    state.wonRewards.unshift({id:uid(),date:todayISO(),text:pick,tier,status:"pending"});
    const label=tier==="dad"?"🎮 DAD TIME":tier==="mom"?"💛 MOM TIME":"🍬 TREAT";
    $("#boxResult").innerHTML=`${label}: <strong>${esc(pick)}</strong><br><span class="muted" style="font-size:12px">Needs parent approval</span>`;
    launchConfetti(); save();
  }
  $("#boxTreats").addEventListener("click",()=>openBox("treats"));
  $("#boxMom").addEventListener("click",()=>openBox("mom"));
  $("#boxDad").addEventListener("click",()=>openBox("dad"));
  $("#approveAll").addEventListener("click",()=>{
    if(!state.wonRewards.some(r=>r.status==="pending")) { $("#boxResult").textContent="Nothing pending!"; return; }
    if(!confirm("Approve all pending rewards?")) return;
    state.wonRewards=state.wonRewards.map(r=>r.status==="pending"?{...r,status:"approved"}:r);
    $("#boxResult").textContent="✅ All approved!"; save();
  });
}

function setupBackup() {
  $("#exportBtn").addEventListener("click", async()=>{ const d=JSON.stringify(state,null,2); $("#exportArea").value=d; try{await navigator.clipboard.writeText(d)}catch{} });
  $("#importInput").addEventListener("change", async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    try { const t=await f.text(), p=JSON.parse(t); state={...structuredClone(defaultState),...p};
      state.boxCosts={...defaultState.boxCosts,...(p.boxCosts||{})};
      state.rewards={treats:p.rewards?.treats||defaultState.rewards.treats,mom:p.rewards?.mom||defaultState.rewards.mom,dad:p.rewards?.dad||defaultState.rewards.dad};
      save(); alert("Imported!");
    } catch { alert("Bad file."); }
    e.target.value="";
  });
}

function setupParent() {
  const dlg=$("#parentDialog");
  $("#parentBtn").addEventListener("click",()=>{ $("#pinStep").classList.remove("hidden"); $("#settingsStep").classList.add("hidden"); $("#pinInput").value=""; dlg.showModal(); });
  $("#closeDialog").addEventListener("click",()=>dlg.close());
  dlg.addEventListener("click",e=>{ if(e.target===dlg) dlg.close(); });

  $("#unlockBtn").addEventListener("click",()=>{
    if($("#pinInput").value.trim()!==String(state.pin||"1234")) { alert("Wrong PIN."); return; }
    $("#setDailyTarget").value=state.dailyTarget; $("#setDeadline").value=state.deadline;
    $("#setTotalGoal").value=state.totalGoal||0; $("#setPassThreshold").value=state.passThreshold;
    $("#setARRequired").value=state.arRequired||0;
    $("#setTreatsCost").value=state.boxCosts.treats; $("#setMomCost").value=state.boxCosts.mom; $("#setDadCost").value=state.boxCosts.dad;
    $("#setTreatsRewards").value=state.rewards.treats.join("\n"); $("#setMomRewards").value=state.rewards.mom.join("\n"); $("#setDadRewards").value=state.rewards.dad.join("\n");
    $("#setPin").value="";
    $("#pinStep").classList.add("hidden"); $("#settingsStep").classList.remove("hidden");
  });

  $("#saveSettings").addEventListener("click",()=>{
    const dt=Number($("#setDailyTarget").value); if(Number.isFinite(dt)&&dt>0) state.dailyTarget=Math.floor(dt);
    state.deadline=$("#setDeadline").value||"";
    const tg=Number($("#setTotalGoal").value); state.totalGoal=(Number.isFinite(tg)&&tg>0)?Math.floor(tg):0;
    const pt=Number($("#setPassThreshold").value); state.passThreshold=Number.isFinite(pt)?Math.max(0,Math.min(100,pt)):80;
    const ar=Number($("#setARRequired").value); state.arRequired=(Number.isFinite(ar)&&ar>0)?Math.floor(ar):0;
    const tc=Number($("#setTreatsCost").value), mc=Number($("#setMomCost").value), dc=Number($("#setDadCost").value);
    if(Number.isFinite(tc)&&tc>0) state.boxCosts.treats=tc;
    if(Number.isFinite(mc)&&mc>0) state.boxCosts.mom=mc;
    if(Number.isFinite(dc)&&dc>0) state.boxCosts.dad=dc;
    const pl=v=>v.trim().split("\n").map(s=>s.trim()).filter(Boolean);
    state.rewards.treats=pl($("#setTreatsRewards").value);
    state.rewards.mom=pl($("#setMomRewards").value);
    state.rewards.dad=pl($("#setDadRewards").value);
    const np=$("#setPin").value.trim(); if(np) state.pin=np;
    save(); alert("Saved! ✅");
  });

  $("#lockBtn").addEventListener("click",()=>dlg.close());
}

/* === SERVICE WORKER === */
if ("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));

/* === INIT === */
state = loadState();
setupTabs(); setupSprints(); setupTimer(); setupAR(); setupRewards(); setupBackup(); setupParent();
checkMilestones(); renderAll();
