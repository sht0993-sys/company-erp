// 거래 분류함 — 수파베이스 txn(거래) · money_category(내 분류) · v_month_pnl(월별 손익)을 읽고,
// 거래의 「내 분류 · 누가 · 귀속월」 세 칸만 고친다. 금액 · 날짜 · 적요는 통장 원본이 정본이라 고치지 않는다.
// 통장 정보는 이 파일이나 깃허브에 두지 않는다. 잠긴 수파베이스에만 있다(대표만, RLS).
(function(){
  // 공개용(anon) 키만 사용 — erp-ledger.js 와 같은 프로젝트 · 같은 키
  var SUPABASE_URL = "https://dykljzknwcqncxusiqkf.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a2xqemtud2NxbmN4dXNpcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODM3NTEsImV4cCI6MjEwNTE1OTc1MX0.vo7fWD4xrTdZXjAG8NBUd1Dcmj7EjOLcYBPj7-ROQGM";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var KIND_ORDER = ["판 것(매출)", "쓴 것(비용)", "손익 아님(보증금·카드정산·대출원금 등)"];
  var $ = function(id){ return document.getElementById(id); };
  var role = null;
  var txns = [];      // 거래 전부
  var cats = [];      // 내 분류
  var pnl = [];       // 월별 손익(보기)

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function won(n){ return Number(n).toLocaleString("ko-KR") + "원"; }
  function signed(n){ n = Number(n); return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString("ko-KR"); }
  function cls(n){ n = Number(n); return n > 0 ? "plus" : n < 0 ? "minus" : ""; }
  function badge(c, t){ return '<span class="badge '+c+'">'+esc(t)+'</span>'; }
  function monthOf(t){ return t.belong_month || String(t.tx_date).slice(0, 7); }   // 귀속월이 비면 거래일의 달

  // ── 로그인 · 권한 ─────────────
  async function show(session){
    var on = !!session;
    $("login").hidden = on; $("logout").hidden = !on; $("maskbtn").hidden = !on;
    $("who").textContent = on ? session.user.email : "";
    $("app").hidden = true; $("denied").hidden = true;
    if (!on) return;
    var r = await sb.rpc("my_role");
    role = r.error ? null : r.data;
    if (role !== "ceo"){ $("denied").hidden = false; return; }
    $("app").hidden = false;
    load();
  }

  async function load(){
    $("count").textContent = "불러오는 중…";
    var c = await sb.from("money_category").select("*").order("sort", {ascending:true});
    if (c.error){ $("count").textContent = "불러오지 못했습니다: " + c.error.message; return; }
    cats = c.data || [];
    // 거래는 천 줄씩 끊어서 전부 읽는다
    var all = [], from = 0, step = 1000;
    for (;;){
      var r = await sb.from("txn").select("*").order("tx_date", {ascending:true}).order("id", {ascending:true}).range(from, from + step - 1);
      if (r.error){ $("count").textContent = "불러오지 못했습니다: " + r.error.message; return; }
      all = all.concat(r.data || []);
      if (!r.data || r.data.length < step) break;
      from += step;
    }
    txns = all;
    var p = await sb.from("v_month_pnl").select("*");
    pnl = (p.data || []).slice().sort(function(a, b){ return a["월"] < b["월"] ? -1 : 1; });
    fillMonths(); renderTop(); renderCats(); renderRows();
  }

  function fillMonths(){
    var cur = $("fMonth").value, set = {};
    txns.forEach(function(t){ set[monthOf(t)] = true; });
    var ms = Object.keys(set).sort();
    $("fMonth").innerHTML = '<option value="">전체</option>' + ms.map(function(m){ return '<option'+(m===cur?" selected":"")+'>'+m+'</option>'; }).join("");
  }

  // ── 위: 남았나 모자랐나 + 월별 표 ─────────────
  function flow(m){   // 그 달 통장 증감 = 들어온 − 나간 (같은 달 규칙)
    var inn = 0, out = 0;
    txns.forEach(function(t){ if (monthOf(t) === m){ if (t.direction === "입금") inn += Number(t.amount); else out += Number(t.amount); } });
    return inn - out;
  }
  function renderTop(){
    if (!pnl.length){ $("hero").innerHTML = '<div class="t">남았나 모자랐나</div><div class="big">거래가 아직 없습니다</div>'; $("months").innerHTML = ""; return; }
    var last = pnl[pnl.length - 1], m = last["월"];
    var left = Number(last["남은돈"]), flowN = flow(m);
    var verdict = left >= 0 ? "남았습니다" : "모자랐습니다";
    var open = Number(last["미분류_건수"]);
    var none = open > 0 && open === Number(last["전체_건수"]);   // 하나도 분류하지 않았으면 손익을 아직 셀 수 없다
    $("hero").innerHTML =
      '<div class="t">'+esc(m)+' · 남았나 모자랐나</div>' +
      (none ? '<div class="big">아직 계산할 수 없습니다 — 분류한 거래가 없습니다</div>' : '<div class="big mny">'+won(Math.abs(left))+' '+verdict+'</div>') +
      '<div class="nums"><span>판 것 <b class="mny">'+won(last["매출"])+'</b></span><span>쓴 것 <b class="mny">'+won(last["비용"])+'</b></span><span>통장 증감 <b class="mny">'+signed(flowN)+'원</b></span></div>' +
      '<div class="sub">통장과 손익이 다른 이유 — 손익 아님 <span class="mny">'+signed(Number(last["손익아님_들어옴"]) - Number(last["손익아님_나감"]))+'</span>' +
      ' · 미분류 <span class="mny">'+signed(Number(last["미분류_들어옴"]) - Number(last["미분류_나감"]))+'</span></div>' +
      (open ? '<div class="warn">⚠ 아직 분류하지 않은 거래가 <b>'+open+'건</b> 있습니다. 이 숫자는 아직 믿지 않습니다. 아래 표에서 「내 분류」를 정해 주세요.</div>' : '<div class="sub" style="margin-top:6px">✓ 미분류가 없습니다.</div>');
    $("months").innerHTML = pnl.map(function(r){
      var mm = r["월"], sNo = Number(r["손익아님_들어옴"]) - Number(r["손익아님_나감"]), sUn = Number(r["미분류_들어옴"]) - Number(r["미분류_나감"]);
      return '<tr><td><b>'+esc(mm)+'</b></td><td class="num mny">'+won(r["매출"])+'</td><td class="num mny">'+won(r["비용"])+'</td>' +
        '<td class="num mny '+cls(r["남은돈"])+'"><b>'+signed(r["남은돈"])+'</b></td>' +
        '<td class="num mny '+cls(sNo)+'">'+signed(sNo)+'</td><td class="num mny '+cls(sUn)+'">'+signed(sUn)+'</td>' +
        '<td class="num mny '+cls(flow(mm))+'">'+signed(flow(mm))+'</td>' +
        '<td class="num">'+(Number(r["미분류_건수"]) ? badge("b-red", r["미분류_건수"]+"건") : "0")+'</td><td class="num">'+r["전체_건수"]+'</td></tr>';
    }).join("");
  }

  function renderCats(){
    var count = {}, none = 0;
    txns.forEach(function(t){ if (t.my_category) count[t.my_category] = (count[t.my_category] || 0) + 1; else none++; });
    $("cats").innerHTML = cats.map(function(c){
      var k = c.kind === KIND_ORDER[0] ? "b-ok" : c.kind === KIND_ORDER[1] ? "b-amber" : "b-grey";
      return badge(k, c.name + " " + (count[c.name] || 0));
    }).join("") + badge("b-red", "미분류 " + none) + '<span style="font-size:12px;color:#6b7280">· 분류 이름을 바꾸면 거래도 따라 바뀝니다(클로드에게 시키세요)</span>';
  }

  // ── 거래 표 ─────────────
  function catSelect(t){
    var groups = KIND_ORDER.map(function(k){
      var items = cats.filter(function(c){ return c.kind === k; });
      return items.length ? '<optgroup label="'+esc(k)+'">' + items.map(function(c){ return '<option value="'+esc(c.name)+'"'+(t.my_category===c.name?" selected":"")+'>'+esc(c.name)+'</option>'; }).join("") + '</optgroup>' : "";
    }).join("");
    return '<select data-id="'+t.id+'" data-k="cat" class="'+(t.my_category ? "" : "unset")+'"><option value="">(미분류)</option>'+groups+'</select>';
  }
  function visible(){
    var m = $("fMonth").value, open = $("fOpen").checked, by = $("fBy").value, q = $("fQ").value.trim();
    return txns.filter(function(t){
      if (m && monthOf(t) !== m) return false;
      if (open && t.my_category) return false;
      if (by && t.labeled_by !== by) return false;
      if (q && String(t.memo || "").indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderRows(){
    var list = visible();
    $("count").textContent = "전체 " + txns.length + "건 중 " + list.length + "건 보임";
    $("rows").innerHTML = list.length ? list.map(function(t){
      var by = t.labeled_by === "AI" ? badge("b-purple", "AI") : t.labeled_by === "나" ? badge("b-blue", "나") : (t.my_category ? "" : badge("b-red", "미분류"));
      return '<tr'+(t.my_category ? "" : ' class="unclassified"')+'>' +
        '<td>'+esc(t.tx_date)+'</td><td>'+(t.direction === "입금" ? badge("b-ok", "입금") : badge("b-grey", "출금"))+'</td>' +
        '<td class="num mny '+(t.direction === "입금" ? "plus" : "")+'">'+(t.direction === "입금" ? "+" : "−")+Number(t.amount).toLocaleString("ko-KR")+'</td>' +
        '<td class="memo"><span class="memo-t">'+esc(t.memo)+'</span></td>' +
        '<td>'+(t.clobe_label ? '<span class="note-ref">'+esc(t.clobe_label)+'</span>' : badge("b-amber", "비어 있음"))+'</td>' +
        '<td>'+catSelect(t)+'</td><td>'+by+'</td>' +
        '<td><input type="month" data-id="'+t.id+'" data-k="month" value="'+esc(t.belong_month || "")+'" title="비우면 거래일의 달"></td></tr>';
    }).join("") : '<tr><td colspan="8" class="empty">조건에 맞는 거래가 없습니다.</td></tr>';
  }

  async function save(id, patch, msg){
    var r = await sb.from("txn").update(patch).eq("id", id).select();
    if (r.error){ alert("저장하지 못했습니다: " + r.error.message); return false; }
    if (!r.data || !r.data.length){ alert("저장되지 않았습니다 (고칠 권한이 없는 계정이거나 이미 지워진 거래입니다)."); return false; }
    var t = txns.filter(function(x){ return x.id === id; })[0];
    if (t) Object.keys(r.data[0]).forEach(function(k){ t[k] = r.data[0][k]; });
    $("saved").textContent = msg + " ✓";
    var p = await sb.from("v_month_pnl").select("*");
    pnl = (p.data || []).slice().sort(function(a, b){ return a["월"] < b["월"] ? -1 : 1; });
    fillMonths(); renderTop(); renderCats(); renderRows();
    return true;
  }

  $("rows").addEventListener("change", async function(e){
    var el = e.target, id = Number(el.getAttribute("data-id")), k = el.getAttribute("data-k");
    if (!id || !k) return;
    if (k === "cat"){
      var v = el.value || null;
      // 분류를 정하면 「누가」는 나. 비우면 미분류로 돌아가고 「누가」도 비운다(분류가 없는데 누가 분류했다고 적힐 수는 없다)
      await save(id, {my_category: v, labeled_by: v ? "나" : null}, v ? "「"+v+"」로 분류했습니다" : "미분류로 돌렸습니다");
    } else if (k === "month"){
      var m = el.value || null;
      await save(id, {belong_month: m}, m ? "귀속월을 "+m+"으로 정했습니다" : "귀속월을 비웠습니다(거래일의 달로 셈)");
    }
  });
  ["fMonth", "fOpen", "fBy"].forEach(function(i){ $(i).addEventListener("change", renderRows); });
  $("fQ").addEventListener("input", renderRows);

  // ── 캡처 · 화면 공유용: 금액 가리기 ─────────────
  $("maskbtn").addEventListener("click", function(){
    var on = !document.body.classList.contains("mask");
    document.body.classList.toggle("mask", on);
    this.setAttribute("aria-pressed", on ? "true" : "false");
    this.textContent = on ? "가리는 중 · 누르면 보임" : "캡처용: 금액 가리기";
  });

  $("lf").addEventListener("submit", async function(e){
    e.preventDefault();
    var f = e.target; $("lerr").textContent = ""; $("lbtn").disabled = true;
    var r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    $("lbtn").disabled = false; f.password.value = "";
    if (r.error){ $("lerr").textContent = "로그인에 실패했습니다. 이메일·비밀번호를 확인해 주세요."; return; }
    show(r.data.session);
  });
  $("logout").addEventListener("click", async function(){ await sb.auth.signOut(); show(null); });
  $("reload").addEventListener("click", load);

  sb.auth.getSession().then(function(r){ show(r.data.session); });
})();
