/**
 * 数据页签配置。
 * `hidden: true` 的页签**不在界面展示，也不纳入提交时的差异扫描**；
 * 需要恢复时去掉该标记即可，其余代码无需改动。
 * 当前只展示两张「数据及排放量表」。
 */
var VERIFY_TABS = [
  { id: 'enterprise-emission', name: '企业层级生产数据及排放量表' },
  { id: 'process-emission', name: '工序/生产线生产数据及排放量表' },
  { id: 'enterprise', name: '企业基本信息表', sameAsAnnual: true, hidden: true },
  { id: 'facility', name: '工序生产设施信息表', sameAsAnnual: true, hidden: true },
  { id: 'summary', name: '排放量汇总表', hidden: true },
  { id: 'assist', name: '辅助报告项', hidden: true },
];

/** 界面上实际展示的页签 */
var VERIFY_VISIBLE_TABS = VERIFY_TABS.filter(function (t) { return !t.hidden; });

/** 默认打开的页签（取第一个展示的） */
var VERIFY_DEFAULT_TAB = VERIFY_VISIBLE_TABS[0].id;

var VERIFY_FLOW_KEY = 'verify-fill-flow-v2';
var VERIFY_THRESHOLD_KEY = 'verify-fill-threshold-v1';

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function looksNumeric(value) {
  if (value === '' || value == null) return false;
  return /^-?\d+(\.\d+)?$/.test(String(value).trim());
}

function toNumber(value) {
  if (value === '' || value == null) return null;
  var n = Number(String(value).trim());
  return isNaN(n) ? null : n;
}

