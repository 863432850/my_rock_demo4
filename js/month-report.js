/**
 * 数据填报页 —— 从首页月卡「立即上报」/「重新填报」进入
 *
 * 入参：month-report.html?year=2026&month=9[&mode=re]
 *   mode=re（重新填报）：把该月已有数据带出来，而不是空的
 *   不带 mode 时，只要该月已有数据（重新进入已通过 / 已保存过的月份），同样会带出来
 *
 * 页面结构：
 *   顶栏（← 返回 + 标题 + 导出模版 / 导入 / 填报项配置）
 *   报告主体页签  ← 来自配置的「报送生产线信息」
 *   参数页签      ← 来自配置的「行业填报标签」
 *   参数表        ← 来自配置的「物料与参数」
 *   底部（保存 / 提交）
 *
 * 数据来源：js/report-config-store.js 的 rcLoadConfig()（配置）
 *           js/report-data-store.js 的 rdDataFor() / rdSave()（填报值）
 *           vendor/xlsx.full.min.js 的 XLSX（导出 / 导入 Excel）
 *
 * 表格规则：所有参数项都由人工填报（已去掉「取值方式」列），
 *           首次打开时把配置里的预填值（params[].default）带出来，用户可改。
 */

/* ---------- 配置与填报值 ---------- */

let rpConfig = null;

/**
 * 用户填的值，按「主体 + 页签 + 物料 + 参数」四级存放，各主体互不串值。
 * RP_VALUES['全厂::化石燃料']['0:1'] = { value: '123', remark: '' }
 */
const RP_VALUES = {};

/** 已经灌过预填值的「主体::页签」组合，避免用户清空后被反复灌回 */
const RP_SEEDED = {};

let rpYear = new Date().getFullYear();
let rpMonth = new Date().getMonth() + 1;
let rpEntity = '';
let rpTab = '';

