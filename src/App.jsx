import { useState, useRef, useEffect, useCallback } from "react";

// ── WEARABLE SIMULATION ENGINE ────────────────────────────────────────────────
// Mirrors what a real Garmin / Withings / Oura API would push every 5 seconds.
// Thresholds match clinical targets from Chikasha Health OS protocols.

const THRESHOLDS = {
  hr:    { low: 45,  high: 110, label: "Heart Rate",    unit: "bpm"   },
  spo2:  { low: 93,  high: 100, label: "SpO₂",          unit: "%"     },
  bp_s:  { low: 90,  high: 145, label: "Systolic BP",   unit: "mmHg"  },
  bp_d:  { low: 55,  high: 95,  label: "Diastolic BP",  unit: "mmHg"  },
  glucose:{ low: 70, high: 180, label: "Glucose",       unit: "mg/dL" },
  temp:  { low: 96.5,high: 100.4,label: "Temp",         unit: "°F"    },
  steps: { low: 0,   high: 99999,label: "Steps",        unit: "steps" },
  hrv:   { low: 20,  high: 120, label: "HRV",           unit: "ms"    },
};

function generateVitals(prev) {
  const drift = (val, range, step) =>
    Math.min(range[1], Math.max(range[0], val + (Math.random() - 0.5) * step));
  return {
    hr:      drift(prev?.hr      ?? 68,  [48, 115], 3),
    spo2:    drift(prev?.spo2    ?? 96,  [92, 99],  0.5),
    bp_s:    drift(prev?.bp_s    ?? 118, [88, 148], 2),
    bp_d:    drift(prev?.bp_d    ?? 76,  [54, 98],  1.5),
    glucose: drift(prev?.glucose ?? 114, [68, 195], 4),
    temp:    drift(prev?.temp    ?? 98.2,[96, 100.8],0.15),
    steps:   Math.round((prev?.steps ?? 0) + Math.random() * 8),
    hrv:     drift(prev?.hrv     ?? 42,  [18, 85],  3),
    ts:      Date.now(),
  };
}

function getStatus(key, val) {
  const t = THRESHOLDS[key];
  if (!t) return "ok";
  if (val < t.low || val > t.high) return "critical";
  const pctLow  = (val - t.low)  / (t.high - t.low);
  const pctHigh = (t.high - val) / (t.high - t.low);
  if (pctLow < 0.08 || pctHigh < 0.08) return "warn";
  return "ok";
}

// ── HEALTH OS DATA ────────────────────────────────────────────────────────────
const HOS = {
  name:"Mary Culwell", tribal_id:"CHK-2026-04821", age:74, clan:"Deer Clan",
  risk_score:74, risk_level:"Moderate Risk", alerts:2, next_scan_days:83,
  risk_domains:[
    {name:"Metabolic",      icon:"🔬",score:58,color:"#C07941"},
    {name:"Cardiovascular", icon:"❤️", score:62,color:"#C07941"},
    {name:"Cognitive",      icon:"🧠",score:81,color:"#3D8B5E"},
    {name:"Oncology",       icon:"🎗️",score:88,color:"#3D8B5E"},
    {name:"Renal",          icon:"💧",score:79,color:"#3D8B5E"},
    {name:"Mental Health",  icon:"🌿",score:72,color:"#3D8B5E"},
  ],
  protocols:[
    {name:"Metabolic Reversal",     pct:34,detail:"Week 5 of 18 · A1C target: 5.7%", color:"#C07941"},
    {name:"Cardiovascular Defense", pct:20,detail:"LDL target: <170 mg/dL",          color:"#8B3A2A"},
    {name:"Longevity Optimization", pct:61,detail:"Supplement + sleep + exercise",   color:"#3D8B5E"},
    {name:"Cognitive Protection",   pct:78,detail:"Brain health markers — stable",   color:"#3D8B5E"},
  ],
};

const INIT_MEDS = [
  {id:1,name:"Metformin 500mg",   schedule:"8 AM · 6 PM",taken:[true,true], notes:"Metabolic Reversal protocol"},
  {id:2,name:"Lisinopril 10mg",   schedule:"8 AM",        taken:[true],      notes:"Cardiovascular Defense protocol"},
  {id:3,name:"Rosuvastatin 10mg", schedule:"8 PM",        taken:[false],     notes:"LDL target <170 — take at night"},
  {id:4,name:"Vitamin D3 2000IU", schedule:"8 AM",        taken:[true],      notes:"Longevity Optimization protocol"},
];

