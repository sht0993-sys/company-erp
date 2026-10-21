// 미수금 — 수파베이스 v_receivable(미수금 보기) · tax_invoice(세금계산서) · invoice_match(짝) · txn(입금 거래)을 읽는다.
// 사람이 입금을 골라 세금계산서와 짝짓는다(자동으로 짝짓지 않는다). 고칠 수 있는 것은 약속일 · 메모 · 짝뿐이다.
// 거래처 · 통장 정보는 이 파일이나 깃허브에 두지 않는다. 잠긴 수파베이스에만 있다(대표만, RLS).
(function(){
  // 공개용(anon) 키만 사용 — erp-ledger.js 와 같은 프로젝트 · 같은 키
  var SUPABASE_URL = "https://dykljzknwcqncxusiqkf.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a2xqemtud2NxbmN4dXNpcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODM3NTEsImV4cCI6MjEwNTE1OTc1MX0.vo7fWD4xrTdZXjAG8NBUd1Dcmj7EjOLcYBPj7-ROQGM";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var $ = function(id){ return document.getElementById(id); };
  var invoices = [], matches = [], deposits = [], picking = null;

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function won(n){ return Number(n).toLocaleString("ko-KR") + "원"; }
  function badge(c, t){ return '<span class="badge '+c+'">'+esc(t)+'</span>'; }
  function mny(t, c){ return '<span class="mny'+(c ? " "+c : "")+'">'+t+'</span>'; }
  function pad(n){ return (n<10?"0":"")+n; }
  function today(){ var d = new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function days(from){ return Math.floor((new Date(today()+"T00:00:00") - new Date(from+"T00:00:00")) / 86400000); }
  function invById(id){ return invoices.filter(function(x){ return x.id === id; })[0]; }

  // ── 로그인 · 권한 ─────────────
  async function show(session){
    var on = !!session;
    $("login").hidden = on; $("logout").hidden = !on; $("maskbtn").hidden = !on;
    $("who").textContent = on ? session.user.email : "";
    $("app").hidden = true; $("denied").hidden = true;
    if (!on) return;
    var r = await sb.rpc("my_role");
    var role = r.error ? null : r.data;
    if (role !== "ceo"){ $("denied").hidden = false; return; }
    $("app").hidden = false;
    load();
  }

  async function load(){
    $("count").textContent = "불러오는 중…";
    var a = await sb.from("v_receivable").select("*").order("issue_date", {ascending:true}).order("id", {ascending:true});
    if (a.error){ $("count").textContent = "불러오지 못했습니다: " + a.error.message; return; }
    invoices = a.data || [];
    var m = await sb.from("invoice_match").select("*").order("id", {ascending:true});
    matches = m.data || [];
    var all = [], from = 0, step = 1000;
    for (;;){
      var r = await sb.from("txn").select("*").eq("direction", "입금").order("tx_date", {ascending:true}).order("id", {ascending:true}).range(from, from + step - 1);
      if (r.error){ $("count").textContent = "불러오지 못했습니다: " + r.error.message; return; }
      all = all.concat(r.data || []);
      if (!r.data || r.data.length < step) break;
      from += step;
    }
    deposits = all;
    var cur = $("fMonth").value, set = {};
    invoices.forEach(function(x){ set[String(x.issue_date).slice(0, 7)] = true; });
    var ms = Object.keys(set).sort();
    $("fMonth").innerHTML = '<option value="">전체</option>' + ms.map(function(x){ return '<option'+(x===cur?" selected":"")+'>'+x+'</option>'; }).join("");
    renderAll();
  }
  function renderAll(){ renderTop(); renderRows(); if (picking) renderPick(); }

  // ── 위: 아직 못 받은 돈 + 거래처별 ─────────────
  function renderTop(){
    var open = invoices.filter(function(x){ return Number(x.remaining) > 0; });
    var sum = open.reduce(function(a, x){ return a + Number(x.remaining); }, 0);
    var late = open.filter(function(x){ return x.due_date && x.due_date < today(); });
    var none = open.filter(function(x){ return x.status === "못 받음"; }).length, part = open.filter(function(x){ return x.status === "일부"; }).length;
    var oldest = open.length ? Math.max.apply(null, open.map(function(x){ return days(x.issue_date); })) : 0;
    $("hero").innerHTML = '<div class="t">아직 못 받은 돈</div>' +
      (invoices.length ? '<div class="big mny">'+won(sum)+' · '+open.length+'건</div>' : '<div class="big">세금계산서가 아직 없습니다</div>') +
      '<div class="nums"><span>못 받음 <b>'+none+'건</b></span><span>일부 받음 <b>'+part+'건</b></span><span>받음 <b>'+(invoices.length - open.length)+'건</b></span>' +
      (open.length ? '<span>가장 오래된 것 <b>'+oldest+'일</b> 지남</span>' : "") + '</div>' +
      (late.length ? '<div class="warn">⚠ 약속일이 지났는데 못 받은 것이 <b>'+late.length+'건</b> 있습니다.</div>' : '<div class="sub" style="margin-top:6px">약속일이 지난 미수금은 없습니다'+(invoices.some(function(x){ return !x.due_date && Number(x.remaining) > 0; }) ? " (약속일을 적지 않은 것은 빠짐)" : "")+'.</div>');
    var g = {};
    invoices.forEach(function(x){
      var key = x.client_reg || x.client, o = g[key] = g[key] || {name:x.client, n:0, total:0, paid:0, rest:0, oldest:null, last:x.issue_date};
      if (x.issue_date >= o.last){ o.last = x.issue_date; o.name = x.client; }
      o.n++; o.total += Number(x.total); o.paid += Number(x.paid); o.rest += Number(x.remaining);
      if (Number(x.remaining) > 0 && (!o.oldest || x.issue_date < o.oldest)) o.oldest = x.issue_date;
    });
    var rows = Object.keys(g).map(function(k){ return g[k]; }).sort(function(a, b){ return b.rest - a.rest; });
    $("byClient").innerHTML = '<thead><tr><th>거래처</th><th class="num">계산서</th><th class="num">합계</th><th class="num">받은 돈</th><th class="num">남은 돈</th><th class="num">경과일</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function(o){
        return '<tr'+(o.rest > 0 ? ' class="open"' : "")+'><td><span class="memo-t">'+esc(o.name)+'</span></td><td class="num">'+o.n+'건</td><td class="num">'+mny(won(o.total))+'</td><td class="num">'+mny(won(o.paid))+'</td><td class="num">'+(o.rest > 0 ? mny(won(o.rest), "minus") : mny("0원"))+'</td><td class="num">'+(o.oldest ? days(o.oldest)+"일" : "—")+'</td></tr>';
      }).join("") : '<tr><td colspan="6" class="empty">세금계산서가 아직 없습니다.</td></tr>') + '</tbody>';
  }

  // ── 세금계산서 표 ─────────────
  function visible(){
    var open = $("fOpen").checked, m = $("fMonth").value, q = $("fQ").value.trim();
    return invoices.filter(function(x){
      if (open && Number(x.remaining) <= 0) return false;
      if (m && String(x.issue_date).slice(0, 7) !== m) return false;
      if (q && String(x.client).indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderRows(){
    var list = visible();
    $("count").textContent = "세금계산서 " + invoices.length + "건 중 " + list.length + "건 보임";
    $("rows").innerHTML = list.length ? list.map(function(x){
      var st = x.status === "받음" ? badge("b-ok", "받음") : x.status === "일부" ? badge("b-amber", "일부 받음") : badge("b-red", "못 받음");
      var late = Number(x.remaining) > 0 && x.due_date && x.due_date < today();
      return '<tr'+(x.id === picking ? ' class="sub"' : Number(x.remaining) > 0 ? ' class="open"' : "")+'>' +
        '<td>'+esc(x.issue_date)+'</td><td><span class="memo-t">'+esc(x.client)+'</span></td>' +
        '<td class="num">'+mny(won(x.total))+'</td><td class="num">'+mny(won(x.paid))+'</td><td class="num">'+(Number(x.remaining) > 0 ? mny(won(x.remaining), "minus") : mny("0원"))+'</td>' +
        '<td>'+st+(late ? " "+badge("b-red", "약속일 지남") : "")+'</td><td class="num">'+(Number(x.remaining) > 0 ? days(x.issue_date)+"일" : "—")+'</td>' +
        '<td><input type="date" data-id="'+x.id+'" data-k="due" value="'+esc(x.due_date || "")+'" title="업체가 돈을 주기로 한 날(모르면 비움)"></td>' +
        '<td><input type="text" class="memo-in" data-id="'+x.id+'" data-k="memo" maxlength="500" value="'+esc(x.memo || "")+'" placeholder="메모"></td>' +
        '<td class="act"><button type="button" data-act="pick" data-id="'+x.id+'">짝짓기</button></td></tr>';
    }).join("") : '<tr><td colspan="10" class="empty">조건에 맞는 세금계산서가 없습니다.</td></tr>';
  }

  // 약속일 · 메모 저장
  $("rows").addEventListener("change", async function(e){
    var el = e.target, id = Number(el.getAttribute("data-id")), k = el.getAttribute("data-k");
    if (!id || !k) return;
    var patch = k === "due" ? {due_date: el.value || null} : {memo: el.value.trim() || null};
    var r = await sb.from("tax_invoice").update(patch).eq("id", id).select();
    if (r.error){ alert("저장하지 못했습니다: " + r.error.message); return; }
    if (!r.data || !r.data.length){ alert("저장되지 않았습니다 (고칠 권한이 없는 계정이거나 이미 지워진 계산서입니다)."); return; }
    $("saved").textContent = (k === "due" ? "약속일" : "메모") + "을 저장했습니다 ✓";
    await load();
  });

  // ── 짝짓기 (사람이 고른다) ─────────────
  $("rows").addEventListener("click", function(e){
    var b = e.target.closest("button[data-act=pick]"); if (!b) return;
    picking = Number(b.getAttribute("data-id")); $("pickMsg").textContent = "";
    $("pickCard").hidden = false; renderAll();
    $("pickCard").scrollIntoView({behavior:"smooth", block:"start"});
  });
  $("pickClose").addEventListener("click", function(){ picking = null; $("pickCard").hidden = true; renderAll(); });

  function usedOf(txnId){ return matches.filter(function(m){ return m.txn_id === txnId; }).reduce(function(a, m){ return a + Number(m.amount); }, 0); }
  function renderPick(){
    var inv = invById(picking); if (!inv){ picking = null; $("pickCard").hidden = true; return; }
    $("pickTitle").innerHTML = '<span class="memo-t">'+esc(inv.client)+'</span> · 발행 '+esc(inv.issue_date)+' · 합계 '+mny(won(inv.total))+' · 남은 돈 '+mny(won(inv.remaining), "minus");
    var mine = matches.filter(function(m){ return m.invoice_id === inv.id; });
    var html = '<h3 style="font-size:14px;margin:0 0 6px">이미 짝지은 입금 '+mine.length+'건</h3>';
    html += mine.length ? '<div class="wrap"><table class="t2"><thead><tr><th>입금일</th><th>적요</th><th class="num">짝지은 금액</th><th>누가</th><th></th></tr></thead><tbody>' + mine.map(function(m){
      var t = deposits.filter(function(d){ return d.id === m.txn_id; })[0] || {};
      return '<tr><td>'+esc(t.tx_date)+'</td><td><span class="memo-t">'+esc(t.memo)+'</span></td><td class="num">'+mny(won(m.amount))+'</td><td>'+badge(m.matched_by === "AI" ? "b-purple" : "b-blue", m.matched_by)+'</td><td class="act"><button class="danger" type="button" data-act="unmatch" data-id="'+m.id+'">짝 풀기</button></td></tr>';
    }).join("") + '</tbody></table></div>' : '<div class="legend" style="margin:0 0 10px">아직 짝지은 입금이 없습니다.</div>';
    // 후보: 아직 짝 안 지은 금액이 남은 입금. 같은 금액을 먼저, 그다음 발행일 이후 가까운 날짜순.
    var cand = deposits.map(function(t){ return {t:t, free:Number(t.amount) - usedOf(t.id)}; }).filter(function(c){ return c.free > 0; });
    cand.forEach(function(c){ c.same = Number(c.t.amount) === Number(inv.total) || c.free === Number(inv.remaining); c.after = c.t.tx_date >= inv.issue_date; });
    cand.sort(function(a, b){
      if (a.same !== b.same) return a.same ? -1 : 1;
      if (a.after !== b.after) return a.after ? -1 : 1;
      return a.t.tx_date < b.t.tx_date ? -1 : 1;
    });
    html += '<h3 style="font-size:14px;margin:12px 0 6px">통장 입금 — 짝지을 것을 고르세요 ('+cand.length+'건)</h3>';
    html += Number(inv.remaining) <= 0 ? '<div class="legend">이 계산서는 이미 다 받았습니다.</div>' :
      '<div class="wrap"><table class="t2"><thead><tr><th>입금일</th><th>적요</th><th>내 분류</th><th class="num">입금액</th><th class="num">아직 짝 안 지은 금액</th><th>단서</th><th>짝지을 금액</th><th></th></tr></thead><tbody>' + cand.map(function(c){
        var def = Math.min(Number(inv.remaining), c.free);
        return '<tr'+(c.same ? ' class="cand-same"' : "")+'><td>'+esc(c.t.tx_date)+'</td><td><span class="memo-t">'+esc(c.t.memo)+'</span></td><td>'+(c.t.my_category ? esc(c.t.my_category) : badge("b-red", "미분류"))+'</td>' +
          '<td class="num">'+mny(won(c.t.amount))+'</td><td class="num">'+mny(won(c.free))+'</td>' +
          '<td>'+(c.same ? badge("b-blue", "같은 금액") : "")+(c.after ? "" : " "+badge("b-grey", "발행일 이전"))+'</td>' +
          '<td><input class="amt-in" type="text" inputmode="numeric" data-for="'+c.t.id+'" value="'+def+'"></td>' +
          '<td class="act"><button type="button" data-act="match" data-id="'+c.t.id+'">이 입금과 짝짓기</button></td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<div class="legend">같은 금액은 <b>단서</b>일 뿐입니다 — 같은 금액이 여러 건이면 어느 것이 이 거래처의 돈인지 사람이 고릅니다. 입금액이 계산서보다 크면(여러 계산서 몫) 짝지을 금액을 줄여서 나눠 짝지을 수 있습니다. 카드정산 같은 <b>매출이 아닌 입금</b>은 짝지으면 안 됩니다.</div>';
    $("pickBody").innerHTML = html;
  }
  $("pickBody").addEventListener("click", async function(e){
    var b = e.target.closest("button[data-act]"); if (!b || !picking) return;
    var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id")); $("pickMsg").textContent = ""; $("pickMsg").className = "msg";
    if (act === "match"){
      var inp = $("pickBody").querySelector('input[data-for="'+id+'"]'), amt = Number(String(inp.value).replace(/[^\d]/g, ""));
      if (!amt || amt <= 0){ $("pickMsg").className = "msg err"; $("pickMsg").textContent = "짝지을 금액을 숫자로 넣어 주세요."; return; }
      b.disabled = true;
      var r = await sb.from("invoice_match").insert({invoice_id: picking, txn_id: id, amount: amt, matched_by: "나"}).select();
      b.disabled = false;
      if (r.error){ $("pickMsg").className = "msg err"; $("pickMsg").textContent = "짝지을 수 없습니다: " + r.error.message; return; }
      $("saved").textContent = "짝지었습니다 ✓"; await load();
    } else if (act === "unmatch"){
      if (!confirm("이 짝을 풀까요? 입금은 그대로 남고, 세금계산서가 다시 못 받은 것으로 돌아갑니다.")) return;
      var d = await sb.from("invoice_match").delete().eq("id", id).select();
      if (d.error){ $("pickMsg").className = "msg err"; $("pickMsg").textContent = "풀지 못했습니다: " + d.error.message; return; }
      $("saved").textContent = "짝을 풀었습니다 ✓"; await load();
    }
  });

  ["fOpen", "fMonth"].forEach(function(i){ $(i).addEventListener("change", renderRows); });
  $("fQ").addEventListener("input", renderRows);
  $("reload").addEventListener("click", load);
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
  $("logout").addEventListener("click", async function(){ await sb.auth.signOut(); picking = null; $("pickCard").hidden = true; show(null); });

  sb.auth.getSession().then(function(r){ show(r.data.session); });
})();