function rpQuery(name) {
  const m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function rpKey(entity, tab) {
  return entity + '::' + tab;
}

function rpCell(mi, pi) {
  const key = rpKey(rpEntity, rpTab);
  if (!RP_VALUES[key]) RP_VALUES[key] = {};
  const k2 = mi + ':' + pi;
  if (!RP_VALUES[key][k2]) RP_VALUES[key][k2] = { value: '', remark: '' };
  return RP_VALUES[key][k2];
}

/** 当前页签下的物料数组（可能为空，表示该标签还没配物料） */
function rpMaterials() {
  return rcMatsOf(rpConfig, rpTab);
}

/**
 * 首次打开某个「主体 + 页签」时，把参数配的预填值（params[].default）灌进去。
 * 每个组合只灌一次 —— 否则用户清空后切走再切回，值又自己长回来了。
 */
function rpSeedDefaults() {
  const key = rpKey(rpEntity, rpTab);
  if (RP_SEEDED[key]) return;
  RP_SEEDED[key] = true;

  const cells = RP_VALUES[key] || (RP_VALUES[key] = {});
  rpMaterials().forEach(function (m, mi) {
    (m.params || []).forEach(function (p, pi) {
      const k2 = mi + ':' + pi;
      if (cells[k2]) return;
      if (String(p.default == null ? '' : p.default).trim()) {
        cells[k2] = { value: String(p.default), remark: '' };
      }
    });
  });
}

/**
 * 把某月已存数据灌进 RP_VALUES（重新填报 / 重新进入已填过的月份时走这里）。
 * 灌过之后把该组合标记为「已灌值」，预填值就不会再覆盖它。
 */
function rpLoadSaved(values) {
  if (!values) return;
  Object.keys(values).forEach(function (key) {
    const src = values[key];
    if (!src) return;
    RP_VALUES[key] = {};
    RP_SEEDED[key] = true;
    Object.keys(src).forEach(function (k2) {
      RP_VALUES[key][k2] = { value: String(src[k2].value == null ? '' : src[k2].value), remark: String(src[k2].remark || '') };
    });
  });
}

/** 把当前 RP_VALUES 落库（保存 / 提交 / 填报项配置跳走前都存一次，避免白填） */
function rpPersist() {
  return rdSave(rpYear, rpMonth, RP_VALUES);
}

/* ---------- 渲染 ---------- */

function renderReportEntities() {
  const nav = document.getElementById('rp-entities');
  nav.innerHTML = rpConfig.lines.map(function (name) {
    return '<button type="button" class="report-entity' + (name === rpEntity ? ' active' : '') + '" data-entity="' + rcEsc(name) + '">' + rcEsc(name) + '</button>';
  }).join('');
}

function renderReportTabs() {
  const nav = document.getElementById('rp-tabs');
  nav.innerHTML = rpConfig.tags.map(function (name) {
    return '<button type="button" class="report-tab' + (name === rpTab ? ' active' : '') + '" data-tab="' + rcEsc(name) + '">' + rcEsc(name) + '</button>';
  }).join('');
}

function renderReportBody() {
  const table = document.getElementById('rp-table');
  const mats = rpMaterials();

  if (!mats.length) {
    table.innerHTML = '<tbody><tr><td class="rp-empty">「' + rcEsc(rpTab) + '」下还没有配置物料，'
      + '可到「填报项配置」里添加</td></tr></tbody>';
    return;
  }

  rpSeedDefaults();

  const head =
    '<thead><tr>'
    + '<th class="rp-col-fuel">物料名称</th>'
    + '<th class="rp-col-param">参数名称</th>'
    + '<th class="rp-col-value">人工填报</th>'
    + '<th class="rp-col-unit">单位</th>'
    + '<th class="rp-col-dec">保留小数</th>'
    + '<th class="rp-col-remark">备注</th>'
    + '</tr></thead>';

  const rows = [];

  mats.forEach(function (m, mi) {
    (m.params || []).forEach(function (p, pi) {
      const cell = rpCell(mi, pi);

      let tds = '';
      if (pi === 0) {
        tds += '<td class="rp-fuel" rowspan="' + m.params.length + '">' + rcEsc(m.material) + '</td>';
      }
      tds += '<td class="rp-param">' + rcEsc(p.name) + '</td>';
      tds += '<td class="rp-value">'
        + '<input type="text" class="rp-input rp-value-input" data-mi="' + mi + '" data-pi="' + pi + '"'
        + ' value="' + rcEsc(cell.value) + '" placeholder="请输入" /></td>';
      tds += '<td class="rp-unit">' + rcEsc(p.unit) + '</td>';
      tds += '<td class="rp-dec">' + rcEsc(p.decimals) + '</td>';
      tds += '<td class="rp-remark"><input type="text" class="rp-input" data-remark-mi="' + mi + '" data-remark-pi="' + pi + '" value="' + rcEsc(cell.remark) + '" placeholder="可填" /></td>';

      rows.push('<tr>' + tds + '</tr>');
    });
  });

  table.innerHTML = head + '<tbody>' + rows.join('') + '</tbody>';
}

/* ---------- 交互 ---------- */

function bindReportEvents() {
  // 主体切换：只重画表格，参数页签停在原地
  document.getElementById('rp-entities').addEventListener('click', function (e) {
    const btn = e.target.closest('.report-entity');
    if (!btn || btn.dataset.entity === rpEntity) return;
    rpEntity = btn.dataset.entity;
    renderReportEntities();
    renderReportBody();
  });

  // 参数页签切换
  document.getElementById('rp-tabs').addEventListener('click', function (e) {
    const tab = e.target.closest('.report-tab');
    if (!tab || tab.dataset.tab === rpTab) return;
    rpTab = tab.dataset.tab;
    renderReportTabs();
    renderReportBody();
  });

  const table = document.getElementById('rp-table');

  // 记住用户填的值，来回切换主体 / 页签不丢
  table.addEventListener('input', function (e) {
    const v = e.target.closest('.rp-value-input');
    if (v) {
      rpCell(+v.dataset.mi, +v.dataset.pi).value = v.value;
      return;
    }
    const r = e.target.closest('.rp-input[data-remark-mi]');
    if (r) {
      rpCell(+r.dataset.remarkMi, +r.dataset.remarkPi).remark = r.value;
    }
  });
}

function bindHeaderEvents() {
  document.getElementById('rp-back').addEventListener('click', function (e) {
    e.preventDefault();
    if (history.length > 1) history.back();
    else location.href = 'manual-entry.html';
  });

  document.getElementById('rp-config').addEventListener('click', function () {
    // 走之前先把手填的内容落库，避免用户填一半去改配置、回来发现白填
    rpPersist();
    // 带上当前年月，配置页保存 / 取消后能原样跳回本页的这个年月
    location.href = 'report-config.html?year=' + rpYear + '&month=' + rpMonth;
  });

  document.getElementById('rp-save').addEventListener('click', function () {
    if (!rpPersist()) {
      toast('保存失败：浏览器存储不可用');
      return;
    }
    toast(rpYear + '年' + rpMonth + '月 ' + rpEntity + ' 数据已保存');
  });

  document.getElementById('rp-submit').addEventListener('click', function () {
    // 校验范围是**全部「主体 × 页签」**，不是只查当前页签：
    // 只查当前页签的话，用户在别的页签漏填、切回来点提交会被放过去。
    const missing = [];
    rpConfig.lines.forEach(function (entity) {
      rpConfig.tags.forEach(function (tag) {
        const cells = RP_VALUES[rpKey(entity, tag)] || {};
        rcMatsOf(rpConfig, tag).forEach(function (m, mi) {
          (m.params || []).forEach(function (p, pi) {
            const c = cells[mi + ':' + pi];
            if (c && String(c.value).trim()) return;
            missing.push({ entity: entity, tag: tag, text: m.material + ' - ' + p.name });
          });
        });
      });
    });
    if (missing.length) {
      const first = missing[0];
      // 只有一个页签时不啰嗦，报出「主体 / 页签」反而碍眼
      const multi = rpConfig.lines.length > 1 || rpConfig.tags.length > 1;
      const where = multi ? first.entity + ' / ' + first.tag + ' 的 ' : '';
      toast('还有 ' + missing.length + ' 项未填写，如：' + where + first.text);
      return;
    }
    if (!rpPersist()) {
      toast('提交失败：浏览器存储不可用');
      return;
    }
    toast(rpYear + '年' + rpMonth + '月 ' + rpEntity + ' 数据已提交');
  });

  bindTransferEvents();
}

/* ============================================================
 * 导出模版 / 导入
 * ------------------------------------------------------------
 * 导出为 **Excel（.xlsx）**，列结构固定，第一列是「报送生产线信息」：
 *   第 1 行：填报说明（跨 7 列合并成一格，红字）——只给人看，导入时自动跳过
 *   第 2 行：报送生产线信息,行业填报标签,物料名称,参数名称,单位,填报值,备注
 *   第 3 行起：数据行（人工只填「填报值」和「备注」两列）
 * 导出 = 当前配置下的全部行（各主体 × 各标签 × 各物料 × 各参数），
 *        没填过的行按配置的预填值带出，所以它同时也是一份「模版」。
 * 导入 = 按「生产线 / 标签 / 物料 / 参数」名称回填，行顺序可以不一样；
 *        表头行位置是**探测**出来的（认「报送生产线信息」），所以带不带说明行都能导；
 *        支持 .xlsx / .xls / .csv（csv 留给从别处拿到的旧文件）。
 *
 * Excel 读写用 vendor/xlsx.full.min.js（SheetJS + 样式写入），是在本地跑的，不联网。
 * ============================================================ */

const RP_XLSX_HEAD = ['报送生产线信息', '行业填报标签', '物料名称', '参数名称', '单位', '填报值', '备注'];

/** 导出表最上面那行填报说明：合并成一格 + 红字，提示人工只填两列 */
const RP_XLSX_NOTE = '填报说明：除填报值和备注列，需人工填写外，其他列均不可修改！';
/** 说明行的行高（磅），比默认高一点，红字长句子不挤 */
const RP_XLSX_NOTE_HPT = 22;

/**
 * 拼出整页数据（也供自动化测试直接调用）。
 * 返回二维数组：第 0 行是表头，之后每行对应一个参数项。
 */
function rpBuildRows() {
  const rows = [RP_XLSX_HEAD.slice()];

  rpConfig.lines.forEach(function (entity) {
    rpConfig.tags.forEach(function (tag) {
      rcMatsOf(rpConfig, tag).forEach(function (m, mi) {
        (m.params || []).forEach(function (p, pi) {
          const cells = RP_VALUES[rpKey(entity, tag)];
          const k2 = mi + ':' + pi;
          const saved = cells && cells[k2];
          // 没碰过的组合按预填值带出，碰过的以用户填的为准（哪怕填的是空）
          const value = saved ? saved.value : (p.default == null ? '' : String(p.default));
          const remark = saved ? saved.remark : '';
          rows.push([entity, tag, m.material, p.name, p.unit, value, remark]);
        });
      });
    });
  });

  return rows;
}

/** 导出 Excel：首行是跨列合并的红字填报说明，第 2 行表头，第 3 行起是数据 */
function rpExportXlsx() {
  // 说明行插在最顶上，表头整体下移一行（rpBuildRows 返回的第 0 行就是表头了）
  const rows = [[RP_XLSX_NOTE]].concat(rpBuildRows());
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 16 }];

  // 说明行：A1:G1 合并成一格，字体调红加粗、垂直居中，行高抬一点
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: RP_XLSX_HEAD.length - 1 } }];
  ws['!rows'] = [{ hpt: RP_XLSX_NOTE_HPT }];
  if (ws['A1']) {
    ws['A1'].s = {
      font: { color: { rgb: 'FFFF0000' }, bold: true },
      alignment: { horizontal: 'left', vertical: 'center' }
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '数据填报');
  XLSX.writeFile(wb, '数据填报模版_' + rpYear + '年' + rpMonth + '月.xlsx');
}

