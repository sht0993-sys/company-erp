// 통장·매출 보기(erp-bank.html) · 월 손익(erp-pnl.html) 공용 스크립트 — 읽기만 한다.
// 수파베이스 txn(거래) · money_category(내 분류) · v_month_pnl(월별 손익)을 읽어서 보여 준다. 아무것도 고치지 않는다.
// 통장 정보는 이 파일이나 깃허브에 두지 않는다. 잠긴 수파베이스에만 있다(대표만, RLS).
// 화면은 <body data-screen="bank"> (통장·매출 보기) 또는 <body data-screen="pnl"> (월 손익) 로 구분한다.
(function(){
  // 공개용(anon) 키만 사용 — erp-ledger.js 와 같은 프로젝트 · 같은 키
  var SUPABASE_URL = "https://dykljzknwcqncxusiqkf.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a2xqemtud2NxbmN4dXNpcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODM3NTEsImV4cCI6MjEwNTE1OTc1MX0.vo7fWD4xrTdZXjAG8NBUd1Dcmj7EjOLcYBPj7-ROQGM";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var SCREEN = document.body.getAttribute("data-screen");
  var KIND_SALES = "판 것(매출)", KIND_COST = "쓴 것(비용)", KIND_NO = "손익 아님(보증금·카드정산·대출원금 등)";
  var $ = function(id){ return document.getElementById(id); };
  var role = null, txns = [], cats = [], catKind = {}, pnlView = [], taxRows = null;

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function won(n){ return Number(n).toLocaleString("ko-KR") + "원"; }
  function signed(n){ n = Number(n); return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString("ko-KR"); }
  function cls(n){ n = Number(n); return n > 0 ? "plus" : n < 0 ? "minus" : ""; }
  function badge(c, t){ return '<span class="badge '+c+'">'+esc(t)+'</span>'; }
  function mny(t, c){ return '<span class="mny'+(c ? " "+c : "")+'">'+t+'</span>'; }
  function monthOf(t){ return t.belong_month || String(t.tx_date).slice(0, 7); }   // 귀속월이 비면 거래일의 달
  function pct(a, b){ return b > 0 ? Math.round(a * 1000 / b) / 10 + "%" : "—"; }

  // ── 한 달 계산 — 수파베이스 월별 손익 보기와 같은 규칙으로 직접 센다 ─────────────
  function calc(m){
    var r = {m:m, n:0, inn:0, out:0,
      sales:{total:0, rows:{}, byMemo:{}}, cost:{total:0, rows:{}},
      no:{inn:0, out:0, rows:{}, list:[]}, un:{n:0, inn:0, out:0, list:[]}};
    txns.forEach(function(t){
      if (monthOf(t) !== m) return;
      var amt = Number(t.amount), isIn = t.direction === "입금", sg = isIn ? amt : -amt, k = t.my_category ? catKind[t.my_category] : null;
      r.n++; if (isIn) r.inn += amt; else r.out += amt;
      if (!k){ r.un.n++; if (isIn) r.un.inn += amt; else r.un.out += amt; r.un.list.push(t); return; }
      var row;
      if (k === KIND_SALES){
        r.sales.total += sg; row = r.sales.rows[t.my_category] = r.sales.rows[t.my_category] || {n:0, sum:0}; row.n++; row.sum += sg;
        var mm = r.sales.byMemo[t.memo || "(적요 없음)"] = r.sales.byMemo[t.memo || "(적요 없음)"] || {nIn:0, sIn:0, sOut:0};
        if (isIn){ mm.nIn++; mm.sIn += amt; } else mm.sOut += amt;
      } else if (k === KIND_COST){
        r.cost.total -= sg; row = r.cost.rows[t.my_category] = r.cost.rows[t.my_category] || {n:0, sum:0}; row.n++; row.sum -= sg;
      } else {
        if (isIn) r.no.inn += amt; else r.no.out += amt;
        row = r.no.rows[t.my_category] = r.no.rows[t.my_category] || {n:0, sum:0}; row.n++; row.sum += sg; r.no.list.push(t);
      }
    });
    r.left = r.sales.total - r.cost.total;      // 남은 돈 = 판 것 − 쓴 것
    r.flow = r.inn - r.out;                     // 통장 증감 = 들어온 − 나간
    r.calcFlow = r.left + (r.no.inn - r.no.out) + (r.un.inn - r.un.out);
    r.ok = r.calcFlow === r.flow;
    return r;
  }
  function allMonths(){ var s = {}; txns.forEach(function(t){ s[monthOf(t)] = true; }); return Object.keys(s).sort(); }
  function catsOf(kind){ return cats.filter(function(c){ return c.kind === kind; }); }

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
    cats = c.data || []; catKind = {}; cats.forEach(function(x){ catKind[x.name] = x.kind; });
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
    pnlView = p.data || [];
    var cur = $("fMonth").value, ms = allMonths();
    $("fMonth").innerHTML = ms.map(function(m){ return '<option>'+m+'</option>'; }).join("");
    $("fMonth").value = ms.indexOf(cur) >= 0 ? cur : (ms[ms.length - 1] || "");
    $("count").textContent = "거래 " + txns.length + "건";
    render();
  }

  function render(){
    var m = $("fMonth").value;
    if (!m){ $("hero").innerHTML = '<div class="t">남았나 모자랐나</div><div class="big">거래가 아직 없습니다</div>'; return; }
    var r = calc(m);
    hero(r);
    if (SCREEN === "bank") renderBank(r); else renderPnl(r);
  }

  function hero(r){
    var none = r.un.n > 0 && r.un.n === r.n;
    var verdict = r.left >= 0 ? "남았습니다" : "모자랐습니다";
    $("hero").innerHTML =
      '<div class="t">'+esc(r.m)+' · 남았나 모자랐나</div>' +
      (none ? '<div class="big">아직 계산할 수 없습니다 — 분류한 거래가 없습니다</div>' : '<div class="big mny">'+won(Math.abs(r.left))+' '+verdict+'</div>') +
      '<div class="nums"><span>판 것 <b class="mny">'+won(r.sales.total)+'</b></span><span>쓴 것 <b class="mny">'+won(r.cost.total)+'</b></span><span>통장 증감 <b class="mny">'+signed(r.flow)+'원</b></span></div>' +
      (r.un.n ? '<div class="warn">⚠ 아직 분류하지 않은 거래가 <b>'+r.un.n+'건</b>(전체의 '+pct(r.un.n, r.n)+') 있습니다. 미분류는 손익에 넣지 않고 따로 셉니다 — 이 숫자는 아직 믿지 않습니다.</div>' : '<div class="sub" style="margin-top:6px">✓ 미분류가 없습니다.</div>');
  }

  // ── 통장·매출 보기 ─────────────
  function renderBank(r){
    var sNo = r.no.inn - r.no.out, sUn = r.un.inn - r.un.out;
    $("vs").innerHTML =
      '<div class="box"><div class="k">통장은</div><div class="v mny '+cls(r.flow)+'">'+won(Math.abs(r.flow))+(r.flow < 0 ? " 줄었습니다" : " 늘었습니다")+'</div><div class="k">들어온 '+mny(won(r.inn))+' − 나간 '+mny(won(r.out))+'</div></div>' +
      '<div class="ne">≠</div>' +
      '<div class="box"><div class="k">손익은</div><div class="v mny '+cls(r.left)+'">'+won(Math.abs(r.left))+(r.left < 0 ? " 모자랐습니다" : " 남았습니다")+'</div><div class="k">판 것 '+mny(won(r.sales.total))+' − 쓴 것 '+mny(won(r.cost.total))+'</div></div>';
    var rows = '<thead><tr><th>차이의 이유</th><th class="num">건수</th><th class="num">금액</th></tr></thead><tbody>' +
      '<tr class="sub"><td>남은 돈 (손익)</td><td class="num">—</td><td class="num">'+mny(signed(r.left), cls(r.left))+'</td></tr>';
    catsOf(KIND_NO).forEach(function(c){
      var x = r.no.rows[c.name]; if (!x) return;
      rows += '<tr class="ind"><td>+ 손익 아님 · '+esc(c.name)+'</td><td class="num">'+x.n+'</td><td class="num">'+mny(signed(x.sum), cls(x.sum))+'</td></tr>';
    });
    rows += '<tr class="ind'+(r.un.n ? " open" : "")+'"><td>+ 미분류 (들어옴 − 나감)</td><td class="num">'+r.un.n+'</td><td class="num">'+mny(signed(sUn), cls(sUn))+'</td></tr>' +
      '<tr class="total"><td>= 통장 증감</td><td class="num">'+r.n+'</td><td class="num">'+mny(signed(r.calcFlow), cls(r.calcFlow))+'</td></tr></tbody>';
    $("why").innerHTML = rows;
    $("why").insertAdjacentHTML("afterend", '<div class="ok-line">'+(r.ok ? badge("b-ok", "✓ 맞음") + " 합이 실제 통장 증감과 같습니다." : badge("b-red", "✗ 안 맞음") + " 합이 실제 통장 증감(" + mny(signed(r.flow)) + ")과 다릅니다. 분류나 귀속월을 확인하세요.")+'</div>');
    var old = document.querySelectorAll(".ok-line"); if (old.length > 1) old[0].remove();

    // 나간 돈 — 분류별
    var out = '<thead><tr><th>내 분류</th><th class="num">건수</th><th class="num">금액</th><th class="num">비율</th></tr></thead><tbody>';
    catsOf(KIND_COST).forEach(function(c){
      var x = r.cost.rows[c.name] || {n:0, sum:0};
      out += '<tr><td>'+esc(c.name)+'</td><td class="num">'+x.n+'</td><td class="num">'+mny(won(x.sum))+'</td><td class="num">'+pct(x.sum, r.cost.total)+'</td></tr>';
    });
    out += '<tr class="sub"><td>쓴 것 합계</td><td class="num">—</td><td class="num">'+mny(won(r.cost.total))+'</td><td class="num">100%</td></tr>' +
      '<tr class="open"><td>미분류 — 나간 돈 <small style="color:#6b7280">(쓴 것에 넣지 않음)</small></td><td class="num">'+r.un.list.filter(function(t){ return t.direction === "출금"; }).length+'</td><td class="num">'+mny(won(r.un.out))+'</td><td class="num">—</td></tr></tbody>';
    $("outT").innerHTML = out;

    // 매출 보기 — 판 것
    var memos = Object.keys(r.sales.byMemo).sort(function(a, b){ return (r.sales.byMemo[b].sIn - r.sales.byMemo[b].sOut) - (r.sales.byMemo[a].sIn - r.sales.byMemo[a].sOut); });
    var s = '<thead><tr><th>거래처(적요)</th><th class="num">입금 건수</th><th class="num">입금</th><th class="num">환불·취소</th><th class="num">순매출</th></tr></thead><tbody>';
    memos.forEach(function(k){
      var x = r.sales.byMemo[k];
      s += '<tr><td><span class="memo-t">'+esc(k)+'</span></td><td class="num">'+x.nIn+'</td><td class="num">'+mny(won(x.sIn))+'</td><td class="num">'+(x.sOut ? mny(won(x.sOut), "minus") : "—")+'</td><td class="num">'+mny(won(x.sIn - x.sOut))+'</td></tr>';
    });
    s += memos.length ? '<tr class="total"><td>판 것 합계</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">'+mny(won(r.sales.total))+'</td></tr>' : '<tr><td colspan="5" class="empty">「판 것」으로 분류한 거래가 아직 없습니다.</td></tr>';
    $("salesT").innerHTML = s + '</tbody>';

    // 손익 아님
    var no = '<thead><tr><th>날짜</th><th>적요</th><th>입/출</th><th class="num">금액</th><th>내 분류</th><th>클로브 분류(참고)</th></tr></thead><tbody>';
    no += r.no.list.length ? r.no.list.map(function(t){
      return '<tr><td>'+esc(t.tx_date)+'</td><td><span class="memo-t">'+esc(t.memo)+'</span></td><td>'+(t.direction === "입금" ? badge("b-ok", "입금") : badge("b-grey", "출금"))+'</td><td class="num">'+mny((t.direction === "입금" ? "+" : "−")+Number(t.amount).toLocaleString("ko-KR"))+'</td><td>'+esc(t.my_category)+'</td><td>'+(t.clobe_label ? esc(t.clobe_label) : badge("b-amber", "비어 있음"))+'</td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">「손익 아님」으로 분류한 거래가 아직 없습니다.</td></tr>';
    $("noT").innerHTML = no + '</tbody>';

    // 미분류
    $("openSum").innerHTML = r.un.n ? badge("b-red", "미분류 "+r.un.n+"건") + ' 전체 '+r.n+'건의 <b>'+pct(r.un.n, r.n)+'</b> · 들어옴 '+mny(won(r.un.inn))+' · 나감 '+mny(won(r.un.out))+' · <a href="erp-txn.html">거래 분류함에서 분류하기 →</a>' : badge("b-ok", "미분류 없음");
    var op = '<thead><tr><th>날짜</th><th>적요</th><th>입/출</th><th class="num">금액</th><th>클로브 분류(참고)</th></tr></thead><tbody>';
    op += r.un.list.length ? r.un.list.slice().sort(function(a, b){ return Number(b.amount) - Number(a.amount); }).slice(0, 15).map(function(t){
      return '<tr class="open"><td>'+esc(t.tx_date)+'</td><td><span class="memo-t">'+esc(t.memo)+'</span></td><td>'+(t.direction === "입금" ? badge("b-ok", "입금") : badge("b-grey", "출금"))+'</td><td class="num">'+mny((t.direction === "입금" ? "+" : "−")+Number(t.amount).toLocaleString("ko-KR"))+'</td><td>'+(t.clobe_label ? esc(t.clobe_label) : badge("b-amber", "비어 있음"))+'</td></tr>';
    }).join("") + (r.un.list.length > 15 ? '<tr><td colspan="5" class="empty">큰 것 15건만 보입니다 (전체 '+r.un.list.length+'건)</td></tr>' : "") : '<tr><td colspan="5" class="empty">미분류가 없습니다.</td></tr>';
    $("openT").innerHTML = op + '</tbody>';

    renderPair();
  }

  // ── 못 받은 돈 — 나란히만 (자동으로 짝짓지 않는다) ─────────────
  function renderPair(){
    if (!taxRows){ $("pair").innerHTML = '<div class="legend">세금계산서 파일을 고르면 여기에 나란히 보입니다.</div>'; return; }
    var deps = txns.filter(function(t){ return t.direction === "입금"; });
    var byAmt = {}; deps.forEach(function(t){ (byAmt[Number(t.amount)] = byAmt[Number(t.amount)] || []).push(t); });
    var invByAmt = {}; taxRows.forEach(function(x){ (invByAmt[Number(x.totalAmount)] = invByAmt[Number(x.totalAmount)] || []).push(x); });
    var none = taxRows.filter(function(x){ return !byAmt[Number(x.totalAmount)]; });
    var left = '<h3 style="font-size:14px;margin:0 0 6px">세금계산서 '+taxRows.length+'건</h3><div class="wrap"><table class="t2 pair"><thead><tr><th>발행일</th><th>거래처</th><th class="num">합계금액</th><th>같은 금액의 입금</th></tr></thead><tbody>' +
      taxRows.slice().sort(function(a, b){ return a.issueDate < b.issueDate ? -1 : 1; }).map(function(x){
        var c = byAmt[Number(x.totalAmount)];
        return '<tr><td>'+esc(x.issueDate)+'</td><td><span class="memo-t">'+esc(x.contractorCompanyName)+'</span></td><td class="num">'+mny(won(x.totalAmount))+'</td>' +
          (c ? '<td class="cand">'+c.map(function(t){ return esc(t.tx_date)+' <span class="memo-t">'+esc(t.memo)+'</span>'; }).join("<br>")+'</td>' : '<td class="none">같은 금액 입금 없음</td>') + '</tr>';
      }).join("") + '</tbody></table></div>';
    var right = '<h3 style="font-size:14px;margin:0 0 6px">통장 입금 '+deps.length+'건 (전체 기간)</h3><div class="wrap"><table class="t2 pair"><thead><tr><th>날짜</th><th>적요</th><th class="num">금액</th><th>같은 금액의 세금계산서</th></tr></thead><tbody>' +
      deps.map(function(t){
        var c = invByAmt[Number(t.amount)];
        return '<tr><td>'+esc(t.tx_date)+'</td><td><span class="memo-t">'+esc(t.memo)+'</span></td><td class="num">'+mny(won(t.amount))+'</td>' +
          (c ? '<td class="cand">'+c.map(function(x){ return esc(x.issueDate)+' <span class="memo-t">'+esc(x.contractorCompanyName)+'</span>'; }).join("<br>")+'</td>' : '<td></td>') + '</tr>';
      }).join("") + '</tbody></table></div>';
    var sum = none.reduce(function(a, x){ return a + Number(x.totalAmount); }, 0);
    $("pair").innerHTML = '<div class="ok-line">'+(none.length ? badge("b-amber", "같은 금액 입금이 없는 세금계산서 "+none.length+"건") + ' 합계 ' + mny(won(sum)) + ' — 아직 못 받은 돈일 수 있습니다. 눈으로 확인하세요.' : badge("b-ok", "모든 세금계산서에 같은 금액의 입금이 있습니다") + " (그래도 거래처 이름은 눈으로 확인하세요).")+'</div>' +
      '<div class="two" style="margin-top:10px"><div>'+left+'</div><div>'+right+'</div></div>' +
      '<div class="legend">자동으로 짝짓지 않았습니다. 같은 금액은 <b>단서</b>일 뿐입니다 — 같은 금액이 여러 건이면 어느 것이 짝인지는 사람이 고릅니다. 취소가 되돌아온 돈은 매출이 아닙니다.</div>';
  }
  if ($("taxFile")) $("taxFile").addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0]; $("taxErr").textContent = ""; if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      try {
        var d = JSON.parse(rd.result);
        if (!d.content || !d.content.length || d.content[0].totalAmount == null) throw new Error("세금계산서 모양이 아닙니다");
        taxRows = d.content.filter(function(x){ return !x.type || x.type === "SALES"; });
        renderPair();
      } catch (err){ taxRows = null; $("taxErr").textContent = "파일을 읽지 못했습니다: " + err.message; renderPair(); }
    };
    rd.readAsText(f, "utf-8");
  });

  // 월말 통장 잔액 — 엑셀로 넣은 거래의 열쇠(날짜|끝4자리|입출|금액|적요|거래후잔액) 끝에 잔액이 들어 있다. 클로브로 넣은 거래는 열쇠에 잔액이 없다.
  function balanceText(r){
    var last = null;
    txns.forEach(function(t){ if (String(t.tx_date).slice(0, 7) <= r.m && /^\d{4}-\d{2}-\d{2}\|\d{4}\|(입금|출금)\|\d+\|.*\|\d+$/.test(String(t.source_key))) last = t; });
    var flow = ' <small style="color:#6b7280">· 이 달 통장 증감은 '+mny(signed(r.flow))+'원</small>';
    if (!last) return '이 장부에는 잔액 칸이 없습니다 — 통장 원본의 「거래 후 잔액」을 봅니다' + flow;
    var bal = Number(String(last.source_key).split("|").pop());
    return '월말(마지막 거래 '+esc(last.tx_date)+') 잔액 <b>'+mny(won(bal))+'</b> <small style="color:#6b7280">· 엑셀 거래의 「거래 후 잔액」 기준</small>' + flow;
  }

  // ── 월 손익 ─────────────
  function renderPnl(r){
    var rule = '<thead><tr><th>줄</th><th class="num">건수</th><th class="num">금액</th></tr></thead><tbody>' +
      '<tr class="sub"><td>① 판 것</td><td class="num">—</td><td class="num">'+mny(won(r.sales.total))+'</td></tr>';
    catsOf(KIND_SALES).forEach(function(c){ var x = r.sales.rows[c.name] || {n:0, sum:0}; rule += '<tr class="ind"><td>'+esc(c.name)+'</td><td class="num">'+x.n+'</td><td class="num">'+mny(won(x.sum))+'</td></tr>'; });
    rule += '<tr class="sub"><td>② 쓴 것</td><td class="num">—</td><td class="num">'+mny(won(r.cost.total))+'</td></tr>';
    catsOf(KIND_COST).forEach(function(c){ var x = r.cost.rows[c.name] || {n:0, sum:0}; rule += '<tr class="ind"><td>'+esc(c.name)+'</td><td class="num">'+x.n+'</td><td class="num">'+mny(won(x.sum))+'</td></tr>'; });
    rule += '<tr class="total"><td>③ 남은 돈 (① − ②)</td><td class="num">—</td><td class="num">'+mny(signed(r.left), cls(r.left))+'</td></tr>' +
      '<tr class="open"><td>④ 미분류 — 손익에 넣지 않고 따로</td><td class="num">'+r.un.n+'</td><td class="num">들어옴 '+mny(won(r.un.inn))+' · 나감 '+mny(won(r.un.out))+'</td></tr></tbody>';
    $("rule").innerHTML = rule;

    var sNo = r.no.inn - r.no.out, sUn = r.un.inn - r.un.out;
    $("recon").innerHTML = '<thead><tr><th>맞추기</th><th class="num">금액</th></tr></thead><tbody>' +
      '<tr><td>남은 돈 (손익)</td><td class="num">'+mny(signed(r.left), cls(r.left))+'</td></tr>' +
      '<tr class="ind"><td>+ 손익 아님 (들어옴 − 나감) <small style="color:#6b7280">보증금 · 카드정산 · 대출원금</small></td><td class="num">'+mny(signed(sNo), cls(sNo))+'</td></tr>' +
      '<tr class="ind'+(r.un.n ? " open" : "")+'"><td>+ 미분류 (들어옴 − 나감)</td><td class="num">'+mny(signed(sUn), cls(sUn))+'</td></tr>' +
      '<tr class="sub"><td>= 계산한 통장 증감</td><td class="num">'+mny(signed(r.calcFlow), cls(r.calcFlow))+'</td></tr>' +
      '<tr class="sub"><td>실제 통장 증감 (들어온 − 나간)</td><td class="num">'+mny(signed(r.flow), cls(r.flow))+'</td></tr></tbody>';
    $("reconLine").innerHTML = (r.ok ? badge("b-ok", "✓ 맞음") + " 손익에 손익 아님과 미분류를 더하면 통장 증감이 됩니다." : badge("b-red", "✗ 안 맞음") + " 차이가 납니다. 분류 · 귀속월을 확인하세요.");
    var v = pnlView.filter(function(x){ return x["월"] === r.m; })[0];
    var same = v && Number(v["매출"]) === r.sales.total && Number(v["비용"]) === r.cost.total && Number(v["남은돈"]) === r.left && Number(v["미분류_건수"]) === r.un.n;
    $("viewLine").innerHTML = v ? (same ? badge("b-ok", "✓ 같음") + " 수파베이스 「월별 손익」 보기와 같은 숫자입니다(판 것 · 쓴 것 · 남은 돈 · 미분류 건수)." : badge("b-red", "✗ 다름") + " 수파베이스 월별 손익 보기와 숫자가 다릅니다. 새로고침하거나 분류를 확인하세요.") : "";

    var months = allMonths();
    $("monthsT").innerHTML = '<thead><tr><th>월</th><th class="num">판 것</th><th class="num">쓴 것</th><th class="num">남은 돈</th><th class="num">통장 증감</th><th class="num">미분류</th><th>맞음</th></tr></thead><tbody>' +
      months.map(function(m){ var x = calc(m); return '<tr'+(m === r.m ? ' class="sub"' : "")+'><td>'+esc(m)+'</td><td class="num">'+mny(won(x.sales.total))+'</td><td class="num">'+mny(won(x.cost.total))+'</td><td class="num">'+mny(signed(x.left), cls(x.left))+'</td><td class="num">'+mny(signed(x.flow), cls(x.flow))+'</td><td class="num">'+(x.un.n ? badge("b-red", x.un.n+"건") : "0")+'</td><td>'+(x.ok ? "✓" : badge("b-red", "✗"))+'</td></tr>'; }).join("") + '</tbody>';

    $("three").innerHTML = '<thead><tr><th>세 줄</th><th>지금</th></tr></thead><tbody>' +
      '<tr><td><b>1 · 남았나 모자랐나</b> (손익)</td><td>'+(r.un.n === r.n ? "아직 계산할 수 없습니다 — 분류한 거래가 없습니다" : mny(won(Math.abs(r.left))) + (r.left < 0 ? " 모자랐습니다" : " 남았습니다") + (r.un.n ? " <span style='color:#92400e'>(미분류 "+r.un.n+"건 빠짐)</span>" : ""))+'</td></tr>' +
      '<tr><td><b>2 · 통장에 얼마 있나</b> (잔액)</td><td>'+balanceText(r)+'</td></tr>' +
      '<tr><td><b>3 · 아직 못 받은 돈</b> (미수금)</td><td><a href="erp-bank.html">통장·매출 보기 → 못 받은 돈</a>에서 세금계산서와 입금을 나란히 놓고 봅니다</td></tr></tbody>';
  }

  $("fMonth").addEventListener("change", render);
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
  $("logout").addEventListener("click", async function(){ await sb.auth.signOut(); show(null); });

  sb.auth.getSession().then(function(r){ show(r.data.session); });
})();
