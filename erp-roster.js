// 사람 명부 — 수파베이스 people(명부) · company_settings(회사 설정)를 읽고 쓴다.
// 사람 정보는 이 파일이나 깃허브에 두지 않는다. 잠긴 수파베이스에만 있다(대표 · 인사만, RLS).
(function(){
  // 공개용(anon) 키만 사용 — erp-ledger.js 와 같은 프로젝트 · 같은 키
  var SUPABASE_URL = "https://dykljzknwcqncxusiqkf.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a2xqemtud2NxbmN4dXNpcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODM3NTEsImV4cCI6MjEwNTE1OTc1MX0.vo7fWD4xrTdZXjAG8NBUd1Dcmj7EjOLcYBPj7-ROQGM";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var DEPTS = ["영업","경리","배송"];
  var TYPES = ["모름","정규직","계약직","단시간","일용"];
  var PAPERS = ["모름","있음","없음"];
  var SOON_DAYS = 30;   // 계약 종료일이 이 날수 안이면 「곧 만료」

  var $ = function(id){ return document.getElementById(id); };
  var role = null;       // 'ceo' | 'hr' | ... (허용표 판정)
  var five = "모름";     // 상시 5인 이상
  var list = [];
  var editing = null;    // 고치는 중인 사람 id

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function opts(arr, cur, blankLabel){
    return (blankLabel != null ? '<option value="">'+blankLabel+'</option>' : "") +
      arr.map(function(v){ return '<option'+(v===cur?' selected':'')+'>'+v+'</option>'; }).join("");
  }
  function badge(cls, text){ return '<span class="badge '+cls+'">'+esc(text)+'</span>'; }
  var UNKNOWN = badge("b-amber", "모름");
  function today(){ var d = new Date(), p = function(n){ return (n<10?"0":"")+n; }; return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
  function addDays(iso, n){ var d = new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); var p = function(x){ return (x<10?"0":"")+x; }; return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }

  // ── 노무 배지 (판단이 아니라 「물어볼 곳」) ─────────────
  function laborBadges(p){
    var out = [], t = today();
    if (p.contract_paper === "없음") out.push(["b-red","계약서 없음"]);
    else if (p.contract_paper === "모름") out.push(["b-amber","계약서 모름"]);
    else if (!p.delivered_on) out.push(["b-amber","교부일 모름"]);
    if (p.contract_end){
      if (p.contract_end < t) out.push(["b-red","만료 지남"]);
      else if (p.contract_end <= addDays(t, SOON_DAYS)) out.push(["b-amber","곧 만료"]);
    } else if (p.employment_type === "계약직") out.push(["b-amber","종료일 모름"]);
    if (!out.length) out.push(["b-ok","정상"]);
    return out;
  }
  function leaveCell(){
    if (five === "예") return '<a href="erp-approvals.html#leave">전자결재에서 확인</a>';
    if (five === "아니오") return badge("b-grey","해당 없음(현재)");
    return UNKNOWN;
  }
  // 빈칸 표시: 정규직의 계약 종료일 · 계약서 없음의 교부일만 「모름」이 아니다
  function endCell(p){
    if (p.contract_end) return esc(p.contract_end);
    return p.employment_type === "정규직" ? badge("b-grey","정함 없음") : UNKNOWN;
  }
  function deliveredCell(p){
    if (p.delivered_on) return esc(p.delivered_on);
    return p.contract_paper === "없음" ? "—" : UNKNOWN;
  }
  function paperCell(p){
    if (p.contract_paper === "모름") return UNKNOWN;
    return badge(p.contract_paper === "있음" ? "b-ok" : "b-red", p.contract_paper);
  }

  // ── 로그인 · 권한 ─────────────
  async function show(session){
    var on = !!session;
    $("login").hidden = on; $("logout").hidden = !on;
    $("who").textContent = on ? session.user.email : "";
    $("app").hidden = true; $("denied").hidden = true;
    if (!on) return;
    var r = await sb.rpc("my_role");
    role = r.error ? null : r.data;
    if (role !== "ceo" && role !== "hr"){ $("denied").hidden = false; return; }
    $("app").hidden = false;
    $("five").disabled = role !== "ceo";
    $("fiveHint").textContent = role === "ceo" ? "바꾸면 바로 저장됩니다." : "회사 설정은 대표만 바꿀 수 있습니다.";
    load();
  }

  async function load(){
    $("sum").textContent = "불러오는 중…";
    var s = await sb.from("company_settings").select("five_or_more").eq("id", 1).maybeSingle();
    five = (s.data && s.data.five_or_more) || "모름";
    $("five").value = five;
    var r = await sb.from("people").select("*").order("id", {ascending:true});
    if (r.error){ $("sum").textContent = "불러오지 못했습니다: " + r.error.message; $("rows").innerHTML = ""; return; }
    list = r.data || [];
    render();
  }

  function render(){
    var red = 0, amber = 0, ok = 0, unknown = 0;
    $("rows").innerHTML = list.length ? list.map(function(p){
      if (editing === p.id) return editRow(p);
      var bs = laborBadges(p);
      bs.forEach(function(b){ if (b[0]==="b-red") red++; else if (b[0]==="b-amber") amber++; else ok++; });
      var cells = [
        esc(p.name),
        p.dept ? esc(p.dept) : UNKNOWN,
        p.employment_type === "모름" ? UNKNOWN : esc(p.employment_type),
        p.hire_date ? esc(p.hire_date) : UNKNOWN,
        endCell(p), paperCell(p), deliveredCell(p)
      ];
      cells.forEach(function(c){ if (c === UNKNOWN) unknown++; });
      return '<tr>'+cells.map(function(c){ return '<td>'+c+'</td>'; }).join("")+
        '<td>'+bs.map(function(b){ return badge(b[0], b[1]); }).join("")+'</td>'+
        '<td>'+leaveCell()+'</td>'+
        '<td class="act"><button class="ghost" data-act="edit" data-id="'+p.id+'" type="button">고치기</button><button class="danger" data-act="del" data-id="'+p.id+'" type="button">지우기</button></td></tr>';
    }).join("") : '<tr><td colspan="10" class="empty">아직 명부에 사람이 없습니다. 위에서 넣어 주세요.</td></tr>';
    $("sum").innerHTML = list.length ?
      '<b>'+list.length+'명</b>'+badge("b-red","빨강 "+red)+badge("b-amber","노랑 "+amber)+badge("b-ok","정상 "+ok)+'<span style="color:#6b7280">빈칸(모름) '+unknown+'개</span>' :
      '0명';
  }

  function editRow(p){
    var id = p.id;
    return '<tr data-edit="'+id+'">'+
      '<td><input data-k="name" value="'+esc(p.name)+'" maxlength="40" size="8"></td>'+
      '<td><select data-k="dept">'+opts(DEPTS, p.dept, "(모름)")+'</select></td>'+
      '<td><select data-k="employment_type">'+opts(TYPES, p.employment_type)+'</select></td>'+
      '<td><input data-k="hire_date" type="date" value="'+esc(p.hire_date||"")+'"></td>'+
      '<td><input data-k="contract_end" type="date" value="'+esc(p.contract_end||"")+'"></td>'+
      '<td><select data-k="contract_paper">'+opts(PAPERS, p.contract_paper)+'</select></td>'+
      '<td><input data-k="delivered_on" type="date" value="'+esc(p.delivered_on||"")+'"'+(p.contract_paper==="있음"?"":" disabled")+'></td>'+
      '<td colspan="2" class="err" data-err></td>'+
      '<td class="act"><button data-act="save" data-id="'+id+'" type="button">저장</button><button class="ghost" data-act="cancel" type="button">취소</button></td></tr>';
  }

  // 화면 값 → 표에 넣을 값 (빈칸은 null = 모름)
  function readFields(get){
    var paper = get("contract_paper");
    var v = {
      name: get("name").trim(),
      dept: get("dept") || null,
      employment_type: get("employment_type") || "모름",
      hire_date: get("hire_date") || null,
      contract_end: get("contract_end") || null,
      contract_paper: paper || "모름",
      delivered_on: paper === "있음" ? (get("delivered_on") || null) : null   // 계약서가 없으면 준 날도 없다
    };
    if (!v.name) return {error: "이름을 넣어주세요."};
    if (v.contract_end && v.hire_date && v.contract_end < v.hire_date) return {error: "계약 종료일이 입사일보다 앞입니다."};
    return {value: v};
  }

  // ── 새 사람 넣기 ─────────────
  $("f").contract_paper.addEventListener("change", function(e){
    var on = e.target.value === "있음"; $("f").delivered_on.disabled = !on; if (!on) $("f").delivered_on.value = "";
  });
  $("f").addEventListener("submit", async function(e){
    e.preventDefault();
    var f = e.target, r = readFields(function(k){ return f[k].value; });
    if (r.error){ $("err").textContent = r.error; return; }
    $("err").textContent = ""; $("addbtn").disabled = true;
    var res = await sb.from("people").insert(r.value);
    $("addbtn").disabled = false;
    if (res.error){ $("err").textContent = "저장하지 못했습니다: " + res.error.message; return; }
    f.reset(); f.delivered_on.disabled = true; load();
  });

  // ── 고치기 · 지우기 ─────────────
  $("rows").addEventListener("change", function(e){
    if (e.target.getAttribute("data-k") !== "contract_paper") return;
    var tr = e.target.closest("tr"), d = tr.querySelector('[data-k="delivered_on"]'), on = e.target.value === "있음";
    d.disabled = !on; if (!on) d.value = "";
  });
  $("rows").addEventListener("click", async function(e){
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
    if (act === "edit"){ editing = id; render(); return; }
    if (act === "cancel"){ editing = null; render(); return; }
    if (act === "del"){
      var p = list.filter(function(x){ return x.id === id; })[0];
      if (!confirm("「"+(p ? p.name : "")+"」을(를) 명부에서 지울까요?\n이 사람의 월급 줄도 같이 지워지고, 되돌릴 수 없습니다.")) return;
      var d = await sb.from("people").delete().eq("id", id);
      if (d.error) alert("지우지 못했습니다: " + d.error.message);
      load(); return;
    }
    if (act === "save"){
      var tr = b.closest("tr"), r = readFields(function(k){ return tr.querySelector('[data-k="'+k+'"]').value; });
      if (r.error){ tr.querySelector("[data-err]").textContent = r.error; return; }
      b.disabled = true;
      var u = await sb.from("people").update(r.value).eq("id", id);
      if (u.error){ b.disabled = false; tr.querySelector("[data-err]").textContent = "저장하지 못했습니다: " + u.error.message; return; }
      editing = null; load();
    }
  });

  // ── 상시 5인 이상 (대표만 바꿈) ─────────────
  $("five").addEventListener("change", async function(e){
    var v = e.target.value; $("fiveMsg").textContent = "";
    var r = await sb.from("company_settings").update({ five_or_more: v, updated_at: new Date().toISOString() }).eq("id", 1).select();
    if (r.error || !r.data || !r.data.length){ $("fiveMsg").textContent = "바꾸지 못했습니다" + (r.error ? ": " + r.error.message : " (대표만 바꿀 수 있습니다)"); e.target.value = five; return; }
    five = v; render();
  });

  $("lf").addEventListener("submit", async function(e){
    e.preventDefault();
    var f = e.target; $("lerr").textContent = ""; $("lbtn").disabled = true;
    var r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    $("lbtn").disabled = false; f.password.value = "";
    if (r.error){ $("lerr").textContent = "로그인에 실패했습니다. 이메일·비밀번호를 확인해 주세요."; return; }
    show(r.data.session);
  });
  $("logout").addEventListener("click", async function(){ await sb.auth.signOut(); editing = null; show(null); });
  $("reload").addEventListener("click", load);

  sb.auth.getSession().then(function(r){ show(r.data.session); });
})();