/** 拆 CSV 文本为二维数组（处理引号包裹、引号转义、\r\n） */
function rpParseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 把 0/1/2 这类列号或单元格值统一成去空白的字符串 */
function rpCellText(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * 找表头行在第几行（0 起算）。
 * 新导出的模版第 1 行是「填报说明」，表头在第 2 行；说明行之前导出的老文件表头就在第 1 行。
 * 以第一列是不是「报送生产线信息」来判断，前 5 行里找不到就按第 1 行当表头（跟以前行为一致）。
 */
function rpFindHeadRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    if (rpCellText((rows[r] || [])[0]) === RP_XLSX_HEAD[0]) return r;
  }
  return 0;
}

/**
 * 导入一份二维表格（表头 + 数据行）。
 * 只认「生产线 / 标签 / 物料 / 参数」四个名称都对得上的行，对不上的跳过并计数，
 * 避免用户改了配置后导入旧文件时把数据写到错行上。
 */
function rpImportRows(rows) {
  // 一行都没有：文件是空的，或者根本不是 Excel / CSV（SheetJS 读不出东西时也走这里）
  if (!rows || !rows.length) {
    return { ok: false, message: '文件里没有内容，或不是有效的 Excel / CSV 文件' };
  }

  // 表头行位置靠探测，不假定就是第 1 行（可能上面还有一行填报说明）
  const headRow = rpFindHeadRow(rows);
  if (rows.length < headRow + 2) {
    return { ok: false, message: '文件里只有表头，没有可导入的数据行' };
  }

  // 表头行不参与导入（不校验列名，允许用户先在 Excel 里调整内容）
  let applied = 0;
  let skipped = 0;
  let dataRows = 0;

  for (let r = headRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    if (row.every(function (c) { return !rpCellText(c); })) continue;
    dataRows++;

    const entity = rpCellText(row[0]);
    const tag = rpCellText(row[1]);
    const matName = rpCellText(row[2]);
    const paramName = rpCellText(row[3]);
    const value = rpCellText(row[5]);
    const remark = rpCellText(row[6]);

    const mats = rcMatsOf(rpConfig, tag);
    const mi = mats.findIndex(function (m) { return rpCellText(m.material) === matName; });
    const pi = mi >= 0
      ? (mats[mi].params || []).findIndex(function (p) { return rpCellText(p.name) === paramName; })
      : -1;

    const known = rpConfig.lines.indexOf(entity) >= 0 && rpConfig.tags.indexOf(tag) >= 0 && mi >= 0 && pi >= 0;
    if (!known) { skipped++; continue; }

    const key = rpKey(entity, tag);
    if (!RP_VALUES[key]) RP_VALUES[key] = {};
    RP_VALUES[key][mi + ':' + pi] = { value: value, remark: remark };
    RP_SEEDED[key] = true;   // 这一行以导入的为准，别再被预填值盖掉
    applied++;
  }

  if (!dataRows) return { ok: false, message: '文件里没有可导入的数据行' };
  return { ok: applied > 0, applied: applied, skipped: skipped };
}

