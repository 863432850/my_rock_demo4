/**
 * 手工数据填报 —— 首页（年度月份看板）
 *
 * 版面参考「日历视图」的克制感：一个年度 = 12 个格子，4 列 × 3 行，
 * 每格只有三样东西 —— 月份、状态、操作按钮。
 * 不放进格子的（相较于旧版的「12 张大卡」）：状态说明、三个统计数字、填报进度条。
 * 这些信息在「查看详情」里都能看到，首页只负责回答一句话：
 * 「哪几个月还没填」，所以扫一眼就该看完。
 *
 * 格子状态（取自 report-data-store.js 的 rdStateOf）：
 *   passed     已通过   绿框  「查看详情」+「重新填报」
 *   filling    填报中   蓝框  「立即上报」
 *   pending    未填报   橙框  「立即上报」
 *   notStarted 未开始   整格置灰、不可点（未发生的月份）
 */

/** 填报主体（标题）。真实系统应取当前登录用户所属工序 / 产线 */
const ME_SUBJECT = '炼钢-粗钢';

/** 数据基准年：按「当前年」编排演示数据，跨年后依然合理 */
const ME_BASE_YEAR = RD_BASE_YEAR;

const ME_ACTION_TEXT = {
  detail: '查看详情',
  report: '立即上报',
  re: '重新填报',
};

/** 格子底部的按钮组 */
function meCellFoot(state, month) {
  if (state === 'notStarted') {
    // 未发生的月份：不给按钮，整格已经置灰，不需要再解释
    return '';
  }
  if (state === 'passed') {
    return '<div class="me-cell-foot">'
      + '<button type="button" class="me-btn is-solid" data-month="' + month + '" data-action="detail">'
      + ME_ACTION_TEXT.detail + '</button>'
      + '<button type="button" class="me-btn is-ghost" data-month="' + month + '" data-action="re">'
      + ME_ACTION_TEXT.re + '</button>'
      + '</div>';
  }
  return '<div class="me-cell-foot">'
    + '<button type="button" class="me-btn is-solid" data-month="' + month + '" data-action="report">'
    + ME_ACTION_TEXT.report + '</button>'
    + '</div>';
}

/** 一个格子的 HTML */
function meCellHtml(state, month) {
  return '<div class="me-cell is-' + state.toLowerCase() + '">'
    + '<span class="me-cell-month">' + month + '月</span>'
    + '<span class="me-cell-state">' + rdLabelOf(state) + '</span>'
    + meCellFoot(state, month)
    + '</div>';
}

function renderManualEntryGrid(year) {
  const grid = document.getElementById('me-grid');
  if (!grid) return;

  const cells = [];
  for (let m = 1; m <= 12; m++) {
    cells.push(meCellHtml(rdStateOf(year, m), m));
  }
  grid.innerHTML = cells.join('');
}

function initManualEntryPage() {
  initLayout('manual-entry', { moduleId: 'carbon' });

  const yearSel = document.getElementById('me-year');
  const grid = document.getElementById('me-grid');
  const subjectEl = document.querySelector('.me-title');

  if (subjectEl) subjectEl.textContent = ME_SUBJECT;
  yearSel.innerHTML = yearOptions(ME_BASE_YEAR);
  renderManualEntryGrid(ME_BASE_YEAR);

  document.getElementById('me-search').addEventListener('click', function () {
    const year = Number(yearSel.value) || ME_BASE_YEAR;
    renderManualEntryGrid(year);
    toast(year + ' 年填报数据已加载');
  });

  document.getElementById('me-reset').addEventListener('click', function () {
    yearSel.value = String(ME_BASE_YEAR);
    renderManualEntryGrid(ME_BASE_YEAR);
    toast('已重置');
  });

  // 格子底部按钮
  grid.addEventListener('click', function (e) {
    const btn = e.target.closest('.me-btn');
    if (!btn || btn.disabled) return;

    const month = btn.dataset.month;
    const year = Number(document.getElementById('me-year').value) || ME_BASE_YEAR;
    const base = 'year=' + year + '&month=' + month;

    if (btn.dataset.action === 'detail') {
      location.href = 'report-detail.html?' + base;
    } else if (btn.dataset.action === 're') {
      // 重新填报：同一个填报页，只是把该月已有数据带出来（mode=re 只为让语义更明确）
      location.href = 'month-report.html?' + base + '&mode=re';
    } else {
      location.href = 'month-report.html?' + base;
    }
  });
}

if (document.querySelector('.manual-entry-page')) initManualEntryPage();
