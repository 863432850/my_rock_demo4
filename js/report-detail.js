/**
 * 填报详情页 —— 从首页月卡「查看详情」进入
 *
 * 入参：report-detail.html?year=2026&month=7
 *
 * 整页只读：把该月已提交的数据按「主体页签 + 参数页签 + 物料/参数表」摊开展示，
 * 数据来源与数据填报页完全一致（js/report-data-store.js），看到的就是当时提交的。
 * 唯一出口是顶栏左上角「←」；想改数请回首页月卡点「重新填报」。
 */

let rdCfg = null;

/** 当前年月、当前选中的主体与页签 */
let rdYear = new Date().getFullYear();
let rdMonth = new Date().getMonth() + 1;
let rdEntity = '';
let rdTab = '';

/** 该月的整份数据（{ '全厂::化石燃料': { '0:1': { value, remark } } }），没有则为 null */
let rdValues = null;

function rdQ(name) {
  const m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

/* ---------- 渲染 ---------- */

function rdRenderEntities() {
  document.getElementById('rd-entities').innerHTML = rdCfg.lines.map(function (name) {
    return '<button type="button" class="report-entity' + (name === rdEntity ? ' active' : '') + '" data-entity="' + rcEsc(name) + '">' + rcEsc(name) + '</button>';
  }).join('');
}

function rdRenderTabs() {
  document.getElementById('rd-tabs').innerHTML = rdCfg.tags.map(function (name) {
    return '<button type="button" class="report-tab' + (name === rdTab ? ' active' : '') + '" data-tab="' + rcEsc(name) + '">' + rcEsc(name) + '</button>';
  }).join('');
}

function rdRenderTable() {
  const table = document.getElementById('rd-table');
  const mats = rcMatsOf(rdCfg, rdTab);

  if (!mats.length) {
    table.innerHTML = '<tbody><tr><td class="rp-empty">「' + rcEsc(rdTab) + '」下没有配置物料</td></tr></tbody>';
    return;
  }

  if (!rdValues) {
    table.innerHTML = '<tbody><tr><td class="rp-empty">该月还没有已提交的数据</td></tr></tbody>';
    return;
  }

  const cells = rdValues[rdEntity + '::' + rdTab] || {};

  const head =
    '<thead><tr>'
    + '<th class="rp-col-fuel">物料名称</th>'
    + '<th class="rp-col-param">参数名称</th>'
    + '<th class="rp-col-value">填报值</th>'
    + '<th class="rp-col-unit">单位</th>'
    + '<th class="rp-col-remark">备注</th>'
    + '</tr></thead>';

  const rows = [];

  mats.forEach(function (m, mi) {
    (m.params || []).forEach(function (p, pi) {
      const c = cells[mi + ':' + pi] || {};
      const value = String(c.value == null ? '' : c.value).trim();

      let tds = '';
      if (pi === 0) {
        tds += '<td class="rp-fuel" rowspan="' + m.params.length + '">' + rcEsc(m.material) + '</td>';
      }
      tds += '<td class="rp-param">' + rcEsc(p.name) + '</td>';
      tds += '<td class="rd-value' + (value ? '' : ' is-empty') + '">' + (value ? rcEsc(value) : '—') + '</td>';
      tds += '<td class="rp-unit">' + rcEsc(p.unit) + '</td>';
      tds += '<td class="rd-remark">' + (c.remark ? rcEsc(c.remark) : '—') + '</td>';

      rows.push('<tr>' + tds + '</tr>');
    });
  });

  table.innerHTML = head + '<tbody>' + rows.join('') + '</tbody>';
}

function rdRenderAll() {
  rdRenderEntities();
  rdRenderTabs();
  rdRenderTable();
}

/* ---------- 事件 ---------- */

function rdBindPage() {
  document.getElementById('rd-entities').addEventListener('click', function (e) {
    const btn = e.target.closest('.report-entity');
    if (!btn || btn.dataset.entity === rdEntity) return;
    rdEntity = btn.dataset.entity;
    rdRenderEntities();
    rdRenderTable();
  });

  document.getElementById('rd-tabs').addEventListener('click', function (e) {
    const tab = e.target.closest('.report-tab');
    if (!tab || tab.dataset.tab === rdTab) return;
    rdTab = tab.dataset.tab;
    rdRenderTabs();
    rdRenderTable();
  });

  // 本页唯一的出口：顶栏左上角「←」。底部没有操作条 ——
  // 想改数据回首页月卡点「重新填报」，不在详情页再放一个入口。
  const back = function (e) {
    e.preventDefault();
    if (history.length > 1) history.back();
    else location.href = 'manual-entry.html';
  };
  document.getElementById('rd-back').addEventListener('click', back);
}

/* ---------- 初始化 ---------- */

function initReportDetailPage() {
  rdYear = Number(rdQ('year')) || rdYear;
  rdMonth = Number(rdQ('month')) || rdMonth;

  rdCfg = rcLoadConfig();
  rdValues = rdDataFor(rdYear, rdMonth, rdCfg);

  const title = rdYear + '年' + rdMonth + '月填报详情';
  document.getElementById('rd-title').textContent = title;
  // 本页属「碳排放管理」模块（全屏子页不带平台壳，标题里仍要体现归属）
  document.title = title + ' · ' + moduleName('carbon');

  if (!rdCfg.lines.length || !rdCfg.tags.length) {
    document.getElementById('rd-table').innerHTML =
      '<tbody><tr><td class="rp-empty">还没有在「填报项配置」中选择报送生产线与行业填报标签</td></tr></tbody>';
    rdBindPage();
    return;
  }

  rdEntity = rdCfg.lines[0];
  rdTab = rdCfg.tags[0];

  rdRenderAll();
  rdBindPage();
}

if (document.querySelector('.detail-page')) initReportDetailPage();