/** 从文件里读出二维表格：Excel 走 SheetJS，csv 走文本解析 */
function rpReadTable(file, cb) {
  const reader = new FileReader();

  reader.onload = function () {
    try {
      if (/\.csv$/i.test(file.name)) {
        cb(rpParseCsv(String(reader.result).replace(/^\ufeff/, '')), null);
        return;
      }
      const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      cb(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }), null);
    } catch (e) {
      cb(null, '文件解析失败，请使用导出得到的 Excel 文件');
    }
  };

  reader.onerror = function () { cb(null, '文件读取失败'); };

  if (/\.csv$/i.test(file.name)) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function bindTransferEvents() {
  document.getElementById('rp-export').addEventListener('click', function () {
    rpExportXlsx();
    toast('已导出 Excel 模版，填好后可直接导入');
  });

  const file = document.getElementById('rp-file');
  document.getElementById('rp-import').addEventListener('click', function () {
    file.value = '';   // 同一个文件连选两次也要能触发 change
    file.click();
  });

  file.addEventListener('change', function () {
    const f = file.files && file.files[0];
    if (!f) return;

    rpReadTable(f, function (rows, err) {
      if (err) { toast(err); return; }
      const res = rpImportRows(rows);
      if (!res.ok) {
        // 一行都没认出来时，多半是配置改了 / 文件不是本页导出的，说清是哪一种
        if (res.skipped && !res.applied) toast('导入失败：' + res.skipped + ' 行与当前配置对不上，请先确认填报项配置');
        else toast(res.message || '导入失败');
        return;
      }
      renderReportBody();
      toast('已导入 ' + res.applied + ' 行' + (res.skipped ? '，跳过 ' + res.skipped + ' 行' : ''));
    });
  });
}

