// ═══════════════════════════════════════════════════════════════════
// webapp.mjs — واجهة ويب داخلية لإدارة التحويلات
// تعمل داخل نفس خادم البوت — لا تحتاج أي شيء خارجي
// كل مستخدم يرى بياناته فقط عبر token خاص به
// ═══════════════════════════════════════════════════════════════════
import { userForToken } from "./webapp-auth.mjs";
import {
  webGetOverview,
  webPreviewChannel,
  webAddChannel,
  webDeleteChannel,
  webRefreshGroups,
  webSendGroupMessage,
  webCreateRule,
  webUpdateRule,
  webDeleteRule,
  webChatPicture,
} from "./forward.mjs";
import {
  applyWebGroupAction,
  getWebGroupDetails,
  getWebGroupInvite,
  setWebGroupSetting,
  saveWebGroupAutoPost,
  setWebGroupAutoPostEnabled,
  deleteWebGroupAutoPost,
  previewWebGroupAutoPost,
  publishWebGroupAutoPostNow,
} from "./handlers/groups-handler.mjs";

// ─── مصادقة ────────────────────────────────────────────────────────
function authUid(req) {
  const token =
    req.query?.token ||
    req.headers["x-webapp-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return userForToken(token);
}

function guard(handler) {
  return async (req, res) => {
    const uid = authUid(req);
    if (!uid) return res.status(401).json({ error: "غير مصرح — افتح الرابط من البوت" });
    try {
      const out = await handler(uid, req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      res.status(400).json({ error: e?.message || "خطأ غير متوقع" });
    }
  };
}

// ─── التسجيل في تطبيق Express ──────────────────────────────────────
export function registerWebApp(app) {
  // JSON body parsing خاص بمسارات الويب آب فقط (لا يؤثر على بقية البوت)
  const parseJson = (req, res, next) => {
    if (req.headers["content-type"]?.includes("application/json") && !req.body) {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on("end", () => {
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        next();
      });
    } else next();
  };

  app.get("/webapp", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML_PAGE);
  });

  app.get("/api/fw/overview", guard(async (uid) => webGetOverview(uid)));

  app.post("/api/fw/channel/preview", parseJson, guard(async (uid, req) => {
    return await webPreviewChannel(uid, req.body?.input);
  }));

  app.post("/api/fw/channel/add", parseJson, guard(async (uid, req) => {
    return webAddChannel(uid, req.body || {});
  }));

  app.post("/api/fw/channel/delete", parseJson, guard(async (uid, req) => {
    return webDeleteChannel(uid, req.body?.id);
  }));

  app.post("/api/fw/groups/refresh", parseJson, guard(async (uid, req) => {
    return await webRefreshGroups(uid, req.body?.number);
  }));

  app.post("/api/fw/groups/send", parseJson, guard(async (uid, req) => {
    return await webSendGroupMessage(uid, req.body?.id, req.body?.text, req.body?.phoneNumber);
  }));

  app.post("/api/fw/groups/detail", parseJson, guard(async (uid, req) => {
    return await getWebGroupDetails(uid, req.body?.id, req.body?.phoneNumber);
  }));

  app.post("/api/fw/groups/invite", parseJson, guard(async (uid, req) => {
    return await getWebGroupInvite(uid, req.body?.id, req.body?.phoneNumber);
  }));

  app.post("/api/fw/groups/settings", parseJson, guard(async (uid, req) => {
    return await setWebGroupSetting(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.setting,
      req.body?.enabled,
    );
  }));

  app.post("/api/fw/groups/action", parseJson, guard(async (uid, req) => {
    return await applyWebGroupAction(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.action,
      req.body?.value,
    );
  }));

  app.post("/api/fw/groups/autopost/save", parseJson, guard(async (uid, req) => {
    return await saveWebGroupAutoPost(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      {
        id: req.body?.autoPostId,
        topic: req.body?.topic,
        times: req.body?.times,
      },
    );
  }));

  app.post("/api/fw/groups/autopost/toggle", parseJson, guard(async (uid, req) => {
    return await setWebGroupAutoPostEnabled(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
      req.body?.enabled,
    );
  }));

  app.post("/api/fw/groups/autopost/delete", parseJson, guard(async (uid, req) => {
    return await deleteWebGroupAutoPost(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
    );
  }));

  app.post("/api/fw/groups/autopost/test", parseJson, guard(async (uid, req) => {
    return await previewWebGroupAutoPost(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
    );
  }));

  app.post("/api/fw/groups/autopost/publish", parseJson, guard(async (uid, req) => {
    return await publishWebGroupAutoPostNow(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
    );
  }));

  app.post("/api/fw/rule/create", parseJson, guard(async (uid, req) => {
    return webCreateRule(uid, req.body || {});
  }));

  app.post("/api/fw/rule/update", parseJson, guard(async (uid, req) => {
    return webUpdateRule(uid, req.body?.id, req.body?.patch || {});
  }));

  app.post("/api/fw/rule/delete", parseJson, guard(async (uid, req) => {
    return webDeleteRule(uid, req.body?.id);
  }));

  app.get("/api/fw/pic", guard(async (uid, req, res) => {
    const url = await webChatPicture(uid, String(req.query.jid || ""));
    res.json({ url: url || null });
  }));

  console.log("[WEBAPP] ✅ واجهة إدارة التحويلات جاهزة على /webapp");
}