const AI_SYSTEM = `You are the Tribal Health OS — sovereign AI embedded in CareCircle Sovereign Edition for the Chickasaw Nation, connected to a live Withings/Garmin wearable worn by the patient.

PATIENT: Mary Culwell | CHK-2026-04821 | Age 74 | Deer Clan
RISK: 74/100 Moderate Risk | 2 alerts | Next scan 83 days | ZK Shield ACTIVE

STATIC HEALTH OS DATA:
- A1C: 6.4% (target 5.7%) | LDL: 212 mg/dL (target <170)
- Active protocols: Metabolic Reversal (34%), Cardiovascular Defense (20%), Longevity Optimization (61%), Cognitive Protection (78%)
- Meds: Metformin 500mg, Lisinopril 10mg, Rosuvastatin 10mg, Vitamin D3 2000IU

LIVE WEARABLE DATA is passed in each message by the app. Reference it when answering.

Thresholds for context:
- HR: normal 45-110 bpm | SpO2: normal >93% | BP systolic: normal 90-145 | Glucose: normal 70-180 mg/dL
- HRV: higher is better (>40ms good for her age) | Temp: normal 96.5-100.4°F

Be warm, precise, culturally respectful. Reference her actual live numbers when relevant. Keep responses concise. Recommend care team for serious clinical decisions.`;