function syncReportTitle() {
  const text = rpYear + '年' + rpMonth + '月数据填报';
  document.getElementById('rp-title').textContent = text;
  // 本页属「碳排放管理」模块（全屏子页不带平台壳，标题里仍要体现归属）
  document.title = text + ' · ' + moduleName('carbon');
}

/* ---------- 初始化 ---------- */

function initMonthReportPage() {
  rpYear = Number(rpQuery('year')) || rpYear;
  rpMonth = Number(rpQuery('month')) || rpMonth;

  // 按配置生成页签与表格
  rpConfig = rcLoadConfig();

  // 该月已有数据（重新填报 / 再次进入已填过的月份）→ 先把值灌进来
  rpLoadSaved(rdDataFor(rpYear, rpMonth, rpConfig));

  // 配置为空时给个兜底，避免整页空白
  if (!rpConfig.lines.length || !rpConfig.tags.length) {
    rpEntity = rpConfig.lines[0] || '';
    rpTab = rpConfig.tags[0] || '';
    syncReportTitle();
    renderReportEntities();
    renderReportTabs();
    document.getElementById('rp-table').innerHTML =
      '<tbody><tr><td class="rp-empty">还没有在「填报项配置」中选择报送生产线与行业填报标签</td></tr></tbody>';
    bindHeaderEvents();
    return;
  }

  rpEntity = rpConfig.lines[0];
  rpTab = rpConfig.tags[0];

  syncReportTitle();
  renderReportEntities();
  renderReportTabs();
  renderReportBody();
  bindReportEvents();
  bindHeaderEvents();
}

if (document.querySelector('.report-page')) initMonthReportPage();
