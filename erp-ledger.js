// 문의 대장 · 고객 대장 공용 스크립트
// 화면은 <body data-screen="inq"> (문의 대장) 또는 <body data-screen="cust"> (고객 대장) 로 구분한다.
(function(){
  // 공개용(anon) 키만 사용. 대표 계정으로 로그인해야 문의·고객을 읽을 수 있다 (RLS).
  var SUPABASE_URL = "https://dykljzknwcqncxusiqkf.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a2xqemtud2NxbmN4dXNpcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODM3NTEsImV4cCI6MjEwNTE1OTc1MX0.vo7fWD4xrTdZXjAG8NBUd1Dcmj7EjOLcYBPj7-ROQGM";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var SRC = {search:"검색", map:"지도", referral:"지인 소개", sns:"SNS", phone:"전화", other:"기타", unknown:"모르겠음"};   // 홈페이지 문의 폼과 같은 이름
  var STAGES = ["접수","연락중","상담완료"];
  var RESULTS = ["계약","보류","실패"];
  var $ = function(id){ return document.getElementById(id); };
  var WANT_CUST = !!$("crows");   // 고객 대장 화면인가
  var WANT_INQ = !!$("rows");     // 문의 대장 화면인가

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function opts(arr, cur){ return arr.map(function(v){ return '<option'+(v===cur?' selected':'')+'>'+v+'</option>'; }).join(""); }
  function fmtPhone(p){ return p.length===11 ? p.replace(/(\d{3})(\d{4})(\d{4})/,"$1-$2-$3") : p.length===10 ? p.replace(/(\d{2,3})(\d{3,4})(\d{4})/,"$1-$2-$3") : p; }
  function kdate(iso){ var d = new Date(iso), p = function(n){ return (n<10?"0":"")+n; }; return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
  function pad4(n){ return ("0000"+n).slice(-4); }
  function cno(id){ return "C-"+pad4(id); }   // 고객번호 (customers.id 에서 만든 화면용 번호)
  function qno(id){ return "Q-"+pad4(id); }   // 접수번호 (inquiries.id)
  function resultBadge(r){
    if (!r) return '<span class="badge b-none">미입력</span>';
    return '<span class="badge '+(r==="계약"?"b-yes":r==="보류"?"b-hold":"b-fail")+'">'+esc(r)+'</span>';
  }

  function show(session){
    var on = !!session;
    $("login").hidden = on; $("app").hidden = !on; $("logout").hidden = !on;
    $("who").textContent = on ? session.user.email : "";
    if (on) load();
  }

  var openCust = {};   // 펼쳐 둔 고객
  var cache = null;    // 마지막으로 불러온 고객·문의 (줄을 펼칠 때는 다시 불러오지 않고 이걸로 그린다)

  async function load(){
    if (WANT_INQ) $("count").textContent = "불러오는 중…";
    if (WANT_CUST) $("ccount").textContent = "불러오는 중…";
    var r = await sb.from("inquiries").select("*").order("created_at", {ascending:false});
    var c = WANT_CUST ? await sb.from("customers").select("*").order("id", {ascending:false}) : {data:[], error:null};
    if (r.error || c.error){
      var msg = esc((r.error || c.error).message);
      if (WANT_INQ){ $("count").textContent = ""; $("rows").innerHTML = '<tr><td colspan="9" class="empty">불러오지 못했습니다: '+msg+' (이 계정에 열람 권한이 없을 수 있습니다)</td></tr>'; }
      if (WANT_CUST){ $("ccount").textContent = ""; $("crows").innerHTML = '<tr><td colspan="5" class="empty">불러오지 못했습니다: '+msg+' (이 계정에 열람 권한이 없을 수 있습니다)</td></tr>'; }
      return;
    }
    cache = { cust: c.data || [], inq: r.data || [] };
    if (WANT_INQ) renderInq(cache.inq);
    if (WANT_CUST) renderCust(cache.cust, cache.inq);
  }

  // 고객 대장: 고객번호 · 이름 · 처음 알게 된 경로 · 문의 건수 · 계약 건수
  function renderCust(custs, inqs){
    $("ccount").textContent = "고객 " + custs.length + "명";
    if (!custs.length){ $("crows").innerHTML = '<tr><td colspan="5" class="empty">아직 고객이 없습니다.</td></tr>'; return; }
    var by = {};
    inqs.forEach(function(q){ (by[q.customer_id] = by[q.customer_id] || []).push(q); });
    $("crows").innerHTML = custs.map(function(cu){
      var qs = (by[cu.id] || []).slice().sort(function(a,b){ return new Date(a.created_at) - new Date(b.created_at); });
      var contracts = qs.filter(function(q){ return q.result === "계약"; }).length;
      var open = !!openCust[cu.id];
      var html = '<tr class="cust" data-cid="'+cu.id+'">'+
        '<td>'+(open?'▾':'▸')+' '+cno(cu.id)+'</td>'+
        '<td>'+esc(cu.name)+'<div class="cno">'+esc(fmtPhone(cu.phone))+'</div></td>'+
        '<td>'+esc(SRC[cu.first_source] || "모르겠음")+'</td>'+
        '<td>'+qs.length+'</td>'+
        '<td>'+contracts+'</td></tr>';
      if (open){
        html += '<tr class="detail"><td colspan="5"><table class="sub"><thead><tr><th>접수일</th><th>접수번호</th><th>문의 이름</th><th>관심 제품</th><th>이 문의의 경로</th><th>응대 단계</th><th>계약 결과</th></tr></thead><tbody>'+
          qs.map(function(q){
            return '<tr><td>'+kdate(q.created_at)+'</td><td>'+qno(q.id)+'</td><td>'+esc(q.name)+(q.name!==cu.name?'<span class="tag-diff">고객 이름과 다름</span>':'')+'</td><td>'+esc(q.product||"-")+'</td>'+
              '<td>'+esc(SRC[q.source]||"모르겠음")+(q.source!==cu.first_source?'<span class="tag-diff">첫 경로와 다름</span>':'')+'</td>'+
              '<td>'+esc(q.stage)+'</td><td>'+resultBadge(q.result)+'</td></tr>';
          }).join("")+'</tbody></table></td></tr>';
      }
      return html;
    }).join("");
  }

  // 문의 대장
  function renderInq(list){
    $("count").textContent = "문의 " + list.length + "건";
    if (!list.length){ $("rows").innerHTML = '<tr><td colspan="9" class="empty">아직 문의가 없습니다.</td></tr>'; return; }
    $("rows").innerHTML = list.map(function(q){
      return '<tr>'+
        '<td>'+kdate(q.created_at)+'</td>'+
        '<td>'+qno(q.id)+'<div class="cno">'+(q.customer_id?cno(q.customer_id):"")+'</div></td>'+
        '<td>'+esc(q.name)+'</td>'+
        '<td>'+esc(fmtPhone(q.phone))+'</td>'+
        '<td>'+esc(q.product || "-")+'</td>'+
        '<td>'+esc(SRC[q.source] || "모르겠음")+'</td>'+
        '<td class="msg">'+esc(q.message || "")+'</td>'+
        '<td><select data-id="'+q.id+'" data-k="stage">'+opts(STAGES, q.stage)+'</select></td>'+
        '<td>'+resultBadge(q.result)+' <select data-id="'+q.id+'" data-k="result"><option value="">(비움)</option>'+opts(RESULTS, q.result)+'</select></td>'+
      '</tr>';
    }).join("");
  }

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

  if (WANT_CUST){
    $("crows").addEventListener("click", function(e){
      var tr = e.target.closest("tr.cust"); if (!tr) return;
      var id = tr.getAttribute("data-cid"); openCust[id] = !openCust[id];
      if (cache) renderCust(cache.cust, cache.inq); else load();
    });
  }

  if (WANT_INQ){
    $("f").addEventListener("submit", async function(e){
      e.preventDefault();
      var f = e.target, name = f.name.value.trim(), phone = f.phone.value.replace(/\D/g,"");
      if (!name){ $("err").textContent = "이름을 넣어주세요."; return; }
      if (phone.length < 9 || phone.length > 11){ $("err").textContent = "연락처는 숫자 9~11자리로 넣어주세요."; return; }
      if (!f.consent.checked){ $("err").textContent = "개인정보 수집 동의 확인이 필요합니다."; return; }
      $("err").textContent = ""; $("addbtn").disabled = true;
      var r = await sb.from("inquiries").insert({
        name: name, phone: phone, product: f.product.value || null, message: f.message.value.trim() || null,
        source: f.source.value, stage: f.stage.value, result: f.result.value || null, consent: true
      });
      $("addbtn").disabled = false;
      if (r.error){ $("err").textContent = "저장하지 못했습니다: " + r.error.message; return; }
      f.reset(); load();
    });

    // 응대 단계 / 계약 결과는 서로 다른 칸 — 각각 따로 바꾼다
    $("rows").addEventListener("change", async function(e){
      var t = e.target, id = t.getAttribute("data-id"), k = t.getAttribute("data-k");
      if (!id || !k) return;
      var patch = {}; patch[k] = t.value || null;
      var r = await sb.from("inquiries").update(patch).eq("id", id);
      if (r.error) alert("바꾸지 못했습니다: " + r.error.message);
      load();
    });
  }

  sb.auth.getSession().then(function(r){ show(r.data.session); });
})();