// ── STYLES ────────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0B1829;color:#F4EDE1;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
.app{min-height:100vh;display:flex;flex-direction:column;max-width:430px;margin:0 auto;background:#0B1829}
.hdr{background:#0d1e30;padding:12px 14px 10px;border-bottom:1px solid rgba(192,121,65,0.22);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:30}
.logo-mark{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#C07941,#8B3A2A);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:14px;color:#F4EDE1;font-weight:700}
.logo-text{font-family:'Playfair Display',serif;font-size:14px;color:#F4EDE1;line-height:1.1}
.logo-sub{font-size:9px;color:#C07941;font-weight:600;letter-spacing:1.4px;text-transform:uppercase}
.zk-badge{display:flex;align-items:center;gap:5px;background:rgba(61,139,94,0.12);border:1px solid rgba(61,139,94,0.3);border-radius:20px;padding:3px 9px;font-size:10px;color:#7BC8A0;font-weight:600}
.zk-dot{width:6px;height:6px;border-radius:50%;background:#3D8B5E;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}

/* WEARABLE BANNER */
.wear-banner{margin:10px 14px 0;border-radius:13px;background:linear-gradient(135deg,rgba(192,121,65,0.1),rgba(28,51,80,0.6));border:1px solid rgba(192,121,65,0.28);padding:11px 13px}
.wear-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
.wear-device{display:flex;align-items:center;gap:8px}
.wear-icon{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1C3350,#0B1829);border:1px solid rgba(192,121,65,0.35);display:flex;align-items:center;justify-content:center;font-size:16px}
.wear-name{font-size:12px;color:#F4EDE1;font-weight:600}
.wear-status{font-size:10px;color:#A8B8C8;margin-top:1px}
.live-pill{display:flex;align-items:center;gap:4px;background:rgba(61,139,94,0.15);border:1px solid rgba(61,139,94,0.3);border-radius:10px;padding:3px 8px;font-size:10px;color:#7BC8A0;font-weight:600}
.live-dot{width:5px;height:5px;border-radius:50%;background:#3D8B5E;animation:pulse 1.5s infinite}
.wear-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.wear-cell{background:rgba(11,24,41,0.55);border-radius:9px;padding:7px 5px;text-align:center;border:1px solid rgba(255,255,255,0.05);position:relative;transition:border-color 0.3s}
.wear-cell.warn{border-color:rgba(192,121,65,0.5);background:rgba(192,121,65,0.06)}
.wear-cell.critical{border-color:rgba(139,58,42,0.7);background:rgba(139,58,42,0.1);animation:critPulse 1s infinite}
@keyframes critPulse{0%,100%{opacity:1}50%{opacity:0.7}}
.wear-val{font-size:13px;font-weight:700;color:#F4EDE1}
.wear-val.warn{color:#C07941}
.wear-val.critical{color:#E05C3A}
.wear-lbl{font-size:9px;color:#A8B8C8;margin-top:2px;text-transform:uppercase;letter-spacing:0.4px}

/* ALERT FEED */
.alert-feed{padding:0 14px;display:flex;flex-direction:column;gap:6px;margin-top:10px}
.alert-item{display:flex;align-items:flex-start;gap:9px;padding:9px 11px;border-radius:10px;animation:slideIn 0.3s ease}
.alert-item.critical{background:rgba(139,58,42,0.15);border:1px solid rgba(139,58,42,0.4)}
.alert-item.warn{background:rgba(192,121,65,0.1);border:1px solid rgba(192,121,65,0.3)}
.alert-item.ok{background:rgba(61,139,94,0.08);border:1px solid rgba(61,139,94,0.25)}
@keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.alert-icon{font-size:16px;flex-shrink:0}
.alert-text{font-size:12px;line-height:1.45}
.alert-text.critical{color:#F4A07A}
.alert-text.warn{color:#D4935E}
.alert-text.ok{color:#7BC8A0}
.alert-time{font-size:10px;color:#A8B8C8;margin-top:2px}

/* CONTENT */
.content{flex:1;overflow-y:auto;padding-bottom:4px}
.content::-webkit-scrollbar{width:3px}
.content::-webkit-scrollbar-thumb{background:rgba(192,121,65,0.2);border-radius:2px}
.sec-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 6px}
.sec-title{font-family:'Playfair Display',serif;font-size:16px;color:#F4EDE1}
.sec-act{font-size:12px;color:#C07941;cursor:pointer;font-weight:500}
.card{margin:0 14px 10px;border-radius:13px;background:#132236;border:1px solid rgba(255,255,255,0.07);padding:13px}

/* PATIENT CARD */
.pt-card{margin:10px 14px 0;border-radius:14px;background:linear-gradient(135deg,#1C3350,#132236);border:1px solid rgba(192,121,65,0.25);padding:13px;position:relative;overflow:hidden}
.pt-card::after{content:'';position:absolute;top:-25px;right:-25px;width:110px;height:110px;border-radius:50%;background:radial-gradient(circle,rgba(192,121,65,0.09) 0%,transparent 70%)}
.pt-top{display:flex;align-items:center;gap:11px;margin-bottom:11px}
.pt-av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#C07941,#8B3A2A);border:2px solid rgba(192,121,65,0.35);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:17px;color:#F4EDE1;flex-shrink:0}
.vitals-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.v-cell{background:rgba(11,24,41,0.55);border-radius:9px;padding:7px 5px;text-align:center;border:1px solid rgba(255,255,255,0.05)}

/* DOMAIN / PROTO */
.d-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.d-row:last-child{border-bottom:none;padding-bottom:0}
.bar-bg{height:4px;background:rgba(255,255,255,0.08);border-radius:2px;margin-top:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:2px;transition:width 0.6s}
.p-item{padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.p-item:last-child{border-bottom:none;padding-bottom:0}

/* MED */
.med-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.med-item:last-child{border-bottom:none;padding-bottom:0}
.chk{width:25px;height:25px;border-radius:7px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px}
.chk.done{background:rgba(61,139,94,0.2);color:#3D8B5E}
.chk.pend{background:rgba(192,121,65,0.1);color:#C07941;border:1px dashed rgba(192,121,65,0.4)}

/* MSG */
.msg-list{display:flex;flex-direction:column;gap:10px;padding:0 14px 10px}
.m-bub{display:flex;gap:8px;align-items:flex-start}
.m-bub.self{flex-direction:row-reverse}
.m-av{width:27px;height:27px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#C07941,#8B3A2A);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#F4EDE1}
.m-av.nav{background:linear-gradient(135deg,#1C3350,#0B1829);border:1px solid rgba(192,121,65,0.3);font-size:13px}
.m-av.alert-av{background:rgba(139,58,42,0.3);border:1px solid rgba(139,58,42,0.5);font-size:13px}
.m-txt{background:#1C3350;border-radius:12px 12px 12px 3px;padding:9px 12px;font-size:13px;color:#F4EDE1;line-height:1.45;border:1px solid rgba(255,255,255,0.06)}
.m-bub.self .m-txt{background:rgba(192,121,65,0.1);border-radius:12px 12px 3px 12px;border-color:rgba(192,121,65,0.2)}
.m-txt.alert{background:rgba(139,58,42,0.15);border-color:rgba(139,58,42,0.35)}
.msg-in-row{display:flex;gap:8px;padding:10px 14px 12px;border-top:1px solid rgba(255,255,255,0.06)}
.m-in{flex:1;background:#1C3350;border:1px solid rgba(255,255,255,0.1);border-radius:22px;padding:10px 14px;color:#F4EDE1;font-family:'DM Sans',sans-serif;font-size:13px;outline:none}
.m-in::placeholder{color:#A8B8C8}
.m-snd{width:37px;height:37px;border-radius:50%;background:#C07941;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}

/* AI */
.ai-hdr{margin:10px 14px 8px;border-radius:13px;background:linear-gradient(135deg,rgba(192,121,65,0.1),rgba(11,24,41,0.4));border:1px solid rgba(192,121,65,0.25);padding:13px;display:flex;gap:11px;align-items:flex-start}
.ai-orb{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#C07941,#8B3A2A);display:flex;align-items:center;justify-content:center;font-size:19px;box-shadow:0 0 20px rgba(192,121,65,0.22)}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px}
.chip{background:rgba(192,121,65,0.08);border:1px solid rgba(192,121,65,0.22);border-radius:20px;padding:5px 11px;font-size:12px;color:#D4935E;cursor:pointer;font-family:'DM Sans',sans-serif}
.ai-msgs{display:flex;flex-direction:column;gap:10px;padding:0 14px 10px}
.ai-m{display:flex;gap:8px;align-items:flex-start}
.ai-m.user{flex-direction:row-reverse}
.a-av{width:26px;height:26px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#C07941,#8B3A2A);display:flex;align-items:center;justify-content:center;font-size:13px}
.a-av.u{background:linear-gradient(135deg,#1C3350,#0B1829);border:1px solid rgba(192,121,65,0.3);font-size:11px;color:#F4EDE1;font-weight:600}
.a-bub{max-width:83%;background:#1C3350;border:1px solid rgba(255,255,255,0.07);border-radius:12px 12px 12px 3px;padding:10px 13px;font-size:13px;color:#F4EDE1;line-height:1.55}
.ai-m.user .a-bub{background:rgba(192,121,65,0.1);border-color:rgba(192,121,65,0.2);border-radius:12px 12px 3px 12px}
.typing{display:flex;gap:4px;align-items:center}
.dot{width:6px;height:6px;border-radius:50%;background:#C07941;animation:bounce 1.2s infinite}
.dot:nth-child(2){animation-delay:0.2s}.dot:nth-child(3){animation-delay:0.4s}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
.ai-in-row{display:flex;gap:8px;padding:10px 14px 12px;border-top:1px solid rgba(255,255,255,0.06);background:#0B1829;position:sticky;bottom:54px}
.a-in{flex:1;background:#1C3350;border:1px solid rgba(192,121,65,0.2);border-radius:22px;padding:10px 14px;color:#F4EDE1;font-family:'DM Sans',sans-serif;font-size:13px;outline:none}
.a-in:focus{border-color:rgba(192,121,65,0.5)}
.a-in::placeholder{color:#A8B8C8}
.a-snd{width:37px;height:37px;border-radius:50%;background:linear-gradient(135deg,#C07941,#8B3A2A);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.a-snd:disabled{opacity:0.4;cursor:not-allowed}

/* TOGGLE */
.tog-row{display:flex;margin:10px 14px 0;border-radius:11px;overflow:hidden;border:1px solid rgba(192,121,65,0.2)}
.tog-btn{flex:1;padding:8px 0;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;transition:all 0.2s}
.iframe-bar{display:flex;align-items:center;gap:8px;padding:7px 13px;background:#0d1e30;border-bottom:1px solid rgba(192,121,65,0.18)}

/* SHIELD */
.shield-bar{margin:8px 14px 8px;border-radius:10px;background:rgba(61,139,94,0.07);border:1px solid rgba(61,139,94,0.2);padding:8px 12px;display:flex;gap:8px;align-items:center}
.live-badge{display:inline-flex;align-items:center;gap:4px;margin-top:5px;background:rgba(61,139,94,0.12);border:1px solid rgba(61,139,94,0.3);border-radius:10px;padding:3px 8px;font-size:10px;color:#7BC8A0;font-weight:600}

/* NAV */
.nav{display:flex;background:#0d1e30;border-top:1px solid rgba(192,121,65,0.15);position:sticky;bottom:0;z-index:20}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 4px 7px;gap:3px;background:none;border:none;cursor:pointer;color:#A8B8C8;font-family:'DM Sans',sans-serif;font-size:10px;transition:color 0.2s;position:relative}
.nav-btn.active{color:#C07941}
.nav-btn.active::before{content:'';position:absolute;top:0;left:20%;right:20%;height:2px;background:#C07941;border-radius:0 0 2px 2px}
.nav-icon{font-size:18px;line-height:1}
.notif-dot{position:absolute;top:6px;right:18px;width:7px;height:7px;border-radius:50%;background:#E05C3A;border:1px solid #0d1e30}

@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.fade-up{animation:fadeUp 0.3s ease forwards}
`;

// ── WEARABLE BANNER (shared across tabs) ──────────────────────────────────────
function WearableBanner({ vitals }) {
  const fmt = (v, d=0) => typeof v === "number" ? v.toFixed(d) : "--";
  const cells = [
    { key:"hr",      label:"HR",      val:fmt(vitals?.hr,0),      unit:"bpm"   },
    { key:"spo2",    label:"SpO₂",    val:fmt(vitals?.spo2,1),    unit:"%"     },
    { key:"bp_s",    label:"BP",      val:`${fmt(vitals?.bp_s,0)}/${fmt(vitals?.bp_d,0)}`, unit:"mmHg" },
    { key:"glucose", label:"Glucose", val:fmt(vitals?.glucose,0), unit:"mg/dL" },
    { key:"temp",    label:"Temp",    val:fmt(vitals?.temp,1),    unit:"°F"    },
    { key:"hrv",     label:"HRV",     val:fmt(vitals?.hrv,0),     unit:"ms"    },
    { key:"steps",   label:"Steps",   val:(vitals?.steps??0).toLocaleString(), unit:"today" },
    { key:"spo2",    label:"Sleep",   val:"6h 42m",               unit:"est"   },
  ];
  return (
    <div className="wear-banner">
      <div className="wear-top">
        <div className="wear-device">
          <div className="wear-icon">⌚</div>
          <div>
            <div className="wear-name">Sovereign Wearable</div>
            <div className="wear-status">Withings ScanWatch · Syncing every 5s</div>
          </div>
        </div>
        <div className="live-pill"><div className="live-dot"/>LIVE</div>
      </div>
      <div className="wear-grid">
        {cells.map((c,i) => {
          const st = c.key === "bp_s"
            ? getStatus("bp_s", vitals?.bp_s ?? 118)
            : getStatus(c.key, parseFloat(c.val));
          return (
            <div key={i} className={`wear-cell ${st}`}>
              <div className={`wear-val ${st}`}>{c.val}</div>
              <div className="wear-lbl">{c.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ALERT FEED ────────────────────────────────────────────────────────────────
function AlertFeed({ alerts }) {
  if (!alerts.length) return null;
  return (
    <div className="alert-feed">
      {alerts.slice(0,3).map((a,i) => (
        <div key={i} className={`alert-item ${a.level}`}>
          <span className="alert-icon">{a.level==="critical"?"🚨":a.level==="warn"?"⚠️":"✅"}</span>
          <div>
            <div className={`alert-text ${a.level}`}>{a.msg}</div>
            <div className="alert-time">{a.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── SCREENS ───────────────────────────────────────────────────────────────────
function Dashboard({ vitals, alerts }) {
  return (
    <div className="content fade-up">
      <WearableBanner vitals={vitals} />
      <AlertFeed alerts={alerts} />

      <div className="pt-card" style={{marginTop:10}}>
        <div className="pt-top">
          <div className="pt-av">MC</div>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:17,color:"#F4EDE1"}}>{HOS.name}</div>
            <div style={{fontSize:11,color:"#A8B8C8",marginTop:2}}>{HOS.tribal_id} · Age {HOS.age}</div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginTop:5}}>
              <span style={{fontFamily:"'Playfair Display',serif",fontSize:21,fontWeight:700,color:"#C07941"}}>{HOS.risk_score}</span>
              <div>
                <div style={{fontSize:11,color:"#A8B8C8"}}>{HOS.risk_level}</div>
                <div style={{fontSize:10,color:"#C07941"}}>⚠ {HOS.alerts} alerts · Next scan {HOS.next_scan_days}d</div>
              </div>
            </div>
          </div>
        </div>
        <div className="vitals-grid">
          {[
            {icon:"❤️",val:`${vitals?.bp_s?.toFixed(0)||118}/${vitals?.bp_d?.toFixed(0)||76}`,unit:"mmHg",lbl:"BP"},
            {icon:"🩸",val:"6.4",unit:"%",lbl:"A1C"},
            {icon:"⚡",val:`${vitals?.hr?.toFixed(0)||68}`,unit:"bpm",lbl:"HR"},
            {icon:"🫁",val:`${vitals?.spo2?.toFixed(1)||96}`,unit:"%",lbl:"SpO₂"},
            {icon:"🌡",val:`${vitals?.temp?.toFixed(1)||98.2}`,unit:"°F",lbl:"Temp"},
            {icon:"💪",val:`${vitals?.hrv?.toFixed(0)||42}`,unit:"ms",lbl:"HRV"},
          ].map(v=>(
            <div className="v-cell" key={v.lbl}>
              <div style={{fontSize:12,marginBottom:2}}>{v.icon}</div>
              <div style={{fontSize:12,fontWeight:600,color:"#F4EDE1"}}>{v.val}<span style={{fontSize:9,color:"#A8B8C8"}}> {v.unit}</span></div>
              <div style={{fontSize:9,color:"#A8B8C8",marginTop:1,textTransform:"uppercase",letterSpacing:"0.4px"}}>{v.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="shield-bar" style={{marginTop:10}}>
        <span style={{fontSize:17}}>🛡</span>
        <p style={{fontSize:11,color:"rgba(123,200,160,0.8)",lineHeight:1.4}}><strong style={{color:"#7BC8A0"}}>ZK Sovereign Shield Active.</strong> Wearable data processed on Chickasaw Nation infrastructure only.</p>
      </div>

      <div className="sec-head"><span className="sec-title">Active Protocols</span></div>
      <div className="card">
        {HOS.protocols.map(p=>(
          <div className="p-item" key={p.name}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:13,color:"#F4EDE1",fontWeight:500}}>{p.name}</span>
              <span style={{fontSize:13,fontWeight:700,color:p.color}}>{p.pct}%</span>
            </div>
            <div style={{fontSize:11,color:"#A8B8C8",marginBottom:5}}>{p.detail}</div>
            <div className="bar-bg"><div className="bar-fill" style={{width:`${p.pct}%`,background:p.color}}/></div>
          </div>
        ))}
      </div>

      <div className="sec-head"><span className="sec-title">Risk Domains</span></div>
      <div className="card">
        {HOS.risk_domains.map(rd=>(
          <div className="d-row" key={rd.name}>
            <span style={{fontSize:15,width:22,textAlign:"center",flexShrink:0}}>{rd.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,color:"#F4EDE1",fontWeight:500}}>{rd.name}</div>
              <div className="bar-bg"><div className="bar-fill" style={{width:`${rd.score}%`,background:rd.color}}/></div>
            </div>
            <span style={{fontSize:13,fontWeight:600,color:rd.color,flexShrink:0}}>{rd.score}</span>
          </div>
        ))}
      </div>
      <div style={{height:16}}/>
    </div>
  );
}

function Medications({ vitals }) {
  const [meds,setMeds]=useState(INIT_MEDS.map(m=>({...m,taken:[...m.taken]})));
  const done=meds.reduce((a,m)=>a+m.taken.filter(Boolean).length,0);
  const total=meds.reduce((a,m)=>a+m.taken.length,0);
  const pct=Math.round((done/total)*100);
  function toggle(id,idx){setMeds(p=>p.map(m=>{if(m.id!==id)return m;const t=[...m.taken];t[idx]=!t[idx];return{...m,taken:t};}));}
  return (
    <div className="content fade-up">
      <WearableBanner vitals={vitals}/>
      <div style={{margin:"10px 14px",borderRadius:13,background:"#132236",border:"1px solid rgba(192,121,65,0.2)",padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:"#F4EDE1"}}>{done}/{total} Doses Taken</div>
            <div style={{fontSize:11,color:"#A8B8C8",marginTop:2}}>Wearable confirms absorption patterns</div>
          </div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,color:pct===100?"#3D8B5E":"#C07941",fontWeight:700}}>{pct}%</div>
        </div>
        <div style={{height:6,borderRadius:3,background:"rgba(255,255,255,0.08)",overflow:"hidden"}}>
          <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#C07941,#3D8B5E)",borderRadius:3,transition:"width 0.4s"}}/>
        </div>
      </div>
      <div className="sec-head"><span className="sec-title">Medication Schedule</span><span className="sec-act">+ Add</span></div>
      <div className="card">
        {meds.map(m=>(
          <div className="med-item" key={m.id}>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {m.taken.map((t,i)=>(
                <button key={i} onClick={()=>toggle(m.id,i)} className={`chk ${t?"done":"pend"}`} style={{width:23,height:23,fontSize:11}}>{t?"✓":"○"}</button>
              ))}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:500,color:"#F4EDE1"}}>{m.name}</div>
              <div style={{fontSize:11,color:"#A8B8C8",marginTop:1}}>⏰ {m.schedule}</div>
              {m.notes&&<div style={{fontSize:10,color:"rgba(192,121,65,0.7)",marginTop:2,fontStyle:"italic"}}>{m.notes}</div>}
            </div>
          </div>
        ))}
      </div>
      <div style={{height:16}}/>
    </div>
  );
}

function Family({ vitals, alerts, familyMsgs, setFamilyMsgs }) {
  const [input,setInput]=useState("");
  const ref=useRef(null);
  useEffect(()=>{ref.current?.scrollIntoView({behavior:"smooth"})},[familyMsgs]);
  function send(){const t=input.trim();if(!t)return;setFamilyMsgs(p=>[...p,{id:Date.now(),from:"Matt (Son)",time:"Now",text:t,avatar:"M",type:"msg"}]);setInput("");}
  return (
    <div className="content fade-up" style={{display:"flex",flexDirection:"column"}}>
      <WearableBanner vitals={vitals}/>

      {alerts.filter(a=>a.level==="critical"||a.level==="warn").length>0&&(
        <div style={{margin:"8px 14px",borderRadius:11,background:"rgba(139,58,42,0.12)",border:"1px solid rgba(139,58,42,0.35)",padding:"9px 12px"}}>
          <div style={{fontSize:11,color:"#F4A07A",fontWeight:600,marginBottom:4}}>🚨 Active Wearable Alerts</div>
          {alerts.filter(a=>a.level!=="ok").slice(0,2).map((a,i)=>(
            <div key={i} style={{fontSize:12,color:"#D4935E",lineHeight:1.4,marginTop:2}}>{a.msg}</div>
          ))}
        </div>
      )}

      <div className="sec-head"><span className="sec-title">Family Hub</span><span className="sec-act">+ Add member</span></div>
      <div style={{display:"flex",gap:10,padding:"0 14px 10px",overflowX:"auto"}}>
        {[{n:"Matt",r:"Son",a:"M"},{n:"Mary",r:"Elder",a:"MC"},{n:"Navigator",r:"Care Team",a:"🛡"},{n:"Wearable",r:"Live Feed",a:"⌚"}].map(p=>(
          <div key={p.n} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flexShrink:0}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#C07941,#8B3A2A)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#F4EDE1",border:"2px solid rgba(192,121,65,0.3)"}}>{p.a}</div>
            <div style={{fontSize:11,color:"#F4EDE1"}}>{p.n}</div>
            <div style={{fontSize:10,color:"#A8B8C8"}}>{p.r}</div>
          </div>
        ))}
      </div>

      <div className="msg-list">
        {familyMsgs.map(m=>{
          const isSelf=m.from==="Matt (Son)";
          const isNav=m.from==="Care Navigator";
          const isAlert=m.type==="alert";
          const isWear=m.from==="⌚ Wearable";
          return (
            <div key={m.id} className={`m-bub ${isSelf?"self":""}`}>
              <div className={`m-av ${isNav||isWear?"nav":""} ${isAlert?"alert-av":""}`}>{isNav?"🛡":isWear?"⌚":m.avatar}</div>
              <div style={{maxWidth:"80%"}}>
                {!isSelf&&<div style={{fontSize:10,color:"#A8B8C8",marginBottom:3}}>{m.from}</div>}
                <div className={`m-txt ${isAlert?"alert":""}`}>{m.text}</div>
                <div style={{fontSize:9,color:"#A8B8C8",marginTop:3,textAlign:"right"}}>{m.time}</div>
              </div>
            </div>
          );
        })}
        <div ref={ref}/>
      </div>
      <div className="msg-input-row">
        <input className="m-in" placeholder="Message the family..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}/>
        <button className="m-snd" onClick={send}>➤</button>
      </div>
    </div>
  );
}

function TribalHealthOS({ vitals }) {
  const [view,setView]=useState("chat");
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{ref.current?.scrollIntoView({behavior:"smooth"})},[messages,loading]);

  const CHIPS=["What do her live vitals mean?","Is her heart rate normal right now?","Explain her HRV reading","How is her SpO₂ trend?","What should the family watch for?","How close is she to her A1C target?"];

  async function ask(text){
    if(!text.trim()||loading)return;
    const liveContext = vitals ? `\n\nCURRENT LIVE WEARABLE READINGS (just now):\n- Heart Rate: ${vitals.hr?.toFixed(0)} bpm\n- SpO2: ${vitals.spo2?.toFixed(1)}%\n- BP: ${vitals.bp_s?.toFixed(0)}/${vitals.bp_d?.toFixed(0)} mmHg\n- Glucose: ${vitals.glucose?.toFixed(0)} mg/dL\n- Temp: ${vitals.temp?.toFixed(1)}°F\n- HRV: ${vitals.hrv?.toFixed(0)} ms\n- Steps today: ${vitals.steps}` : "";
    const um={role:"user",text,id:Date.now()};
    setMessages(p=>[...p,um]);setInput("");setLoading(true);
    try{
      const history=[...messages,um].map(m=>({role:m.role==="user"?"user":"assistant",content:m.text+(m.role==="user"?liveContext:"")}));
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:AI_SYSTEM,messages:history})});
      const data=await res.json();
      const reply=data.content?.find(b=>b.type==="text")?.text||"Connection issue — try again.";
      setMessages(p=>[...p,{role:"assistant",text:reply,id:Date.now()+1}]);
    }catch{setMessages(p=>[...p,{role:"assistant",text:"Connection issue — please try again.",id:Date.now()+1}]);}
    setLoading(false);
  }

  return (
    <div className="content fade-up" style={{display:"flex",flexDirection:"column"}}>
      <div className="tog-row">
        {[{id:"chat",label:"🧠 AI Health Chat"},{id:"portal",label:"🏛 Health OS Portal"}].map(t=>(
          <button key={t.id} className="tog-btn" onClick={()=>setView(t.id)} style={{background:view===t.id?"linear-gradient(135deg,#C07941,#8B3A2A)":"transparent",color:view===t.id?"#F4EDE1":"#A8B8C8"}}>{t.label}</button>
        ))}
      </div>

      {view==="portal"?(
        <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 115px)",marginTop:8}}>
          <div className="iframe-bar">
            <div style={{width:7,height:7,borderRadius:"50%",background:"#3D8B5E",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:11,color:"#A8B8C8"}}>Live · <span style={{color:"#C07941",fontWeight:600}}>sovereignhealthcareos.com</span></span>
          </div>
          <iframe src="https://sovereignhealthcareos.com/" title="Chikasha Health OS" style={{flex:1,border:"none",width:"100%"}}/>
        </div>
      ):(
        <>
          <WearableBanner vitals={vitals}/>
          <div className="ai-hdr">
            <div className="ai-orb">🏛</div>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,color:"#F4EDE1"}}>Tribal Health OS</div>
              <div style={{fontSize:11,color:"#A8B8C8",marginTop:3,lineHeight:1.5}}>Sovereign AI with live wearable data + Chikasha Health OS context. Every answer grounded in her real numbers.</div>
              <div className="live-badge"><span style={{width:5,height:5,borderRadius:"50%",background:"#3D8B5E",display:"inline-block"}}/>Live Wearable Connected</div>
            </div>
          </div>

          {messages.length===0&&(
            <div className="chips">{CHIPS.map(c=><button key={c} className="chip" onClick={()=>ask(c)}>{c}</button>)}</div>
          )}

          <div className="ai-msgs">
            {messages.map(m=>(
              <div key={m.id} className={`ai-m ${m.role==="user"?"user":""}`}>
                <div className={`a-av ${m.role==="user"?"u":""}`}>{m.role==="user"?"M":"🏛"}</div>
                <div className="a-bub">{m.text}</div>
              </div>
            ))}
            {loading&&(
              <div className="ai-m">
                <div className="a-av">🏛</div>
                <div className="a-bub"><div className="typing"><div className="dot"/><div className="dot"/><div className="dot"/></div></div>
              </div>
            )}
            <div ref={ref}/>
          </div>
          <div className="ai-in-row">
            <input className="a-in" placeholder="Ask Tribal Health OS..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask(input)}/>
            <button className="a-snd" onClick={()=>ask(input)} disabled={loading||!input.trim()}>➤</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── APP SHELL ─────────────────────────────────────────────────────────────────
const TABS=[
  {id:"dash",  icon:"🏠",label:"Home"},
  {id:"meds",  icon:"💊",label:"Meds"},
  {id:"family",icon:"👨‍👩‍👧",label:"Family"},
  {id:"ai",    icon:"🏛", label:"Health OS"},
];

const INIT_MSGS = [
  {id:1,from:"Matt (Son)",    time:"9:02 AM", text:"Mom, did you take your morning meds? Love you.",avatar:"M",type:"msg"},
  {id:2,from:"Mary",          time:"9:15 AM", text:"Yes baby I did! App reminded me 😊",            avatar:"MC",type:"msg"},
  {id:3,from:"Care Navigator",time:"10:30 AM",text:"Good morning Mary! BP is right on target today. Cardiovascular Defense is working.",avatar:"N",type:"msg"},
];

function timeNow(){return new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});}

export default function App() {
  const [tab,setTab]=useState("dash");
  const [vitals,setVitals]=useState(generateVitals(null));
  const [alerts,setAlerts]=useState([]);
  const [familyMsgs,setFamilyMsgs]=useState(INIT_MSGS);
  const [hasAlertNotif,setHasAlertNotif]=useState(false);
  const prevVitals=useRef(null);

  // ── WEARABLE HEARTBEAT ─────────────────────────────────────────────────────
  useEffect(()=>{
    const iv=setInterval(()=>{
      setVitals(prev=>{
        const next=generateVitals(prev);
        prevVitals.current=prev;

        // Check thresholds and generate alerts
        const newAlerts=[];
        const checks=[
          {key:"hr",    val:next.hr,    label:"Heart Rate",    unit:"bpm"},
          {key:"spo2",  val:next.spo2,  label:"SpO₂",          unit:"%"},
          {key:"bp_s",  val:next.bp_s,  label:"Systolic BP",   unit:"mmHg"},
          {key:"glucose",val:next.glucose,label:"Glucose",     unit:"mg/dL"},
          {key:"temp",  val:next.temp,  label:"Temperature",   unit:"°F"},
        ];
        checks.forEach(c=>{
          const st=getStatus(c.key,c.val);
          if(st==="critical"){
            const msg=`🚨 ${c.label} is ${c.val.toFixed(c.key==="temp"?1:0)} ${c.unit} — outside safe range. Family notified.`;
            newAlerts.push({level:"critical",msg,time:timeNow()});
            // Push to family chat
            setFamilyMsgs(p=>{
              const already=p.some(m=>m.type==="alert"&&m.text.includes(c.label)&&m.time===timeNow());
              if(already)return p;
              return[...p,{id:Date.now()+Math.random(),from:"⌚ Wearable",time:timeNow(),text:`⚠️ Alert: Mary's ${c.label} is ${c.val.toFixed(c.key==="temp"?1:0)} ${c.unit}. Please check on her.`,avatar:"⌚",type:"alert"}];
            });
            setHasAlertNotif(true);
          } else if(st==="warn"){
            newAlerts.push({level:"warn",msg:`⚠ ${c.label} is ${c.val.toFixed(c.key==="temp"?1:0)} ${c.unit} — approaching limit. Monitoring.`,time:timeNow()});
          }
        });

        if(newAlerts.length===0){
          newAlerts.push({level:"ok",msg:`All vitals stable. Wearable sync active.`,time:timeNow()});
        }

        setAlerts(newAlerts);
        return next;
      });
    },5000);
    return()=>clearInterval(iv);
  },[]);

  const clearNotif=()=>setHasAlertNotif(false);

  return(
    <>
      <style>{css}</style>
      <div className="app">
        <div className="hdr">
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <div className="logo-mark">CC</div>
            <div>
              <div className="logo-text">CareCircle</div>
              <div className="logo-sub">Sovereign Edition</div>
            </div>
          </div>
          <div className="zk-badge"><div className="zk-dot"/>ZK SHIELD ON</div>
        </div>

        {tab==="dash"   &&<Dashboard vitals={vitals} alerts={alerts}/>}
        {tab==="meds"   &&<Medications vitals={vitals}/>}
        {tab==="family" &&<Family vitals={vitals} alerts={alerts} familyMsgs={familyMsgs} setFamilyMsgs={setFamilyMsgs}/>}
        {tab==="ai"     &&<TribalHealthOS vitals={vitals}/>}

        <nav className="nav">
          {TABS.map(t=>(
            <button key={t.id} className={`nav-btn ${tab===t.id?"active":""}`} onClick={()=>{setTab(t.id);if(t.id==="family")clearNotif();}}>
              <span className="nav-icon">{t.icon}</span>
              {t.label}
              {t.id==="family"&&hasAlertNotif&&<div className="notif-dot"/>}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
