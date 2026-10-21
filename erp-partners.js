// 거래처 대장 — 수파베이스 partners 표를 읽고 쓴다.
// 거래처 정보는 이 파일이나 깃허브에 두지 않는다. 잠긴 수파베이스에만 있다(보기: 재직 직원 / 넣기·고치기·지우기: 대표만, RLS).
(function(){
  // 공개용(anon) 키만 사용 — erp-ledger.js 와 같은 프로젝트 · 같은 키
  var SUPABASE_URL = "https://dykljzknwcqncxusiqkf.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a2xqemtud2NxbmN4dXNpcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODM3NTEsImV4cCI6MjEwNTE1OTc1MX0.vo7fWD4xrTdZXjAG8NBUd1Dcmj7EjOLcYBPj7-ROQGM";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var KINDS = ["고객","협력사","둘 다"];
  var SRC = {search:"검색", map:"지도", referral:"지인 소개", sns:"SNS", phone:"전화", other:"기타", unknown:"모르겠음"};   // 문의 폼 · 문의 대장과 같은 이름
  var SOON_DAYS = 7;   // 다음 접촉일이 이 날수 안이면 「곧」

  var $ = function(id){ return document.getElementById(id); };
  var role = null;      // 'ceo' | 'hr' | 'finance' | 'staff' (허용표 판정)
  var list = [];
  var editing = null;   // 고치는 중인 거래처 id
  var pasted = [];      // 붙여넣기 미리보기에서 넣을 줄

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function badge(cls, text){ return '<span class="badge '+cls+'">'+esc(text)+'</span>'; }
  var UNKNOWN = badge("b-amber", "모름");
  function pad(n){ return (n<10?"0":"")+n; }
  function iso(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ var d = new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return iso(d); }
  function fmtPhone(p){ return p.length===11 ? p.replace(/(\d{3})(\d{4})(\d{4})/,"$1-$2-$3") : p.length===10 ? p.replace(/(\d{2,3})(\d{3,4})(\d{4})/,"$1-$2-$3") : p; }
  function isCeo(){ return role === "ceo"; }

  // ── 로그인 · 권한 ─────────────
  async function show(session){
    var on = !!session;
    $("login").hidden = on; $("logout").hidden = !on; $("maskbtn").hidden = !on;
    $("who").textContent = on ? session.user.email : "";
    $("app").hidden = true; $("denied").hidden = true;
    if (!on) return;
    var r = await sb.rpc("my_role");
    role = r.error ? null : r.data;
    if (!role){ $("denied").hidden = false; return; }
    $("app").hidden = false;
    $("addCard").hidden = !isCeo(); $("pasteCard").hidden = !isCeo();
    $("roleNote").textContent = isCeo()
      ? "대표 계정입니다. 넣기 · 고치기 · 지우기를 할 수 있습니다."
      : "보기만 할 수 있습니다. 넣기 · 고치기 · 지우기는 대표만 합니다.";
    load();
  }

  async function load(){
    $("sum").textContent = "불러오는 중…";
    var r = await sb.from("partners").select("*").order("id", {ascending:true});
    if (r.error){ $("sum").textContent = "불러오지 못했습니다: " + r.error.message; $("rows").innerHTML = ""; return; }
    list = r.data || [];
    render();
  }

  function render(){
    var t = today(), soon = addDays(t, SOON_DAYS);
    var cnt = {"고객":0,"협력사":0,"둘 다":0,"모름":0}, overdue = 0, unknown = 0;
    var phones = {};
    list.forEach(function(p){ if (p.phone) phones[p.phone] = (phones[p.phone]||0) + 1; });
    $("rows").innerHTML = list.length ? list.map(function(p){
      cnt[p.kind || "모름"]++;
      var kind = p.kind ? badge(p.kind === "고객" ? "b-ok" : p.kind === "협력사" ? "b-grey" : "b-blue", p.kind) : UNKNOWN;
      var phone = p.phone ? '<span class="ph">'+esc(fmtPhone(p.phone))+'</span>'+(phones[p.phone] > 1 ? badge("b-blue","같은 연락처") : "") : UNKNOWN;
      var src = p.first_source ? esc(SRC[p.first_source] || p.first_source) : UNKNOWN;
      var last = p.last_contact ? esc(p.last_contact) : UNKNOWN;
      var next = UNKNOWN;
      if (p.next_contact){
        next = esc(p.next_contact);
        if (p.next_contact < t){ next += " " + badge("b-red","접촉일 지남"); overdue++; }
        else if (p.next_contact <= soon) next += " " + badge("b-amber","곧");
      }
      var owner = p.owner ? '<span class="ow">'+esc(p.owner)+'</span>' : UNKNOWN;
      [p.kind, p.phone, p.first_source, p.last_contact, p.next_contact, p.owner].forEach(function(v){ if (!v) unknown++; });
      return '<tr'+(editing === p.id ? ' class="editing"' : '')+'>'+
        '<td><span class="nm">'+esc(p.name)+'</span></td><td>'+kind+'</td><td>'+phone+'</td><td>'+src+'</td><td>'+last+'</td><td>'+next+'</td><td>'+owner+'</td>'+
        '<td class="act">'+(isCeo() ? '<button class="ghost" data-act="edit" data-id="'+p.id+'" type="button">고치기</button><button class="danger" data-act="del" data-id="'+p.id+'" type="button">지우기</button>' : '')+'</td></tr>';
    }).join("") : '<tr><td colspan="8" class="empty">아직 거래처가 없습니다.'+(isCeo() ? ' 위에서 넣거나 시트에서 붙여넣어 주세요.' : '')+'</td></tr>';
    $("sum").innerHTML = list.length ?
      '<b>'+list.length+'곳</b>'+badge("b-ok","고객 "+cnt["고객"])+badge("b-grey","협력사 "+cnt["협력사"])+badge("b-blue","둘 다 "+cnt["둘 다"])+
        (cnt["모름"] ? badge("b-amber","구분 모름 "+cnt["모름"]) : "")+
        (overdue ? badge("b-red","접촉일 지남 "+overdue) : "")+
        '<span style="color:#6b7280">빈칸(모름) '+unknown+'개</span>' :
      '0곳';
  }

  // ── 화면 값 → 표에 넣을 값 (빈칸은 null = 모름) ─────────────
  function readFields(get){
    var phone = get("phone").replace(/\D/g, "");
    var v = {
      name: get("name").trim(),
      kind: get("kind") || null,
      phone: phone || null,
      first_source: get("first_source") || null,
      last_contact: get("last_contact") || null,
      next_contact: get("next_contact") || null,
      owner: get("owner").trim() || null
    };
    if (!v.name) return {error: "이름을 넣어주세요."};
    if (v.phone && (v.phone.length < 9 || v.phone.length > 11)) return {error: "연락처는 숫자 9~11자리로 넣어주세요. 모르면 비워 두세요."};
    return {value: v};
  }

  // ── 새 거래처 넣기 (대표만) ─────────────
  $("f").addEventListener("submit", async function(e){
    e.preventDefault();
    if (!isCeo()) return;
    var f = e.target, r = readFields(function(k){ return f[k].value; });
    if (r.error){ $("err").textContent = r.error; return; }
    $("err").textContent = ""; $("addbtn").disabled = true;
    var res = await sb.from("partners").insert(r.value);
    $("addbtn").disabled = false;
    if (res.error){ $("err").textContent = "저장하지 못했습니다: " + res.error.message; return; }
    f.reset(); $("saved").textContent = "「"+r.value.name+"」 넣었습니다 ✓"; load();
  });

  // ── 고치기 · 지우기 (대표만) ─────────────
  function openEdit(p){
    var ef = $("ef");
    editing = p.id;
    ef.name.value = p.name || "";
    ef.kind.value = KINDS.indexOf(p.kind) >= 0 ? p.kind : "";
    ef.phone.value = p.phone || "";
    ef.first_source.value = SRC[p.first_source] ? p.first_source : "";
    ef.last_contact.value = p.last_contact || "";
    ef.next_contact.value = p.next_contact || "";
    ef.owner.value = p.owner || "";
    $("editName").textContent = p.name || "";
    $("eerr").textContent = ""; $("saved").textContent = "";
    $("editCard").hidden = false;
    render();
    $("editCard").scrollIntoView({behavior:"smooth", block:"start"});
    ef.kind.focus();
  }
  function closeEdit(){ editing = null; $("editCard").hidden = true; render(); }

  $("rows").addEventListener("click", async function(e){
    var b = e.target.closest("button[data-act]"); if (!b || !isCeo()) return;
    var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
    var p = list.filter(function(x){ return x.id === id; })[0];
    if (act === "edit" && p){ openEdit(p); return; }
    if (act === "del"){
      if (!confirm("「"+(p ? p.name : "")+"」을(를) 거래처 대장에서 지울까요?\n되돌릴 수 없습니다.")) return;
      var d = await sb.from("partners").delete().eq("id", id);
      if (d.error) alert("지우지 못했습니다: " + d.error.message);
      if (editing === id) closeEdit();
      load();
    }
  });

  $("ef").addEventListener("submit", async function(e){
    e.preventDefault();
    var ef = e.target, r = readFields(function(k){ return ef[k].value; });
    if (r.error){ $("eerr").textContent = r.error; return; }
    $("eerr").textContent = ""; $("savebtn").disabled = true;
    var u = await sb.from("partners").update(r.value).eq("id", editing).select();
    $("savebtn").disabled = false;
    if (u.error){ $("eerr").textContent = "저장하지 못했습니다: " + u.error.message; return; }
    if (!u.data || !u.data.length){ $("eerr").textContent = "저장되지 않았습니다 (고칠 권한이 없거나 이미 지워진 거래처입니다)."; return; }
    editing = null; $("editCard").hidden = true;
    $("saved").textContent = "「"+r.value.name+"」 저장했습니다 ✓";
    load();
  });
  $("cancelEdit").addEventListener("click", closeEdit);

  // ── 시트에서 붙여넣기 (대표만) ─────────────
  function parseDate(s){
    s = (s || "").trim(); if (!s) return {v:null};
    var m, y, mo, d, note = "";
    if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/))){ y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})$/)) || (m = s.match(/^(\d{1,2})월\s*(\d{1,2})일?$/))){ y = new Date().getFullYear(); mo = +m[1]; d = +m[2]; note = "올해로 읽음"; }
    else return {v:null, note:"날짜 「"+s+"」를 읽지 못해 비움"};
    var dt = new Date(y, mo-1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo-1 || dt.getDate() !== d) return {v:null, note:"날짜 「"+s+"」가 달력에 없어 비움"};
    return {v: iso(dt), note: note};
  }
  var SRC_BY_LABEL = {};
  Object.keys(SRC).forEach(function(k){ SRC_BY_LABEL[SRC[k]] = k; SRC_BY_LABEL[k] = k; });
  SRC_BY_LABEL["지인소개"] = "referral"; SRC_BY_LABEL["모름"] = "unknown";

  function parsePaste(text){
    var lines = text.replace(/\r/g, "").split("\n").filter(function(l){ return l.trim() !== ""; });
    var sep = lines.some(function(l){ return l.indexOf("\t") >= 0; }) ? "\t" : (lines.some(function(l){ return l.indexOf(",") >= 0; }) ? "," : "\t");
    var rows = [], existing = {};
    list.forEach(function(p){ if (p.phone) existing[p.phone] = true; });
    var seen = {};
    lines.forEach(function(line, i){
      var c = line.split(sep).map(function(x){ return x.trim(); });
      if (i === 0 && c[0] === "이름") return;   // 머리글
      var notes = [], v = {name: c[0] || ""};
      var kind = (c[1] || "").replace(/\s+/g, "");
      v.kind = kind === "" ? null : kind === "둘다" ? "둘 다" : (KINDS.indexOf(c[1]) >= 0 ? c[1] : null);
      if (kind !== "" && v.kind === null) notes.push("구분 「"+c[1]+"」는 모름으로 비움");
      var ph = (c[2] || "").replace(/\D/g, "");
      v.phone = ph || null;
      if (ph && (ph.length < 9 || ph.length > 11)){ v.phone = null; notes.push("연락처 자릿수가 맞지 않아 비움"); }
      if (v.phone && existing[v.phone]) notes.push("같은 연락처가 대장에 이미 있음");
      if (v.phone && seen[v.phone]) notes.push("붙여넣은 줄 안에 같은 연락처가 있음");
      if (v.phone) seen[v.phone] = true;
      var sr = (c[3] || "").replace(/\(.*\)/, "").trim();
      v.first_source = sr === "" ? null : (SRC_BY_LABEL[sr] || null);
      if (sr !== "" && v.first_source === null) notes.push("경로 「"+c[3]+"」는 모름으로 비움");
      var d1 = parseDate(c[4]), d2 = parseDate(c[5]);
      v.last_contact = d1.v; v.next_contact = d2.v;
      if (d1.note) notes.push("최근 접촉일: "+d1.note); if (d2.note) notes.push("다음 접촉일: "+d2.note);
      v.owner = (c[6] || "").trim() || null;
      if (v.owner && v.owner.length > 40){ v.owner = v.owner.slice(0, 40); notes.push("담당이 길어 40자로 자름"); }
      var bad = null;
      if (!v.name) bad = "이름이 비어 있어 넣지 않음";
      else if (v.name.length > 80) bad = "이름이 80자를 넘어 넣지 않음";
      rows.push({v: v, notes: notes, bad: bad});
    });
    return rows;
  }
  function renderPreview(){
    var text = $("paste").value, pv = $("pv");
    pasted = []; $("perr").textContent = "";
    if (!text.trim()){ pv.innerHTML = ""; $("pasteGo").hidden = true; $("pasteClear").hidden = true; return; }
    var rows = parsePaste(text);
    var ok = rows.filter(function(r){ return !r.bad; });
    pasted = ok.map(function(r){ return r.v; });
    pv.innerHTML = '<div class="tools"><span>미리보기 — <b>'+ok.length+'곳</b> 넣을 수 있음'+(rows.length-ok.length ? ', <span style="color:#b91c1c">'+(rows.length-ok.length)+'줄 제외</span>' : '')+'</span></div>'+
      '<div class="wrap"><table><thead><tr><th>이름</th><th>구분</th><th>연락처</th><th>경로</th><th>최근 접촉일</th><th>다음 접촉일</th><th>담당</th><th>확인</th></tr></thead><tbody>'+
      rows.map(function(r){
        var v = r.v, cell = function(x){ return x ? esc(x) : UNKNOWN; };
        return '<tr><td'+(r.bad ? ' class="bad"' : '')+'><span class="pvnm">'+esc(v.name)+'</span></td><td>'+cell(v.kind)+'</td><td>'+(v.phone ? esc(fmtPhone(v.phone)) : UNKNOWN)+'</td><td>'+(v.first_source ? esc(SRC[v.first_source]) : UNKNOWN)+'</td><td>'+cell(v.last_contact)+'</td><td>'+cell(v.next_contact)+'</td><td>'+cell(v.owner)+'</td>'+
          '<td class="why'+(r.bad ? ' bad' : r.notes.length ? ' fix' : '')+'">'+(r.bad ? esc(r.bad) : r.notes.length ? esc(r.notes.join(" · ")) : "✓")+'</td></tr>';
      }).join("")+'</tbody></table></div>';
    $("pasteGo").hidden = !ok.length; $("pasteClear").hidden = false;
  }
  $("paste").addEventListener("input", renderPreview);
  $("pasteClear").addEventListener("click", function(){ $("paste").value = ""; renderPreview(); });
  $("pasteGo").addEventListener("click", async function(){
    if (!isCeo() || !pasted.length) return;
    if (!confirm(pasted.length+"곳을 거래처 대장에 넣을까요?")) return;
    $("pasteGo").disabled = true; $("perr").textContent = "";
    var res = await sb.from("partners").insert(pasted);
    $("pasteGo").disabled = false;
    if (res.error){ $("perr").textContent = "넣지 못했습니다(아무것도 저장되지 않았습니다): " + res.error.message; return; }
    var n = pasted.length;
    $("paste").value = ""; renderPreview();
    $("saved").textContent = n+"곳 넣었습니다 ✓";
    load();
  });

  // ── 캡처용: 이름 가리기 ─────────────
  $("maskbtn").addEventListener("click", function(){
    var on = !document.body.classList.contains("mask");
    document.body.classList.toggle("mask", on);
    this.setAttribute("aria-pressed", on ? "true" : "false");
    this.textContent = on ? "가리는 중 · 누르면 보임" : "캡처용: 이름 가리기";
  });

  $("lf").addEventListener("submit", async function(e){
    e.preventDefault();
    var f = e.target; $("lerr").textContent = ""; $("lbtn").disabled = true;
    var r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    $("lbtn").disabled = false; f.password.value = "";
    if (r.error){ $("lerr").textContent = "로그인에 실패했습니다. 이메일·비밀번호를 확인해 주세요."; return; }
    show(r.data.session);
  });
  $("logout").addEventListener("click", async function(){ await sb.auth.signOut(); editing = null; $("editCard").hidden = true; show(null); });
  $("reload").addEventListener("click", load);

  sb.auth.getSession().then(function(r){ show(r.data.session); });
})();