// ═══════════════════════════════════════════════════════════════════
// صفحة الويب — واجهة عربية RTL احترافية مناسبة للهاتف
// ═══════════════════════════════════════════════════════════════════
const HTML_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#0b1220">
<title>إدارة التحويلات</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{
  --bg:#0a0e1a;--card:#141927;--card2:#1c2436;--line:#252e45;
  --txt:#eef2fa;--mut:#94a3c0;--acc:#34d399;--accD:#052e22;
  --ok:#34d399;--warn:#fbbf24;--del:#f87171;--r:16px;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{background:var(--bg);color:var(--txt);font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;min-height:100%}
body{padding-bottom:88px;font-size:15px;line-height:1.5}
.hdr{position:sticky;top:0;z-index:20;background:rgba(10,14,26,.92);backdrop-filter:blur(12px);padding:16px 18px 10px;border-bottom:1px solid var(--line)}
.hdr h1{font-size:18px;font-weight:800;display:flex;align-items:center;gap:8px;letter-spacing:-.2px}
.hdr .sub{color:var(--mut);font-size:12.5px;margin-top:3px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot.on{background:var(--ok);box-shadow:0 0 0 3px rgba(52,211,153,.18)}
.dot.off{background:var(--del);box-shadow:0 0 0 3px rgba(248,113,113,.15)}
.srch{margin:14px 18px 0;position:relative}
.srch input{width:100%;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r);padding:13px 44px 13px 14px;color:var(--txt);font-size:14.5px;outline:none;transition:border-color .18s}
.srch input::placeholder{color:#5b6a8a}
.srch input:focus{border-color:var(--acc)}
.srch .ic{position:absolute;right:15px;top:50%;transform:translateY(-50%);color:var(--mut);font-size:15px;pointer-events:none}
.container{padding:0 18px}
.tabs{display:flex;gap:4px;margin:12px 18px 14px;background:var(--card);border-radius:var(--r);padding:4px;border:1px solid var(--line)}
.tab{flex:1;text-align:center;padding:10px 4px;border-radius:12px;color:var(--mut);font-size:13.5px;font-weight:700;cursor:pointer;transition:background .15s,color .15s;border:none;background:none}
.tab.act{background:var(--acc);color:var(--accD)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 15px;margin-bottom:10px;transition:border-color .15s}
.card:active{border-color:#31405f}
.row{display:flex;align-items:center;gap:13px}
.avatar{width:48px;height:48px;border-radius:14px;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0;overflow:hidden;border:1px solid var(--line)}
.avatar img{width:100%;height:100%;object-fit:cover}
.grow{flex:1;min-width:0}
.nm{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.1px}
.meta{color:var(--mut);font-size:12.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px}
.btn{border:none;border-radius:13px;padding:11px 16px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s,transform .1s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.btn:active{transform:scale(.97);opacity:.9}
.btn-p{background:var(--acc);color:var(--accD)}
.btn-s{background:var(--card2);color:var(--txt);border:1px solid var(--line)}
.btn-d{background:rgba(248,113,113,.12);color:var(--del)}
.btn-sm{padding:8px 13px;font-size:13px;border-radius:11px}
.btn-ic{width:42px;height:42px;padding:0;border-radius:13px;font-size:17px;flex-shrink:0}
.btn:disabled{opacity:.45;pointer-events:none}
.fab{position:fixed;bottom:18px;left:18px;right:18px;z-index:25}
.fab .btn{width:100%;padding:15px;font-size:15.5px;border-radius:var(--r);box-shadow:0 10px 30px rgba(52,211,153,.28)}
.empty{text-align:center;color:var(--mut);padding:52px 24px;font-size:14px;line-height:2}
.empty .big{font-size:44px;margin-bottom:10px;opacity:.85}
.sw{position:relative;width:48px;height:28px;flex-shrink:0}
.sw input{opacity:0;width:0;height:0}
.sw .sl{position:absolute;inset:0;background:var(--card2);border:1px solid var(--line);border-radius:28px;cursor:pointer;transition:background .18s,border-color .18s}
.sw .sl:before{content:"";position:absolute;width:20px;height:20px;right:3px;top:3px;background:var(--mut);border-radius:50%;transition:transform .18s,background .18s}
.sw input:checked+.sl{background:rgba(52,211,153,.22);border-color:var(--ok)}
.sw input:checked+.sl:before{background:var(--ok);transform:translateX(-19px)}
.sheet-bg{position:fixed;inset:0;background:rgba(4,7,14,.68);z-index:40;opacity:0;pointer-events:none;transition:opacity .22s}
.sheet-bg.open{opacity:1;pointer-events:auto}
.sheet{position:fixed;bottom:0;left:0;right:0;z-index:50;background:var(--card);border-radius:24px 24px 0 0;max-height:88vh;overflow-y:auto;transform:translateY(105%);transition:transform .28s cubic-bezier(.32,.9,.35,1);padding:10px 18px 28px;border-top:1px solid var(--line)}
.sheet.open{transform:translateY(0)}
.sheet .grip{width:42px;height:4.5px;background:var(--line);border-radius:4px;margin:8px auto 16px}
.sheet h2{font-size:17px;font-weight:800;margin-bottom:16px;letter-spacing:-.2px}
.fld{margin-bottom:15px}
.fld label{display:block;color:var(--mut);font-size:12.5px;margin-bottom:7px;font-weight:700}
.fld input[type=text]{width:100%;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:12px 14px;color:var(--txt);font-size:14.5px;outline:none;transition:border-color .18s}
.fld input[type=text]:focus{border-color:var(--acc)}
.fld textarea{width:100%;min-height:140px;resize:vertical;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:12px 14px;color:var(--txt);font:inherit;font-size:14.5px;outline:none;transition:border-color .18s}
.fld textarea:focus{border-color:var(--acc)}
.pick{max-height:230px;overflow-y:auto;background:var(--card2);border:1px solid var(--line);border-radius:13px}
.pick .it{display:flex;align-items:center;gap:11px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px;transition:background .12s}
.pick .it:last-child{border-bottom:none}
.pick .it .chk{width:21px;height:21px;border-radius:7px;border:2px solid #37456a;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;color:transparent;transition:background .15s,border-color .15s}
.pick .it.sel .chk{background:var(--acc);border-color:var(--acc);color:var(--accD)}
.pick .it.sel{color:var(--acc);background:rgba(52,211,153,.06)}
.flags{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.flag{display:flex;align-items:center;gap:8px;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:11px 13px;font-size:13px;cursor:pointer;transition:border-color .15s,color .15s}
.flag.on{border-color:var(--acc);color:var(--acc);background:rgba(52,211,153,.06)}
.toast{position:fixed;bottom:98px;left:50%;transform:translateX(-50%) translateY(16px);background:#202b42;border:1px solid #31405f;color:var(--txt);padding:12px 20px;border-radius:14px;font-size:14px;z-index:99;opacity:0;transition:opacity .22s,transform .22s;max-width:88vw;text-align:center;box-shadow:0 10px 34px rgba(0,0,0,.5)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.badge{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:800}
.badge.on{background:rgba(52,211,153,.14);color:var(--ok)}
.badge.off{background:rgba(248,113,113,.12);color:var(--del)}
.prev{border:1.5px dashed var(--acc);background:rgba(52,211,153,.05)}
.spin{display:inline-block;width:15px;height:15px;border:2px solid rgba(148,163,192,.4);border-top-color:var(--acc);border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle}
@keyframes sp{to{transform:rotate(360deg)}}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.chip{background:var(--card2);border:1px solid var(--line);border-radius:20px;padding:4px 11px;font-size:11.5px;color:var(--mut);font-weight:600}
.hide{display:none!important}
.sechead{display:flex;align-items:center;justify-content:space-between;margin:2px 0 12px;gap:10px}
.sechead .t{font-size:13.5px;font-weight:800;color:var(--mut)}
.cnt{display:inline-flex;align-items:center;gap:4px;background:var(--card2);border:1px solid var(--line);border-radius:20px;padding:2px 10px;font-size:11.5px;color:var(--mut);font-weight:700;flex-shrink:0}
.group-card{cursor:pointer}
.group-detail-block{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:13px;margin:0 0 12px}
.group-detail-title{font-size:13px;font-weight:800;margin-bottom:8px}
.group-detail-line{font-size:13px;color:var(--mut);line-height:1.8;overflow-wrap:anywhere}
.group-option{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.group-member-list{max-height:230px;overflow:auto}
.group-member{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.group-invite-value{font-size:12px;color:var(--mut);overflow-wrap:anywhere;line-height:1.7;margin-top:8px}
.group-card:hover,.group-card:focus-visible{border-color:var(--acc);outline:none}
.auto-post-item{background:rgba(10,14,26,.45);border:1px solid var(--line);border-radius:13px;padding:12px;margin-top:9px}
.auto-post-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.auto-post-actions .btn{flex:1 1 auto}
.auto-post-form{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.auto-post-preview{font-size:12px;line-height:1.8;overflow-wrap:anywhere;margin-top:8px;color:var(--mut)}
.auto-post-preview a{color:var(--acc);text-decoration:underline}
.auto-post-error{color:var(--del);font-size:12px;margin-top:6px;overflow-wrap:anywhere}
</style>
</head>
<body>
<div class="hdr">
  <h1>📡 إدارة التحويلات <span class="dot off" id="waDot"></span></h1>
  <div class="sub" id="subTitle">جارٍ التحميل…</div>
</div>

<div class="srch">
  <input id="srchIn" type="text" placeholder="ابحث بالاسم… أو الصق رابط قناة واتساب" autocomplete="off">
  <span class="ic">🔍</span>
</div>

<div class="tabs">
  <button class="tab act" data-tab="rules">📋 القواعد</button>
  <button class="tab" data-tab="channels">📺 القنوات</button>
  <button class="tab" data-tab="groups">👥 المجموعات</button>
</div>

<div class="container">
  <div id="chPreview" class="hide"></div>
  <div id="view"></div>
</div>

<div class="fab" id="fab">
  <button class="btn btn-p" onclick="openRuleSheet()">➕ قاعدة تحويل جديدة</button>
</div>

<div class="sheet-bg" id="sheetBg" onclick="closeSheet()"></div>
<div class="sheet" id="sheet"></div>
<div class="toast" id="toast"></div>

<script>
const TG = window.Telegram?.WebApp;
if (TG) { try { TG.ready(); TG.expand(); } catch(e){} }

const qs = new URLSearchParams(location.search);
const TOKEN = qs.get("token") || localStorage.getItem("fw_token") || "";
if (qs.get("token")) localStorage.setItem("fw_token", qs.get("token"));

let ST = { numbers:[], channels:[], groups:[], rules:[], waConnected:false };
let TAB = qs.get("section") === "groups" ? "groups" : "rules";
let Q = "";
const picCache = {};

function api(path, body){
  const opt = body
    ? { method:"POST", headers:{ "Content-Type":"application/json", "x-webapp-token":TOKEN }, body: JSON.stringify(body) }
    : { headers:{ "x-webapp-token":TOKEN } };
  return fetch(path, opt).then(async r => {
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error || "خطأ في الاتصال");
    return j;
  });
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove("show"), 2600);
}
function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function nameOf(id){
  const all = [...ST.channels, ...ST.groups];
  const f = all.find(x=>x.id===id);
  if (f) return f.name;
  if (String(id).endsWith("@s.whatsapp.net")) return "👤 +" + String(id).split("@")[0];
  return String(id).split("@")[0].slice(-8) + "…";
}
function isChannelJid(id){ return String(id).endsWith("@newsletter"); }

async function load(){
  try {
    ST = await api("/api/fw/overview");
    document.getElementById("waDot").className = "dot " + (ST.waConnected ? "on" : "off");
    document.getElementById("subTitle").textContent =
      (ST.waConnected ? "واتساب متصل" : "واتساب غير متصل") +
      " · " + ST.rules.length + " قاعدة · " + ST.channels.length + " قناة · " + ST.groups.length + " مجموعة";
    render();
  } catch(e){
    document.getElementById("subTitle").textContent = "⚠️ " + e.message;
    document.getElementById("view").innerHTML = '<div class="empty"><div class="big">🔒</div>' + esc(e.message) + '<br>افتح الرابط من داخل البوت مجدداً.</div>';
  }
}

// ─── بحث موحّد: أسماء محلية + روابط قنوات واتساب ─────────────────
let srchTimer = null;
document.getElementById("srchIn").addEventListener("input", (e)=>{
  Q = e.target.value.trim();
  clearTimeout(srchTimer);
  const looksLikeChannel = Q.includes("whatsapp.com/channel/") || Q.endsWith("@newsletter");
  if (looksLikeChannel) {
    srchTimer = setTimeout(()=>previewChannel(Q), 450);
  } else {
    document.getElementById("chPreview").classList.add("hide");
    render();
  }
});

async function previewChannel(input){
  const box = document.getElementById("chPreview");
  box.classList.remove("hide");
  box.innerHTML = '<div class="card prev"><div class="row"><span class="spin"></span><span style="color:var(--mut);font-size:14px">جارٍ جلب معلومات القناة من واتساب…</span></div></div>';
  try {
    const p = await api("/api/fw/channel/preview", { input });
    const subs = p.subscribers ? Number(p.subscribers).toLocaleString("ar") + " مشترك" : "";
    box.innerHTML =
      '<div class="card prev"><div class="row">' +
      '<div class="avatar">' + (p.picture ? '<img src="'+esc(p.picture)+'" onerror="this.parentNode.textContent=\\'📺\\'">' : "📺") + '</div>' +
      '<div class="grow"><div class="nm">' + esc(p.name) + (p.verified ? " ✅" : "") + '</div>' +
      '<div class="meta">' + esc(subs) + (p.description ? " · " + esc(p.description.slice(0,60)) : "") + '</div></div>' +
      (p.alreadySaved
        ? '<span class="badge on">محفوظة ✓</span>'
        : '<button class="btn btn-p btn-ic" onclick=\\'addChannel(' + JSON.stringify(JSON.stringify({id:p.id,name:p.name})) + ')\\'>+</button>') +
      '</div></div>';
  } catch(e){
    box.innerHTML = '<div class="card prev"><div class="meta">❌ ' + esc(e.message) + '</div></div>';
  }
}

async function addChannel(jsonStr){
  try {
    const ch = JSON.parse(jsonStr);
    await api("/api/fw/channel/add", ch);
    toast("✅ تمت إضافة القناة: " + ch.name);
    document.getElementById("srchIn").value = ""; Q = "";
    document.getElementById("chPreview").classList.add("hide");
    await load();
  } catch(e){ toast("❌ " + e.message); }
}

// ─── التبويبات ──────────────────────────────────────────────────
function selectTab(tab, shouldRender=true){
  TAB = tab === "groups" || tab === "channels" ? tab : "rules";
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("act", t.dataset.tab===TAB));
  document.getElementById("fab").style.display = TAB==="rules" ? "" : "none";
  document.getElementById("srchIn").placeholder = TAB==="groups"
    ? "ابحث باسم المجموعة أو معرّفها…"
    : TAB==="channels" ? "ابحث بالاسم… أو الصق رابط قناة واتساب" : "ابحث باسم القاعدة…";
  const title = document.querySelector(".hdr h1");
  if (title?.firstChild) title.firstChild.nodeValue = TAB==="groups" ? "👥 إدارة المجموعات " : "📡 إدارة التحويلات ";
  if (shouldRender) render();
}

document.querySelectorAll(".tab").forEach(t=>{
  t.addEventListener("click", ()=>{
    selectTab(t.dataset.tab);
  });
});
selectTab(TAB, false);

function filt(arr){
  if (!Q || Q.includes("whatsapp.com/") || Q.endsWith("@newsletter")) return arr;
  const q = Q.toLowerCase();
  return arr.filter(x => (x.name||"").toLowerCase().includes(q) || (x.id||"").toLowerCase().includes(q));
}

function render(){
  const v = document.getElementById("view");
  if (TAB === "rules") return renderRules(v);
  if (TAB === "channels") return renderChannels(v);
  renderGroups(v);
}

// ─── القواعد ────────────────────────────────────────────────────
function renderRules(v){
  const rules = !Q ? ST.rules : ST.rules.filter(r => (r.name||"").toLowerCase().includes(Q.toLowerCase()));
  if (!rules.length) {
    v.innerHTML = '<div class="empty"><div class="big">📋</div>لا توجد قواعد تحويل بعد<br>اضغط "قاعدة تحويل جديدة" للبدء</div>';
    return;
  }
  v.innerHTML = rules.map(r =>
    '<div class="card"><div class="row">' +
    '<div class="grow" onclick="openRuleSheet(\\''+r.id+'\\')" style="cursor:pointer">' +
    '<div class="nm">' + esc(r.name) + '</div>' +
    '<div class="meta">📥 ' + r.sources.length + ' مصدر ← 📤 ' + esc(nameOf(r.destination)) +
    (r.sourceNumber ? ' · 📱 ' + esc(r.sourceNumber) : "") + '</div>' +
    '<div class="chips">' +
    (r.blockLinks?'<span class="chip">🚫 روابط</span>':"") +
    (r.blockImages?'<span class="chip">🚫 صور</span>':"") +
    (r.blockVideos?'<span class="chip">🚫 فيديو</span>':"") +
    (r.blockAudios?'<span class="chip">🚫 صوت</span>':"") +
    (r.noForward?'<span class="chip">↩️ بدون علامة</span>':"") +
    '</div></div>' +
    '<label class="sw"><input type="checkbox" '+(r.enabled?"checked":"")+' onchange="toggleRule(\\''+r.id+'\\',this.checked)"><span class="sl"></span></label>' +
    '</div></div>'
  ).join("");
}

async function toggleRule(id, on){
  try { await api("/api/fw/rule/update", { id, patch:{ enabled:on } }); toast(on?"✅ تم تفعيل القاعدة":"⏸️ تم إيقاف القاعدة"); await load(); }
  catch(e){ toast("❌ "+e.message); load(); }
}

// ─── القنوات ────────────────────────────────────────────────────
function renderChannels(v){
  const items = filt(ST.channels);
  let html = '<div class="sechead"><span class="t">القنوات المحفوظة (' + ST.channels.length + ')</span></div>';
  if (!items.length) {
    html += '<div class="empty"><div class="big">📺</div>لا توجد قنوات' + (Q?' مطابقة للبحث':'') + '<br>الصق رابط قناة واتساب في البحث بالأعلى لإضافتها</div>';
  } else {
    html += items.map(c =>
      '<div class="card"><div class="row">' +
      '<div class="avatar" data-jid="'+esc(c.id)+'">📺</div>' +
      '<div class="grow"><div class="nm">' + esc(c.name) + '</div>' +
      '<div class="meta">📺 قناة واتساب</div></div>' +
      '<button class="btn btn-d btn-ic" onclick="delChannel(\\''+esc(c.id)+'\\')">🗑</button>' +
      '</div></div>'
    ).join("");
  }
  v.innerHTML = html;
  lazyPics();
}

async function delChannel(id){
  if (!confirm("حذف هذه القناة من قائمتك؟")) return;
  try { await api("/api/fw/channel/delete", { id }); toast("🗑 تم حذف القناة"); await load(); }
  catch(e){ toast("❌ "+e.message); }
}

// ─── المجموعات ──────────────────────────────────────────────────
function renderGroups(v){
  const items = filt(ST.groups);
  let html = '<div class="sechead"><span class="t">المجموعات (' + ST.groups.length + ')</span>' +
    '<button class="btn btn-s btn-sm" onclick="refreshGroups(this)">🔄 تحديث من واتساب</button></div>';
  if (!items.length) {
    html += '<div class="empty"><div class="big">👥</div>لا توجد مجموعات' + (Q?' مطابقة للبحث':'') + '<br>اضغط "تحديث من واتساب" لجلب مجموعاتك</div>';
  } else {
    html += items.map(g =>
      '<div class="card group-card" data-group-open="'+esc(g.id)+'" role="button" tabindex="0" aria-label="خيارات المجموعة '+esc(g.name)+'"><div class="row">' +
      '<div class="avatar" data-jid="'+esc(g.id)+'">👥</div>' +
      '<div class="grow"><div class="nm">' + esc(g.name) + '</div>' +
      '<div class="meta">👥 ' + (g.members ? g.members + ' عضو' : 'مجموعة واتساب') + '</div></div>' +
      (g.members ? '<span class="cnt">' + g.members + '</span>' : '') +
      '<span class="btn btn-p btn-sm">⚙️ الخيارات</span>' +
      '</div></div>'
    ).join("");
  }
  v.innerHTML = html;
  v.querySelectorAll("[data-group-open]").forEach(card=>{
    card.addEventListener("click", ()=>openGroupDetails(card.dataset.groupOpen));
    card.addEventListener("keydown", event=>{
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGroupDetails(card.dataset.groupOpen);
      }
    });
  });
  lazyPics();
}

async function refreshGroups(btn){
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> جارٍ الجلب…';
  try { await api("/api/fw/groups/refresh", {}); toast("✅ تم تحديث المجموعات"); await load(); }
  catch(e){ toast("❌ "+e.message); }
  btn.disabled = false; btn.innerHTML = "🔄 تحديث من واتساب";
}

let GROUP_DETAIL = null;
let AUTO_POST_EDIT_ID = null;
async function openGroupDetails(groupId){
  const group = ST.groups.find(item=>item.id===groupId);
  if (!group) return toast("❌ المجموعة غير موجودة في قائمتك");
  AUTO_POST_EDIT_ID = null;
  GROUP_DETAIL = { ...group };
  const sh = document.getElementById("sheet");
  sh.innerHTML = '<div class="grip"></div><div class="empty"><span class="spin"></span><br>جارٍ جلب تفاصيل المجموعة…</div>';
  document.getElementById("sheetBg").classList.add("open");
  sh.classList.add("open");
  try {
    const detail = await api("/api/fw/groups/detail", {
      id: group.id,
      phoneNumber: group.phoneNumber || ""
    });
    GROUP_DETAIL = { ...group, ...detail };
    renderGroupDetails();
  } catch(e) {
    sh.innerHTML = '<div class="grip"></div><h2>⚠️ تعذّر فتح المجموعة</h2><div class="meta" style="white-space:normal">'+esc(e.message)+'</div><button class="btn btn-s" style="margin-top:16px" onclick="closeSheet()">إغلاق</button>';
  }
}

function renderGroupDetails(){
  if (!GROUP_DETAIL) return;
  const detail = GROUP_DETAIL;
  const sh = document.getElementById("sheet");
  const canManage = detail.isAdmin === true;
  const created = detail.createdAt ? new Date(detail.createdAt).toLocaleDateString("ar") : "غير متاح";
  const members = Array.isArray(detail.members) ? detail.members : [];
  const autoPosts = Array.isArray(detail.autoPosts) ? detail.autoPosts : [];
  const editingAutoPost = autoPosts.find(item=>item.id===AUTO_POST_EDIT_ID) || null;
  const memberRows = members.length
    ? members.map(member =>
        '<div class="group-member"><span>'+esc(member.label)+'</span><span class="meta">'+esc(member.role)+'</span></div>'
      ).join("")
    : '<div class="meta" style="white-space:normal">لا تتوفر بيانات الأعضاء حالياً.</div>';
  const settingRow = (key, label, enabled) =>
    '<div class="group-option"><div><div class="nm">'+label+'</div><div class="meta">'+(enabled?"مفعّل":"متوقف")+'</div></div>' +
    '<button class="btn '+(enabled?"btn-p":"btn-s")+'" data-group-setting="'+key+'" '+(canManage?"":"disabled")+'>'+(enabled?"إيقاف":"تفعيل")+'</button></div>';
  const autoPostRows = autoPosts.length
    ? autoPosts.map(item =>
        '<div class="auto-post-item"><div class="row" style="align-items:flex-start">' +
        '<div class="grow"><div class="nm">'+esc(item.topic)+'</div>' +
        '<div class="meta">🕒 '+esc((item.times||[]).join("، "))+' · توقيت الخرطوم</div></div>' +
        '<span class="badge '+(item.enabled?"on":"off")+'">'+(item.enabled?"مفعّل":"متوقف")+'</span></div>' +
        (item.lastError?'<div class="auto-post-error">آخر خطأ: '+esc(item.lastError)+'</div>':
          item.lastSentAt?'<div class="meta" style="white-space:normal;margin-top:5px">آخر نشر: '+esc(new Date(item.lastSentAt).toLocaleString("ar"))+'</div>':
          '<div class="meta" style="margin-top:5px">لم يُنشر شيء بعد</div>') +
        '<div class="auto-post-actions">' +
        '<button class="btn btn-s btn-sm" data-auto-edit="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>تعديل</button>' +
        '<button class="btn btn-s btn-sm" data-auto-test="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>' +
        '<span>اختبار الجلب</span></button>' +
        '<button class="btn btn-p btn-sm" data-auto-publish="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>' +
        '<span>نشر الآن</span></button>' +
        '<button class="btn btn-s btn-sm" data-auto-toggle="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>' +
        (item.enabled?"إيقاف":"تفعيل")+'</button>' +
        '<button class="btn btn-d btn-sm" data-auto-delete="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>حذف</button>' +
        '</div><div class="auto-post-preview" data-auto-preview="'+esc(item.id)+'"></div></div>'
      ).join("")
    : '<div class="meta" style="white-space:normal">لا توجد جداول نشر لهذه المجموعة بعد.</div>';

  sh.innerHTML =
    '<div class="grip"></div>' +
    '<h2>👥 '+esc(detail.name||detail.id)+'</h2>' +
    '<div class="group-detail-block"><div class="group-detail-title">تفاصيل المجموعة</div>' +
    '<div class="group-detail-line">الأعضاء: '+Number(detail.memberCount||0).toLocaleString("ar")+
    ' · المشرفون: '+Number(detail.adminCount||0).toLocaleString("ar")+'</div>' +
    '<div class="group-detail-line">تاريخ الإنشاء: '+created+'</div>' +
    '<div class="group-detail-line">إرسال الأعضاء: '+(detail.locked?"للمشرفين فقط":"مفتوح للأعضاء")+'</div>' +
    '<div class="group-detail-line">الوصف: '+esc(detail.description||"لا يوجد وصف")+'</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">الأعضاء ('+members.length+(detail.membersTruncated?"+":"")+')</div>' +
    '<div class="group-member-list">'+memberRows+'</div>' +
    (detail.membersTruncated?'<div class="meta" style="white-space:normal">تُعرض أول 500 عضوية فقط.</div>':"")+'</div>' +
    '<div class="group-detail-block"><div class="group-detail-title">إعدادات الروابط</div>' +
    settingRow("antiLink","حذف الرسائل التي تحتوي روابط",detail.antiLinkEnabled) +
    settingRow("inspectInvite","فحص روابط دعوة واتساب",detail.inspectInviteEnabled) +
    '<div class="meta" style="white-space:normal;margin-top:8px">'+
    (canManage?"حذف الروابط يتطلب أن يكون رقم واتساب مشرفاً وله صلاحية حذف الرسائل.":"تفعيل إعدادات الحماية متاح عندما يكون رقم واتساب مشرفاً.")+
    '</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">🗓️ النشر التلقائي</div>' +
    '<div class="meta" style="white-space:normal">ينشر عنوان المقال ورابطه فقط من قوائم موضوع العامة، ولا ينسخ نص المقال. الأوقات بتوقيت الخرطوم وسجل منع التكرار محفوظ للمجموعة.</div>' +
    autoPostRows +
    '<div class="auto-post-form"><div class="fld"><label for="autoPostTopic">نوع المحتوى أو موضوع البحث</label>' +
    '<input type="text" id="autoPostTopic" list="autoPostTopics" maxlength="60" '+
    'placeholder="مثال: قصص حب، قصص، نكات أو موضوع آخر" value="'+esc(editingAutoPost?.topic||"")+'" '+(canManage?"":"disabled")+'>' +
    '<datalist id="autoPostTopics"><option value="قصص حب"><option value="قصص"><option value="نكات"></datalist></div>' +
    '<div class="fld"><label for="autoPostTimes">مواعيد النشر اليومية</label>' +
    '<input type="text" id="autoPostTimes" maxlength="63" placeholder="08:30, 20:15" '+
    'value="'+esc((editingAutoPost?.times||[]).join(", "))+'" '+(canManage?"":"disabled")+'>' +
    '<div class="meta">أدخل حتى 8 أوقات بصيغة 24 ساعة، مفصولة بفواصل. الإعداد الجديد يبدأ متوقفاً.</div></div>' +
    '<button class="btn btn-p btn-sm" data-auto-save '+(canManage?"":"disabled")+'>' +
    (editingAutoPost?"حفظ التعديل":"إضافة جدول نشر")+'</button> '+
    (editingAutoPost?'<button class="btn btn-s btn-sm" data-auto-cancel-edit>إلغاء التعديل</button>':"")+
    (!canManage?'<div class="meta" style="white-space:normal;margin-top:8px">تتطلب إدارة النشر التلقائي أن يكون رقم واتساب المرتبط مشرفاً.</div>':"")+
    '</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">إدارة المجموعة</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-s btn-sm" data-group-action="rename" '+(canManage?"":"disabled")+'>تغيير الاسم</button>' +
    '<button class="btn btn-s btn-sm" data-group-action="description" '+(canManage?"":"disabled")+'>تغيير الوصف</button>' +
    '<button class="btn btn-s btn-sm" data-group-action="'+(detail.locked?"unlock":"lock")+'" '+(canManage?"":"disabled")+'>'+
    (detail.locked?"فتح الإرسال للأعضاء":"قصر الإرسال على المشرفين")+'</button></div>' +
    '<div class="meta" style="white-space:normal;margin-top:8px">تتطلب هذه التعديلات صلاحية المشرف وتأكيداً قبل التنفيذ.</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">رابط الدعوة</div>' +
    '<button class="btn btn-s btn-sm" data-group-invite '+(canManage?"":"disabled")+'>عرض رابط الدعوة</button>' +
    '<button class="btn btn-s btn-sm" data-copy-group-invite '+(detail.inviteLink?"":"disabled")+'>نسخ</button>' +
    '<div class="group-invite-value" id="groupInviteValue">'+esc(detail.inviteLink||"لا يظهر الرابط إلا بعد طلبه.")+'</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-p" style="flex:1" data-group-message>📨 إرسال رسالة واحدة</button>' +
    '<button class="btn btn-s" onclick="closeSheet()">إغلاق</button></div>';

  sh.querySelectorAll("[data-group-setting]").forEach(button=>{
    button.addEventListener("click", ()=>toggleGroupSetting(button.dataset.groupSetting));
  });
  sh.querySelectorAll("[data-group-action]").forEach(button=>{
    button.addEventListener("click", ()=>runGroupAdminAction(button.dataset.groupAction));
  });
  sh.querySelector("[data-group-invite]")?.addEventListener("click", showGroupInvite);
  sh.querySelector("[data-copy-group-invite]")?.addEventListener("click", copyGroupInvite);
  sh.querySelector("[data-group-message]")?.addEventListener("click", ()=>openGroupMessageSheet(detail.id));
  sh.querySelector("[data-auto-save]")?.addEventListener("click", saveGroupAutoPost);
  sh.querySelector("[data-auto-cancel-edit]")?.addEventListener("click", ()=>{
    AUTO_POST_EDIT_ID = null;
    renderGroupDetails();
  });
  sh.querySelectorAll("[data-auto-edit]").forEach(button=>
    button.addEventListener("click", ()=>editGroupAutoPost(button.dataset.autoEdit))
  );
  sh.querySelectorAll("[data-auto-test]").forEach(button=>
    button.addEventListener("click", ()=>testGroupAutoPost(button.dataset.autoTest, button))
  );
  sh.querySelectorAll("[data-auto-publish]").forEach(button=>
    button.addEventListener("click", ()=>publishGroupAutoPost(button.dataset.autoPublish, button))
  );
  sh.querySelectorAll("[data-auto-toggle]").forEach(button=>
    button.addEventListener("click", ()=>toggleGroupAutoPost(button.dataset.autoToggle))
  );
  sh.querySelectorAll("[data-auto-delete]").forEach(button=>
    button.addEventListener("click", ()=>deleteGroupAutoPost(button.dataset.autoDelete))
  );
}

function editGroupAutoPost(autoPostId){
  if (!GROUP_DETAIL) return;
  AUTO_POST_EDIT_ID = autoPostId;
  renderGroupDetails();
  document.getElementById("autoPostTopic")?.focus();
}

async function saveGroupAutoPost(){
  if (!GROUP_DETAIL) return;
  const topic = String(document.getElementById("autoPostTopic")?.value||"").trim();
  const times = String(document.getElementById("autoPostTimes")?.value||"").trim();
  if (!topic || !times) return toast("⚠️ أدخل نوع المحتوى ومواعيد النشر");
  const button = document.querySelector("[data-auto-save]");
  const editing = !!AUTO_POST_EDIT_ID;
  if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ…"; }
  try {
    await api("/api/fw/groups/autopost/save", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId: AUTO_POST_EDIT_ID,
      topic,
      times
    });
    AUTO_POST_EDIT_ID = null;
    toast(editing?"✅ تم تحديث الجدول":"✅ تمت إضافة الجدول وهو متوقف");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) {
    toast("❌ "+e.message);
    if (button) { button.disabled = false; button.textContent = editing?"حفظ التعديل":"إضافة جدول نشر"; }
  }
}

async function toggleGroupAutoPost(autoPostId){
  if (!GROUP_DETAIL) return;
  const item = (GROUP_DETAIL.autoPosts||[]).find(entry=>entry.id===autoPostId);
  if (!item) return toast("❌ إعداد النشر غير موجود");
  const enabled = !item.enabled;
  if (!confirm(enabled
    ? "سيُنشر عنوان ورابط من موضوع في الأوقات المحددة. هل تريد التفعيل؟"
    : "إيقاف النشر التلقائي لهذا الجدول؟")) return;
  try {
    await api("/api/fw/groups/autopost/toggle", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId,
      enabled
    });
    toast(enabled?"✅ تم تفعيل الجدول":"⏸️ تم إيقاف الجدول");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) { toast("❌ "+e.message); }
}

async function testGroupAutoPost(autoPostId, button){
  if (!GROUP_DETAIL) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ اختبار المصدر…";
  const preview = Array.from(document.querySelectorAll("[data-auto-preview]"))
    .find(element=>element.dataset.autoPreview===autoPostId);
  if (preview) preview.textContent = "جارٍ جلب عنوان ورابط من موضوع…";
  try {
    const item = await api("/api/fw/groups/autopost/test", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId
    });
    if (preview) preview.innerHTML = '<div>'+esc(item.title)+'</div><a href="'+esc(item.url)+'" target="_blank" rel="noopener noreferrer">فتح المصدر في موضوع</a>';
    toast("✅ نجح اختبار الجلب؛ لم تُرسل رسالة للمجموعة");
  } catch(e) {
    if (preview) preview.innerHTML = '<div class="auto-post-error">'+esc(e.message)+'</div>';
    toast("❌ "+e.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function publishGroupAutoPost(autoPostId, button){
  if (!GROUP_DETAIL) return;
  if (!confirm("سيتم نشر عنوان ورابط واحد الآن في المجموعة. هل تريد المتابعة؟")) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ النشر…";
  try {
    const result = await api("/api/fw/groups/autopost/publish", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId
    });
    toast("✅ تم نشر العنوان والرابط");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) {
    toast("❌ "+e.message);
    button.disabled = false;
    button.textContent = original;
  }
}

async function deleteGroupAutoPost(autoPostId){
  if (!GROUP_DETAIL || !confirm("حذف هذا الجدول؟ سيبقى سجل الروابط محفوظاً لمنع تكرارها.")) return;
  try {
    await api("/api/fw/groups/autopost/delete", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId
    });
    if (AUTO_POST_EDIT_ID === autoPostId) AUTO_POST_EDIT_ID = null;
    toast("🗑 تم حذف الجدول");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) { toast("❌ "+e.message); }
}

async function toggleGroupSetting(setting){
  if (!GROUP_DETAIL) return;
  const current = setting === "antiLink" ? GROUP_DETAIL.antiLinkEnabled : GROUP_DETAIL.inspectInviteEnabled;
  try {
    const result = await api("/api/fw/groups/settings", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      setting,
      enabled: !current
    });
    GROUP_DETAIL = { ...GROUP_DETAIL, ...result };
    renderGroupDetails();
    toast("✅ تم تحديث إعداد المجموعة");
  } catch(e) {
    toast("❌ " + e.message);
  }
}

async function runGroupAdminAction(action){
  if (!GROUP_DETAIL) return;
  let value = "";
  if (action === "rename") {
    value = window.prompt("اكتب الاسم الجديد (حتى 25 حرفاً):", GROUP_DETAIL.name||"");
    if (value === null) return;
  } else if (action === "description") {
    value = window.prompt("اكتب وصف المجموعة الجديد:", GROUP_DETAIL.description||"");
    if (value === null) return;
  } else {
    const promptText = action === "lock"
      ? "سيتم قصر إرسال الرسائل على المشرفين. هل تريد المتابعة؟"
      : "سيُسمح لجميع الأعضاء بإرسال الرسائل. هل تريد المتابعة؟";
    if (!confirm(promptText)) return;
  }
  try {
    await api("/api/fw/groups/action", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      action,
      value
    });
    toast("✅ تم تحديث إعداد المجموعة");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) {
    toast("❌ " + e.message);
  }
}

async function showGroupInvite(){
  if (!GROUP_DETAIL) return;
  const button = document.querySelector("[data-group-invite]");
  if (button) { button.disabled = true; button.textContent = "جارٍ جلب الرابط…"; }
  try {
    const result = await api("/api/fw/groups/invite", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || ""
    });
    GROUP_DETAIL.inviteLink = result.link;
    const value = document.getElementById("groupInviteValue");
    if (value) value.textContent = result.link;
    const copyButton = document.querySelector("[data-copy-group-invite]");
    if (copyButton) copyButton.disabled = false;
  } catch(e) {
    toast("❌ " + e.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "عرض رابط الدعوة"; }
  }
}

async function copyGroupInvite(){
  if (!GROUP_DETAIL?.inviteLink || !navigator.clipboard?.writeText) return toast("تعذّر نسخ الرابط من هذا المتصفح");
  try {
    await navigator.clipboard.writeText(GROUP_DETAIL.inviteLink);
    toast("✅ تم نسخ رابط الدعوة");
  } catch(e) {
    toast("تعذّر نسخ الرابط من هذا المتصفح");
  }
}

let GROUP_MESSAGE = null;
function openGroupMessageSheet(groupId){
  const group = ST.groups.find(item=>item.id===groupId);
  if (!group) return toast("❌ المجموعة غير موجودة في قائمتك");
  GROUP_MESSAGE = { id:group.id, name:group.name||group.id, phoneNumber:group.phoneNumber||"" };
  const sh = document.getElementById("sheet");
  sh.innerHTML =
    '<div class="grip"></div>' +
    '<h2>📨 رسالة واحدة إلى المجموعة</h2>' +
    '<div class="meta" style="margin:-8px 0 16px">' + esc(GROUP_MESSAGE.name) + '</div>' +
    '<div class="fld"><label for="groupMessageText">نص الرسالة</label>' +
    '<textarea id="groupMessageText" maxlength="3500" placeholder="اكتب رسالتك للمجموعة"></textarea>' +
    '<div class="meta">إرسال يدوي واحد فقط. لا يوجد تكرار أو بث.</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-p" id="sendGroupMessageBtn" style="flex:1" onclick="sendGroupMessage()">إرسال</button>' +
    '<button class="btn btn-s" onclick="closeSheet()">إلغاء</button></div>';
  document.getElementById("sheetBg").classList.add("open");
  sh.classList.add("open");
  document.getElementById("groupMessageText").focus();
}

async function sendGroupMessage(){
  const text = String(document.getElementById("groupMessageText")?.value||"").trim();
  if (!GROUP_MESSAGE) return toast("❌ اختر مجموعة أولاً");
  if (!text || text.length > 3500) return toast("⚠️ اكتب رسالة من 1 إلى 3500 حرف");
  if (!confirm("إرسال رسالة واحدة إلى مجموعة " + GROUP_MESSAGE.name + "؟")) return;
  const button = document.getElementById("sendGroupMessageBtn");
  button.disabled = true;
  button.textContent = "جارٍ الإرسال…";
  try {
    await api("/api/fw/groups/send", {
      id: GROUP_MESSAGE.id,
      phoneNumber: GROUP_MESSAGE.phoneNumber,
      text
    });
    toast("✅ تم إرسال رسالة واحدة إلى المجموعة");
    closeSheet();
  } catch(e) {
    toast("❌ " + e.message);
    button.disabled = false;
    button.textContent = "إرسال";
  }
}

// صور الدردشات — كسولة ومخزّنة
function lazyPics(){
  document.querySelectorAll(".avatar[data-jid]").forEach(async el=>{
    const jid = el.dataset.jid;
    if (picCache[jid] === null) return;
    if (picCache[jid]) { el.innerHTML = '<img src="'+picCache[jid]+'">'; return; }
    try {
      const r = await api("/api/fw/pic?jid=" + encodeURIComponent(jid) + "&token=" + TOKEN);
      picCache[jid] = r.url || null;
      if (r.url) el.innerHTML = '<img src="'+r.url+'" onerror="this.remove()">';
    } catch(e){ picCache[jid] = null; }
  });
}

// ─── شاشة إنشاء/تعديل قاعدة ─────────────────────────────────────
let SHEET = { srcSel:[], dst:null, flags:{}, editing:null, num:null };

function openRuleSheet(ruleId){
  const r = ruleId ? ST.rules.find(x=>x.id===ruleId) : null;
  SHEET = {
    editing: r ? r.id : null,
    srcSel: r ? [...r.sources] : [],
    dst: r ? r.destination : null,
    num: r ? r.sourceNumber : (ST.numbers[0] || null),
    flags: {
      blockLinks: !!r?.blockLinks, blockImages: !!r?.blockImages,
      blockVideos: !!r?.blockVideos, blockAudios: !!r?.blockAudios, noForward: !!r?.noForward,
    },
    name: r?.name || "",
  };
  drawSheet();
  document.getElementById("sheetBg").classList.add("open");
  document.getElementById("sheet").classList.add("open");
}
function closeSheet(){
  document.getElementById("sheetBg").classList.remove("open");
  document.getElementById("sheet").classList.remove("open");
}

function drawSheet(){
  const sh = document.getElementById("sheet");
  const all = [...ST.channels.map(c=>({...c,_t:"ch"})), ...ST.groups.map(g=>({...g,_t:"gr"}))];
  const dstAll = [...ST.groups.map(g=>({...g,_t:"gr"})), ...ST.channels.map(c=>({...c,_t:"ch"}))];
  const f = SHEET.flags;
  sh.innerHTML =
    '<div class="grip"></div>' +
    '<h2>' + (SHEET.editing ? "✏️ تعديل القاعدة" : "➕ قاعدة تحويل جديدة") + '</h2>' +

    (ST.numbers.length > 1 ?
      '<div class="fld"><label>📱 رقم الواتساب</label><div class="pick" style="max-height:130px">' +
      ST.numbers.map(n =>
        '<div class="it '+(SHEET.num===n?"sel":"")+'" onclick="SHEET.num=\\''+n+'\\';drawSheet()"><span class="chk">✓</span>'+esc(n)+'</div>'
      ).join("") + '</div></div>'
    : "") +

    '<div class="fld"><label>📥 المصادر — اختر واحداً أو أكثر (' + SHEET.srcSel.length + ' محدد)</label>' +
    '<input type="text" id="srcFilter" placeholder="🔍 فلترة سريعة…" oninput="filterPick(this,\\'srcPick\\')" style="margin-bottom:8px">' +
    '<div class="pick" id="srcPick">' +
    (all.length ? all.map(x =>
      '<div class="it '+(SHEET.srcSel.includes(x.id)?"sel":"")+'" data-nm="'+esc((x.name||"").toLowerCase())+'" onclick="togSrc(\\''+esc(x.id)+'\\')">' +
      '<span class="chk">✓</span>' + (x._t==="ch"?"📺 ":"👥 ") + esc(x.name) + '</div>'
    ).join("") : '<div class="it" style="color:var(--mut)">لا توجد عناصر — أضف قنوات أو حدّث المجموعات أولاً</div>') +
    '</div></div>' +

    '<div class="fld"><label>📤 الوجهة — اختر واحدة</label>' +
    '<input type="text" placeholder="🔍 فلترة سريعة…" oninput="filterPick(this,\\'dstPick\\')" style="margin-bottom:8px">' +
    '<div class="pick" id="dstPick">' +
    (dstAll.length ? dstAll.map(x =>
      '<div class="it '+(SHEET.dst===x.id?"sel":"")+'" data-nm="'+esc((x.name||"").toLowerCase())+'" onclick="SHEET.dst=\\''+esc(x.id)+'\\';drawSheet()">' +
      '<span class="chk">✓</span>' + (x._t==="ch"?"📺 ":"👥 ") + esc(x.name) + '</div>'
    ).join("") : '<div class="it" style="color:var(--mut)">لا توجد عناصر</div>') +
    '</div>' +
    '<div style="margin-top:8px"><input type="text" id="dstPhone" placeholder="👤 أو رقم شخص مباشرة: 9665XXXXXXXX" value="' +
    (SHEET.dst && SHEET.dst.endsWith("@s.whatsapp.net") ? esc(SHEET.dst.split("@")[0]) : "") + '" oninput="dstFromPhone(this.value)"></div></div>' +

    '<div class="fld"><label>⚙️ خيارات التحويل</label><div class="flags">' +
    flagBtn("blockLinks","🚫 حذف الروابط") + flagBtn("noForward","↩️ بدون علامة توجيه") +
    flagBtn("blockImages","🚫 حذف الصور") + flagBtn("blockVideos","🚫 حذف الفيديو") +
    flagBtn("blockAudios","🚫 حذف الصوت") +
    '</div></div>' +

    '<div class="fld"><label>🏷️ اسم القاعدة (اختياري)</label>' +
    '<input type="text" id="ruleName" placeholder="يُولَّد تلقائياً إن تُرك فارغاً" value="'+esc(SHEET.name||"")+'"></div>' +

    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-p" style="flex:1" onclick="saveRule()">💾 ' + (SHEET.editing?"حفظ التعديلات":"إنشاء القاعدة") + '</button>' +
    (SHEET.editing ? '<button class="btn btn-d" onclick="delRule()">🗑 حذف</button>' : "") +
    '</div>';
}
function flagBtn(k, label){
  return '<div class="flag '+(SHEET.flags[k]?"on":"")+'" onclick="SHEET.flags.'+k+'=!SHEET.flags.'+k+';drawSheet()">' +
    '<span>'+(SHEET.flags[k]?"✅":"⬜")+'</span> '+label+'</div>';
}
function togSrc(id){
  const i = SHEET.srcSel.indexOf(id);
  if (i>=0) SHEET.srcSel.splice(i,1); else SHEET.srcSel.push(id);
  drawSheet();
}
function dstFromPhone(v){
  const d = v.replace(/\\D/g,"");
  if (d.length >= 7) SHEET.dst = d + "@s.whatsapp.net";
}
function filterPick(inp, pickId){
  const q = inp.value.trim().toLowerCase();
  document.querySelectorAll("#"+pickId+" .it").forEach(el=>{
    el.style.display = (!q || (el.dataset.nm||"").includes(q)) ? "" : "none";
  });
}

async function saveRule(){
  const name = document.getElementById("ruleName")?.value?.trim() || "";
  if (!SHEET.srcSel.length) return toast("⚠️ اختر مصدراً واحداً على الأقل");
  if (!SHEET.dst) return toast("⚠️ اختر وجهة");
  try {
    if (SHEET.editing) {
      await api("/api/fw/rule/update", { id: SHEET.editing, patch: {
        sources: SHEET.srcSel, destination: SHEET.dst, sourceNumber: SHEET.num,
        ...SHEET.flags, ...(name ? {name} : {}),
      }});
      toast("✅ تم حفظ التعديلات");
    } else {
      await api("/api/fw/rule/create", {
        sources: SHEET.srcSel, destination: SHEET.dst, sourceNumber: SHEET.num,
        ...SHEET.flags, ...(name ? {name} : {}),
      });
      toast("✅ تم إنشاء القاعدة");
    }
    closeSheet(); await load();
  } catch(e){ toast("❌ " + e.message); }
}

async function delRule(){
  if (!confirm("حذف هذه القاعدة نهائياً؟")) return;
  try { await api("/api/fw/rule/delete", { id: SHEET.editing }); toast("🗑 تم حذف القاعدة"); closeSheet(); await load(); }
  catch(e){ toast("❌ " + e.message); }
}

load();
setInterval(load, 30000);
</script>
</body>
</html>`;