function formatNum(n) {
  if (n == null || isNaN(n)) return '';
  var abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(2).replace(/\.?0+$/, '');
  if (abs >= 1) return n.toFixed(2).replace(/\.?0+$/, '');
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function getHeaderCol(sheet, name) {
  if (!sheet) return null;
  for (var i = 0; i < sheet.headers.length; i++) {
    if (sheet.headers[i].value === name) return sheet.headers[i].col;
  }
  return null;
}

function getCellByCol(row, col) {
  for (var i = 0; i < row.length; i++) {
    if (row[i].col === col) return row[i];
  }
  return null;
}

function getRowLabel(row) {
  var parts = [];
  for (var i = 0; i < row.length && parts.length < 4; i++) {
    var v = row[i].value;
    if (v && !looksNumeric(v) && ['实测值', '缺省值', '计算值', '/', '无', '有'].indexOf(v) === -1) {
      parts.push(String(v));
    }
  }
  return parts.join(' / ') || '未命名指标';
}

function calcDiffInfo(yearVal, verifyVal, thresholdPercent) {
  var year = toNumber(yearVal);
  var verify = toNumber(verifyVal);
  if (year == null || verify == null) {
    return { diff: null, rate: null, exceed: false };
  }
  var diff = verify - year;
  var rate = Math.abs(year) < 1e-12 ? null : (Math.abs(diff) / Math.abs(year)) * 100;
  var exceed = rate != null && rate > thresholdPercent;
  return { diff: diff, rate: rate, exceed: exceed };
}

function warnIconSvg() {
  return '<span class="diff-warn" title="差异率超过设定阈值">'
    + '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
    + '<path fill="currentColor" d="M12 3L1.5 21h21L12 3zm0 5.5c.55 0 1 .4 1 .9v4.2c0 .5-.45.9-1 .9s-1-.4-1-.9V9.4c0-.5.45-.9 1-.9zm0 8.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z"/>'
    + '</svg></span>';
}

function renderDiffCell(info) {
  if (info.rate == null) {
    return '<td class="col-diff">'
      + '<div class="diff-cell-inner"><span class="diff-warn-slot"></span><span class="diff-value">--</span></div>'
      + '</td>';
  }
  var cls = ['col-diff'];
  if (info.exceed) cls.push('diff-exceed');
  var rateText = info.rate.toFixed(2) + '%';
  return '<td class="' + cls.join(' ') + '">'
    + '<div class="diff-cell-inner">'
    + '<span class="diff-warn-slot">' + (info.exceed ? warnIconSvg() : '') + '</span>'
    + '<span class="diff-value">' + escapeHtml(rateText) + '</span>'
    + '</div>'
    + '</td>';
}

function collectExceedItems(thresholdPercent) {
  // 只扫界面上展示了的数据表（与 VERIFY_TABS 的 hidden 标记保持一致）
  var ids = VERIFY_VISIBLE_TABS
    .filter(function (t) { return !t.sameAsAnnual; })
    .map(function (t) { return t.id; });
  var items = [];
  ids.forEach(function (sheetId) {
    var sheet = VERIFY_SHEET_DATA[sheetId];
    if (!sheet) return;
    var yearCol = getHeaderCol(sheet, '全年');
    var verifyCol = getHeaderCol(sheet, '核查数据');
    if (yearCol == null || verifyCol == null) return;
    var tab = VERIFY_TABS.find(function (t) { return t.id === sheetId; });
    sheet.rows.forEach(function (row, rowIndex) {
      var yearCell = getCellByCol(row, yearCol);
      var verifyCell = getCellByCol(row, verifyCol);
      if (!yearCell || !verifyCell) return;
      var info = calcDiffInfo(yearCell.value, verifyCell.value, thresholdPercent);
      if (!info.exceed) return;
      items.push({
        id: sheetId + '-' + rowIndex,
        sheetId: sheetId,
        sheetName: tab ? tab.name : sheet.title,
        label: getRowLabel(row),
        year: yearCell.value,
        verify: verifyCell.value,
        diff: info.diff,
        rate: info.rate,
        analysis: '',
        measure: '',
        result: '',
        startTime: '',
        closeTime: '',
        status: 'pending', // pending | supervising | closed
      });
    });
  });
  return items;
}

function renderSheetTable(sheetId, thresholdPercent) {
  var data = (typeof VERIFY_SHEET_DATA !== 'undefined' && VERIFY_SHEET_DATA[sheetId]) || null;
  if (!data) {
    return '<div class="verify-tab-placeholder"><p>未找到表格数据</p></div>';
  }

  var verifyCol = getHeaderCol(data, '核查数据');
  var diffCol = getHeaderCol(data, '差异情况');
  var yearCol = getHeaderCol(data, '全年');

  var thead = '<tr>' + data.headers.map(function (h) {
    var attrs = '';
    if (h.rowspan > 1) attrs += ' rowspan="' + h.rowspan + '"';
    if (h.colspan > 1) attrs += ' colspan="' + h.colspan + '"';
    var cls = '';
    if (h.value === '核查数据') cls = ' class="col-verify"';
    if (h.value === '差异情况') cls = ' class="col-diff"';
    return '<th' + attrs + cls + '>' + escapeHtml(h.value) + '</th>';
  }).join('') + '</tr>';

  var tbody = data.rows.map(function (row, rowIndex) {
    var yearCell = yearCol == null ? null : getCellByCol(row, yearCol);
    var verifyCell = verifyCol == null ? null : getCellByCol(row, verifyCol);
    var diffInfo = calcDiffInfo(
      yearCell ? yearCell.value : '',
      verifyCell ? verifyCell.value : '',
      thresholdPercent
    );

    var tds = row.map(function (cell) {
      var attrs = '';
      if (cell.rowspan > 1) attrs += ' rowspan="' + cell.rowspan + '"';
      if (cell.colspan > 1) attrs += ' colspan="' + cell.colspan + '"';

      if (cell.col === verifyCol && (cell.colspan || 1) === 1) {
        return '<td' + attrs + ' class="col-verify">'
          + '<input class="verify-cell-input" data-sheet="' + sheetId + '" data-row="' + rowIndex
          + '" data-col="' + cell.col + '" value="' + escapeHtml(cell.value) + '" placeholder="请输入" />'
          + '</td>';
      }

      if (cell.col === diffCol && (cell.colspan || 1) === 1) {
        return renderDiffCell(diffInfo).replace('<td', '<td' + attrs);
      }

      var cls = [];
      if (looksNumeric(cell.value)) cls.push('is-num');
      if ((cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1) cls.push('is-merged');
      var classAttr = cls.length ? ' class="' + cls.join(' ') + '"' : '';
      return '<td' + attrs + classAttr + '>' + escapeHtml(cell.value) + '</td>';
    }).join('');
    return '<tr>' + tds + '</tr>';
  }).join('');

  return ''
    + '<div class="verify-sheet-card">'
    + '<div class="verify-sheet-title">' + escapeHtml(data.title)
    + '<span class="verify-threshold-tag">当前差异阈值 ' + thresholdPercent + '%</span></div>'
    + '<div class="verify-table-wrap">'
    + '<table class="verify-data-table">'
    + '<thead>' + thead + '</thead>'
    + '<tbody>' + tbody + '</tbody>'
    + '</table>'
    + '</div>'
    + '</div>';
}

function initVerifyPage() {
  initLayout('verify-data', { moduleId: 'verify' });

  var state = {
    view: 'landing',
    tab: VERIFY_DEFAULT_TAB,
    year: '2025',
    product: '炼钢-粗钢',
    threshold: 10,
    submitted: false,
    exceedItems: [],
  };

  try {
    var savedTh = localStorage.getItem(VERIFY_THRESHOLD_KEY);
    if (savedTh != null && savedTh !== '') state.threshold = Number(savedTh) || 10;
    var savedFlow = localStorage.getItem(VERIFY_FLOW_KEY);
    if (savedFlow) {
      var parsed = JSON.parse(savedFlow);
      if (parsed && parsed.submitted) {
        state.submitted = true;
        state.exceedItems = Array.isArray(parsed.items) ? parsed.items : [];
        if (parsed.threshold != null) state.threshold = Number(parsed.threshold) || state.threshold;
      }
    }
  } catch (e) { /* ignore */ }

  var landing = document.getElementById('view-landing');
  var detail = document.getElementById('view-detail');
  var supervise = document.getElementById('view-supervise');
  var yearEl = document.getElementById('verify-year');
  var titleEl = document.getElementById('verify-conclusion-title');
  var badgeEl = document.getElementById('verify-status-badge');
  var actionsEl = document.getElementById('verify-hero-actions');
  var tabsEl = document.getElementById('verify-sheet-tabs');
  var bodyEl = document.getElementById('verify-detail-body');
  var footerEl = document.getElementById('verify-detail-footer');
  var thresholdModal = document.getElementById('threshold-modal');
  var thresholdInput = document.getElementById('threshold-input');

  function syncYearTitle() {
    state.year = yearEl.value;
    titleEl.textContent = state.year + '年核查结论';
  }

  function showView(name) {
    state.view = name;
    landing.hidden = name !== 'landing';
    detail.hidden = name !== 'detail';
    supervise.hidden = name !== 'supervise';
  }

  function persistFlow() {
    try {
      localStorage.setItem(VERIFY_FLOW_KEY, JSON.stringify({
        submitted: state.submitted,
        year: state.year,
        product: state.product,
        threshold: state.threshold,
        items: state.exceedItems,
      }));
    } catch (e) { /* ignore */ }
  }

  function renderLandingActions() {
    if (!state.submitted) {
      badgeEl.textContent = '待上报';
      badgeEl.classList.remove('is-done');
      actionsEl.innerHTML = '<button type="button" class="btn verify-upload-btn" id="btn-upload-data">上传数据</button>';
      return;
    }
    badgeEl.textContent = '已上传';
    badgeEl.classList.add('is-done');
    // 「督导详情」入口已隐藏（原型不再展示督导环节），需要时把按钮加回来即可
    actionsEl.innerHTML =
      '<button type="button" class="btn verify-upload-btn" id="btn-view-data">查看数据</button>';
  }

  function renderDetailFooter() {
    if (state.submitted) {
      footerEl.innerHTML = '<button type="button" class="btn btn-lg" id="btn-detail-back">返回首页</button>';
      return;
    }
    footerEl.innerHTML =
      '<button type="button" class="btn btn-lg" id="btn-save">保存</button>'
      + '<button type="button" class="btn btn-primary btn-lg" id="btn-submit">提交</button>';
  }

  function renderTabs() {
    tabsEl.innerHTML = VERIFY_VISIBLE_TABS.map(function (tab) {
      var active = tab.id === state.tab ? ' active' : '';
      return '<button type="button" class="verify-sheet-tab' + active + '" data-tab="' + tab.id + '">'
        + tab.name
        + '</button>';
    }).join('');
  }

  function renderTabBody() {
    var tab = VERIFY_TABS.find(function (t) { return t.id === state.tab; }) || VERIFY_VISIBLE_TABS[0];
    if (tab.sameAsAnnual) {
      bodyEl.innerHTML =
        '<div class="verify-same-tip">'
        + '<div class="verify-same-tip-title">' + tab.name + '</div>'
        + '<p>与年报界面相同</p>'
        + '</div>';
      return;
    }
    bodyEl.innerHTML = renderSheetTable(tab.id, state.threshold);
  }

  function openDetail() {
    state.tab = VERIFY_DEFAULT_TAB;
    showView('detail');
    renderTabs();
    renderTabBody();
    renderDetailFooter();
  }

  function openThresholdModal() {
    thresholdInput.value = String(state.threshold);
    thresholdModal.classList.add('show');
  }

  function closeThresholdModal() {
    thresholdModal.classList.remove('show');
  }

  function renderSupervise() {
    var meta = document.getElementById('supervise-meta');
    var tbody = document.getElementById('supervise-tbody');
    if (!state.exceedItems.length) {
      meta.textContent = '当前无超过差异阈值的整改项。';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="11">暂无数据</td></tr>';
      return;
    }
    meta.innerHTML = '共 <b>' + state.exceedItems.length + '</b> 项超过差异阈值（' + state.threshold + '%）。';

    tbody.innerHTML = state.exceedItems.map(function (item, idx) {
      var started = item.status === 'supervising' || item.status === 'closed';
      var closed = item.status === 'closed';
      var editable = item.status === 'supervising';

      function field(key, placeholder) {
        if (!started) return '<span class="track-muted">—</span>';
        if (closed) return '<span class="supervise-text">' + escapeHtml(item[key] || '—') + '</span>';
        return '<input class="verify-measure-input" data-field="' + key + '" data-idx="' + idx
          + '" placeholder="' + placeholder + '" value="' + escapeHtml(item[key] || '') + '" />';
      }

      var action = '';
      if (item.status === 'pending') {
        action = '<button type="button" class="btn btn-primary" data-sup="start" data-idx="' + idx + '">开始督导</button>';
      } else if (item.status === 'supervising') {
        action = '<button type="button" class="btn btn-primary" data-sup="close" data-idx="' + idx + '">督导闭环</button>';
      } else {
        action = '<span class="track-done-text">已闭环</span>';
      }

      return '<tr>'
        + '<td>' + escapeHtml(item.sheetName) + '</td>'
        + '<td>' + escapeHtml(item.label) + '</td>'
        + '<td class="is-num">' + escapeHtml(item.year) + '</td>'
        + '<td class="is-num">' + escapeHtml(item.verify) + '</td>'
        + '<td class="is-num diff-exceed">' + (item.rate == null ? '--' : item.rate.toFixed(2) + '%') + '</td>'
        + '<td>' + field('analysis', '差异分析说明') + '</td>'
        + '<td>' + field('measure', '整改措施') + '</td>'
        + '<td>' + field('result', '整改结果') + '</td>'
        + '<td class="is-num">' + escapeHtml(item.startTime || '—') + '</td>'
        + '<td class="is-num">' + escapeHtml(item.closeTime || '—') + '</td>'
        + '<td class="col-action">' + action + '</td>'
        + '</tr>';
    }).join('');
  }

  function openSupervise() {
    renderSupervise();
    showView('supervise');
  }

  yearEl.addEventListener('change', syncYearTitle);

  document.querySelector('.verify-product-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-product]');
    if (!btn) return;
    state.product = btn.dataset.product;
    document.querySelectorAll('.verify-product-tab').forEach(function (el) {
      el.classList.toggle('active', el === btn);
    });
  });

  actionsEl.addEventListener('click', function (e) {
    // 上传数据 / 查看数据 都进数据页签界面（督导详情入口已隐藏）
    if (e.target.closest('#btn-upload-data') || e.target.closest('#btn-view-data')) openDetail();
  });

  tabsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    renderTabs();
    renderTabBody();
  });

  bodyEl.addEventListener('change', function (e) {
    var input = e.target.closest('.verify-cell-input');
    if (!input || typeof VERIFY_SHEET_DATA === 'undefined') return;
    var sheet = VERIFY_SHEET_DATA[input.dataset.sheet];
    if (!sheet) return;
    var row = sheet.rows[Number(input.dataset.row)];
    if (!row) return;
    var col = Number(input.dataset.col);
    for (var i = 0; i < row.length; i++) {
      if (row[i].col === col) {
        row[i].value = input.value;
        break;
      }
    }
    renderTabBody();
  });

  footerEl.addEventListener('click', function (e) {
    if (e.target.closest('#btn-save')) {
      toast('核查数据已保存');
      return;
    }
    if (e.target.closest('#btn-detail-back')) {
      showView('landing');
      return;
    }
    if (!e.target.closest('#btn-submit')) return;

    state.exceedItems = collectExceedItems(state.threshold);
    state.submitted = true;
    persistFlow();
    renderLandingActions();
    showView('landing');
    toast(state.exceedItems.length
      ? ('提交成功，共 ' + state.exceedItems.length + ' 项差异超过阈值')
      : '提交成功，无超阈值差异项');
  });

  // 数据页签界面左上角「返回主界面」
  var backIcon = document.getElementById('btn-detail-back-icon');
  if (backIcon) {
    backIcon.addEventListener('click', function () { showView('landing'); });
  }

  document.getElementById('btn-threshold').addEventListener('click', openThresholdModal);
  document.getElementById('btn-threshold-close').addEventListener('click', closeThresholdModal);
  document.getElementById('btn-threshold-cancel').addEventListener('click', closeThresholdModal);
  document.getElementById('btn-threshold-ok').addEventListener('click', function () {
    var val = Number(thresholdInput.value);
    if (isNaN(val) || val < 0 || val > 100) {
      toast('请输入 0~100 之间的阈值');
      return;
    }
    state.threshold = val;
    try { localStorage.setItem(VERIFY_THRESHOLD_KEY, String(val)); } catch (err) { /* ignore */ }
    closeThresholdModal();
    toast('差异阈值已设为 ' + val + '%');
    if (!detail.hidden) renderTabBody();
  });
  thresholdModal.addEventListener('click', function (e) {
    if (e.target === thresholdModal) closeThresholdModal();
  });

  document.getElementById('supervise-tbody').addEventListener('input', function (e) {
    var input = e.target.closest('[data-field]');
    if (!input) return;
    var idx = Number(input.dataset.idx);
    var field = input.dataset.field;
    if (!state.exceedItems[idx]) return;
    state.exceedItems[idx][field] = input.value;
    persistFlow();
  });

  document.getElementById('supervise-tbody').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-sup]');
    if (!btn) return;
    var idx = Number(btn.dataset.idx);
    var item = state.exceedItems[idx];
    if (!item) return;

    if (btn.dataset.sup === 'start') {
      item.status = 'supervising';
      item.startTime = nowText();
      persistFlow();
      renderSupervise();
      toast('已开始督导');
      return;
    }

    if (btn.dataset.sup === 'close') {
      if (!(item.analysis || '').trim() || !(item.measure || '').trim() || !(item.result || '').trim()) {
        toast('请先维护差异分析说明、整改措施、整改结果');
        return;
      }
      item.status = 'closed';
      item.closeTime = nowText();
      persistFlow();
      renderSupervise();
      var allClosed = state.exceedItems.every(function (x) { return x.status === 'closed'; });
      toast(allClosed ? '全部督导项已闭环' : '该项已督导闭环');
    }
  });

  document.getElementById('btn-supervise-home').addEventListener('click', function () {
    showView('landing');
  });

  var resetBtn = document.getElementById('btn-demo-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!confirm('将把核查数据恢复到初始状态（未上传、未提交），当前演示进度会清除。确定重置？')) return;
      try {
        localStorage.removeItem(VERIFY_FLOW_KEY);
        localStorage.removeItem(VERIFY_THRESHOLD_KEY);
      } catch (err) { /* ignore */ }
      location.reload();
    });
  }

  syncYearTitle();
  renderLandingActions();
  showView('landing');
}

if (document.querySelector('.verify-page')) initVerifyPage();
