// 전자결재 규칙 — 「누구 차례인가」와 문서 이름은 여기 한 곳에서만 정한다.
// 전자결재(erp-approvals.html)와 밥톡(erp-talk.html)이 같이 쓴다.
(function(){
  var TYPE_LABELS = {
    leave:'연차',
    expense:'지출결의서',
    credit:'외상거래 · 여신조건',
    dc:'DC · 단가 예외'
  };

  // 부서장 부재 비상구 — 예전 저장본(비상구가 차장 하나뿐이던 때)도 읽는다
  function isAway(store, headId){
    if (!store) return false;
    if (store.away) return !!store.away[headId];
    return !!store.emergency && headId === 'chajang';
  }

  // 그 문서의 부서장이 아직 안 봤으면 부서장 차례(부재면 대표), 아니면 대표 차례
  function whoseTurn(d, store){
    if (d.status !== '진행중') return null;
    if (d.managerId && !d.mgrAt) return isAway(store, d.managerId) ? 'ceo' : d.managerId;
    return 'ceo';
  }

  window.ERP_RULES = {TYPE_LABELS:TYPE_LABELS, isAway:isAway, whoseTurn:whoseTurn};
})();
