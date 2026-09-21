/**
 * 手工数据填报v2 —— 碳排放管理 > 业务界面 > 手工数据填报v2
 *
 * 与 v1（manual-entry.html 的 12 个月卡看板）是**两条独立的线**：
 *   v1 = 月度存证视角：首页只回答「哪个月没填」→ 进去按「主体 × 页签」填一整张表
 *   v2 = 数据台账视角：一行一个参数项，带 查询 / 编辑 / 删除 / 模版下载 / 导入
 * 两者各存各的 localStorage 键，互不干扰（改这里不会影响 v1 的月卡与详情页）。
 *
 * 页面结构：
 *   查询条件（年份 / 月份）
 *   列表（年份 / 月份 / 报送生产线信息 / 行业填报标签 / 物料名称 / 参数名称 / 单位 / 填报值 + 操作）
 *   列表右上角：期初库存时间配置 / 模版下载 / 导入
 *
 * 数据来源：
 *   js/report-config-store.js 的 rcLoadConfig() —— 匹配物料 / 参数 / 单位口径（与 v1 同源）
 *   vendor/xlsx.full.min.js 的 XLSX —— 模版下载与导入
 *
 * 「填报项配置」是 v1 的页面，v2 只**只读**引用它的口径（物料、参数名、单位下拉的候选清单），
 * 不做配置入口 —— 避免两条线各有各的配置、改一处漏一处。
 */

/* ---------- 常量 ---------- */

/** 行数据存储键（与 v1 的 emission-mgmt-report-data-v1 完全分开） */
const MV2_ROW_KEY = 'emission-mgmt-manual-v2-rows-v1';

/** 期初库存时间存储键 */
const MV2_TIME_KEY = 'emission-mgmt-manual-v2-opening-time-v1';

/**
 * 期初库存时间的默认值（没配置过时用它）。只到「年-月」，不到日 / 时 / 分。
 *
 * 它同时是**「期初库存量」的可编辑基准月**：只有落在这一月的「期初库存量」行才允许手工改，
 * 其余月份的期初库存量都是按这个时间点派生出来的，不给改（见 mv2CanEdit）。
 */
const MV2_TIME_DEFAULT = '2024-01';

/** 每页条数（翻页用）；可选档位见 MV2_PAGE_SIZES */
const MV2_PAGE_SIZE_DEFAULT = 10;
const MV2_PAGE_SIZES = [10, 20, 50];

/** 演示数据涉及的月份（按时间正序；列表也按这个顺序展示，见 mv2FilteredRows） */
const MV2_DEMO_MONTHS = [
  { year: 2026, month: 8 },
  { year: 2026, month: 9 },
];

/** 演示数据里的物料顺序（也是列表里同月内的行序） */
const MV2_DEMO_MATERIALS = ['无烟煤', '烟煤', '洗精煤', '焦炭'];

/**
 * 演示数据的**唯一事实来源**：每月各物料的「期末库存量」。
 * 值顺序与 MV2_DEMO_MATERIALS 对齐。9 月那行的数字是需求里给的原始值，别改。
 */
const MV2_SEED_CLOSE = [
  ['980.00', '1860.00', '2450.00', '3250.00'],   // 8 月期末
  ['1000', '1700.00', '2500', '3400'],           // 9 月期末
];

/** 首月（8 月）没有上一月可承接，它的期初值单独给 */
const MV2_SEED_OPEN_FIRST = ['920.00', '1780.00', '2360.00', '3120.00'];

/**
 * 演示数据：4 个物料 × 2 个参数 × 2 个月 = 16 行。
 *
 * **期初/期末的承接关系是「算出来」的，不是手抄的**：
 *   期初(N月) = 期末(N-1月)；首月的期初取 MV2_SEED_OPEN_FIRST。
 * 这样只要改 MV2_SEED_CLOSE，两个月就永远不会对不上账
 * （手抄两份数字迟早会出现「9 月期初 ≠ 8 月期末」这种自相矛盾）。
 */
function mv2DefaultRows() {
  const rows = [];
  MV2_DEMO_MONTHS.forEach(function (m, i) {
    MV2_DEMO_MATERIALS.forEach(function (mat, k) {
      const open = i === 0 ? MV2_SEED_OPEN_FIRST[k] : MV2_SEED_CLOSE[i - 1][k];
      rows.push({
        year: m.year, month: m.month,
        line: '全厂', tag: '化石燃料',
        material: mat, param: MV2_OPENING_PARAM, unit: 't', value: open,
      });
      rows.push({
        year: m.year, month: m.month,
        line: '全厂', tag: '化石燃料',
        material: mat, param: '期末库存量', unit: 't', value: MV2_SEED_CLOSE[i][k],
      });
    });
  });
  return rows;
}

/* ---------- 行数据读写 ---------- */

let mv2Config = null;
let mv2Rows = [];
let mv2EditingKey = '';

/** 一行的唯一键：六个定位字段拼起来，用来做去重与导入匹配 */
function mv2KeyOf(r) {
  return [r.year, r.month, r.line, r.tag, r.material, r.param].join('|');
}

/**
 * 读全部行。没存过就播种演示数据（并落库）。
 * 存过就一律以存过的为准 —— 哪怕用户把行删光了，也不能自己长回来。
 */
function mv2Load() {
  try {
    const raw = localStorage.getItem(MV2_ROW_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) { /* 存储损坏就当没有，回落到演示数据 */ }

  const seed = mv2DefaultRows();
  mv2Save(seed);
  return seed;
}

function mv2Save(rows) {
  try {
    localStorage.setItem(MV2_ROW_KEY, JSON.stringify(rows == null ? mv2Rows : rows));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- 期初库存时间读写 ---------- */

/**
 * 把存进来的值归一成 `YYYY-MM`。
 * 期初库存时间**只到年月**（不到日 / 时 / 分），所以：
 *   '2026-09'            → '2026-09'（本月度选择器给的格式）
 *   '2026-09-01T00:00'   → '2026-09'（早期用 datetime-local 时留下的旧格式，不能让它把输入框撑坏）
 *   '2026-9'             → '2026-09'
 * 认不出来的一律回落到默认值，别让脏数据流进 `input[type=month]`（它只认 YYYY-MM）。
 */
function mv2NormMonth(v) {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(v == null ? '' : v).trim());
  if (!m) return MV2_TIME_DEFAULT;
  const mm = Number(m[2]);
  if (!mm || mm > 12) return MV2_TIME_DEFAULT;
  return m[1] + '-' + (mm < 10 ? '0' : '') + mm;
}

function mv2LoadTime() {
  try {
    const v = localStorage.getItem(MV2_TIME_KEY);
    if (v) return mv2NormMonth(v);
  } catch (e) { /* ignore */ }
  return MV2_TIME_DEFAULT;
}

function mv2SaveTime(v) {
  try {
    localStorage.setItem(MV2_TIME_KEY, v);
    return true;
  } catch (e) {
    return false;
  }
}

/** '2026-09' → '2026年9月'（给人看） */
function mv2TimeText(v) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(mv2NormMonth(v));
  return m ? m[1] + '年' + Number(m[2]) + '月' : String(v || '');
}

/* ---------- 查询条件 ---------- */

/**
 * 三个查询条件都是**可清空**的：选「全部」=> value 为空串 => 返回 null => 不按该条件过滤。
 * 所以三个都是 null 时就是「全部数据」。
 */
function mv2QueryValue(id) {
  const v = document.getElementById(id).value;
  return v === '' || v == null ? null : v;
}

function mv2QueryYear() {
  const v = mv2QueryValue('mv2-year');
  return v === null ? null : Number(v);
}

function mv2QueryMonth() {
  const v = mv2QueryValue('mv2-month');
  return v === null ? null : Number(v);
}

function mv2QueryMaterial() {
  return mv2QueryValue('mv2-material');
}

/** 查询条件的中文描述（空态文案 / 导出文件名 / 查询 toast 共用） */
function mv2QueryLabel() {
  const y = mv2QueryYear();
  const m = mv2QueryMonth();
  const mat = mv2QueryMaterial();
  const parts = [];
  if (y !== null) parts.push(y + '年');
  if (m !== null) parts.push(m + '月');
  if (mat) parts.push(mat);
  return parts.length ? parts.join('') : '全部数据';
}

/**
 * 当前查询条件下要显示的行。
 * **保持存储顺序**（不排序）—— 顺序就是数据本来的顺序。演示数据按月份正序播种
 * （8 月 → 9 月），所以「8 月期末」正好紧挨着「9 月期初」，一眼就能核对
 * 「本月期初 = 上月期末」这条承接关系；按名称排会变成 无烟煤 → 洗精煤 → 烟煤 → 焦炭
 * （中文按码点排），看着像乱序。导入补进来的新行追加在末尾。
 */
function mv2FilteredRows() {
  const y = mv2QueryYear();
  const m = mv2QueryMonth();
  const mat = mv2QueryMaterial();
  return mv2Rows.filter(function (r) {
    if (y !== null && Number(r.year) !== y) return false;
    if (m !== null && Number(r.month) !== m) return false;
    if (mat !== null && r.material !== mat) return false;
    return true;
  });
}

/* ---------- 翻页 ---------- */

/** 当前页码（1 起）与每页条数 */
let mv2Page = 1;
let mv2PageSize = MV2_PAGE_SIZE_DEFAULT;

function mv2PageCount(total) {
  return Math.max(1, Math.ceil(total / mv2PageSize));
}

/**
 * 夹住页码。查询条件变化、删除行之后都要过一遍 ——
 * 否则会出现「当前在第 3 页，筛选后只剩 1 页」从而渲染出空白列表。
 */
function mv2ClampPage(total) {
  const max = mv2PageCount(total);
  if (mv2Page > max) mv2Page = max;
  if (mv2Page < 1) mv2Page = 1;
  return mv2Page;
}

/** 当前页要显示的行 */
function mv2PagedRows(list) {
  const start = (mv2ClampPage(list.length) - 1) * mv2PageSize;
  return list.slice(start, start + mv2PageSize);
}

/**
 * 页码序列，超过 7 页时折叠成 1 … 4 5 6 … 20。
 * 返回数字或 '…'。
 */
function mv2PageNumbers(cur, total) {
  if (total <= 7) {
    const all = [];
    for (let i = 1; i <= total; i++) all.push(i);
    return all;
  }
  const out = [1];
  const lo = Math.max(2, cur - 1);
  const hi = Math.min(total - 1, cur + 1);
  if (lo > 2) out.push('…');
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < total - 1) out.push('…');
  out.push(total);
  return out;
}

function mv2RenderPager(total) {
  const box = document.getElementById('mv2-pager');
  if (!box) return;

  // 没有数据时不显示翻页条
  if (!total) { box.innerHTML = ''; return; }

  const pages = mv2PageCount(total);
  const cur = mv2ClampPage(total);

  const nums = mv2PageNumbers(cur, pages).map(function (n) {
    if (n === '…') return '<span class="mv2-page-gap">…</span>';
    return '<button type="button" class="mv2-page-btn' + (n === cur ? ' is-active' : '') + '"'
      + ' data-page="' + n + '">' + n + '</button>';
  }).join('');

  const sizes = MV2_PAGE_SIZES.map(function (n) {
    return '<option value="' + n + '"' + (n === mv2PageSize ? ' selected' : '') + '>' + n + ' 条/页</option>';
  }).join('');

  box.innerHTML =
    '<span class="mv2-page-total">共 ' + total + ' 条</span>'
    + '<select class="mv2-page-size" id="mv2-page-size">' + sizes + '</select>'
    + '<div class="mv2-page-nav">'
    + '<button type="button" class="mv2-page-btn mv2-page-prev"' + (cur <= 1 ? ' disabled' : '')
    + ' data-page="' + (cur - 1) + '">‹</button>'
    + nums
    + '<button type="button" class="mv2-page-btn mv2-page-next"' + (cur >= pages ? ' disabled' : '')
    + ' data-page="' + (cur + 1) + '">›</button>'
    + '</div>';
}

/* ---------- 可编辑性判定 ---------- */

/** 「期初库存量」这个参数名在多处要用到（判定 / 种子数据），提出来免得散落魔术字符串 */
const MV2_OPENING_PARAM = '期初库存量';

/** 行的 year / month → 'YYYY-MM'（补零，好和期初库存时间配置的值直接比） */
function mv2MonthKeyOf(r) {
  const mm = Number(r.month);
  return r.year + '-' + (mm < 10 ? '0' : '') + mm;
}

/**
 * 这一行能不能编辑。
 *
 * 规则：「期初库存量」**只有落在基准月**（= 期初库存时间配置的那个月）的行才允许手工改；
 * 其他月份的期初库存量都是按该时间点派生出来的，改了会和基准打架，所以不给编辑入口。
 * 「期末库存量」不受限制 —— 它本来就是每月人工填的。
 *
 * 基准月是跟着「期初库存时间配置」走的，不是写死 2024-01：
 * 配置改到 2025-06，可编辑的就是 2025-06 的期初库存量。
 */
function mv2CanEdit(r) {
  if (r.param !== MV2_OPENING_PARAM) return true;
  return mv2MonthKeyOf(r) === mv2LoadTime();
}

/* ---------- 渲染 ---------- */

function mv2RenderTable() {
  const tbody = document.getElementById('mv2-tbody');
  const list = mv2FilteredRows();

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="mv2-empty">'
      + '「' + mv2QueryLabel() + '」下没有填报数据，可点右上角「导入」还原模版数据'
      + '</td></tr>';
    mv2RenderPager(0);
    return;
  }

  tbody.innerHTML = mv2PagedRows(list).map(function (r) {
    const key = mv2KeyOf(r);
    return '<tr data-key="' + rcEsc(key) + '">'
      + '<td class="is-num">' + rcEsc(r.year) + '</td>'
      + '<td class="is-num">' + rcEsc(r.month) + '</td>'
      + '<td>' + rcEsc(r.line) + '</td>'
      + '<td>' + rcEsc(r.tag) + '</td>'
      + '<td>' + rcEsc(r.material) + '</td>'
      + '<td>' + rcEsc(r.param) + '</td>'
      + '<td>' + rcEsc(r.unit) + '</td>'
      + '<td class="mv2-value">' + rcEsc(r.value) + '</td>'
      + '<td class="mv2-act">'
      // 不可编辑的行**只藏编辑按钮**，删除照旧可用
      // （按需求原话「隐藏编辑按钮即可」，不做成整行禁用）
      + (mv2CanEdit(r) ? '<button type="button" class="rc-link mv2-edit">编辑</button>' : '')
      + '<button type="button" class="rc-link rc-link-danger mv2-del">删除</button>'
      + '</td>'
      + '</tr>';
  }).join('');

  mv2RenderPager(list.length);
}

function mv2RenderAll() {
  mv2RenderTable();
}

/* ---------- 编辑弹窗 ---------- */

function mv2OpenEdit(key) {
  const r = mv2Rows.filter(function (x) { return mv2KeyOf(x) === key; })[0];
  if (!r) { toast('这一行已经不存在了'); return; }
  if (!mv2CanEdit(r)) { toast('该行不允许编辑'); return; }   // 按钮已藏，这里兜一道

  mv2EditingKey = key;

  // 弹窗里**只留「填报值」一个输入框**：其余列均不可修改（与导出模版顶部那句说明一致）。
  // 也不再给年份 / 月份下拉 —— 改年月相当于把整行搬到另一个月份，口径上说不通。
  document.getElementById('mv2-edit-form').innerHTML =
    '<div class="mv2-field"><label for="mv2-edit-value">填报值</label>'
    + '<input type="text" id="mv2-edit-value" value="' + rcEsc(r.value) + '" placeholder="请输入" /></div>';

  openModal('mv2-edit-modal');
  document.getElementById('mv2-edit-value').focus();
}

function mv2ApplyEdit() {
  const r = mv2Rows.filter(function (x) { return mv2KeyOf(x) === mv2EditingKey; })[0];
  if (!r) { closeModal('mv2-edit-modal'); toast('这一行已经不存在了'); return; }

  r.value = document.getElementById('mv2-edit-value').value.trim();

  if (!mv2Save()) { toast('保存失败：浏览器存储不可用'); return; }
  closeModal('mv2-edit-modal');
  mv2RenderTable();
  toast('已保存');
}

/* ---------- 删除 ---------- */

/** 待删除行的键（确认弹窗点「删除」时用它） */
let mv2DeletingKey = '';

function mv2Delete(key) {
  const r = mv2Rows.filter(function (x) { return mv2KeyOf(x) === key; })[0];
  if (!r) return;

  // 删除是不可逆的（要还原得靠「模版下载 → 原样导入」把行补回来），所以先确认一次。
  // 用自绘弹窗而不是 window.confirm：原生对话框和页面风格不一致，演示时很突兀。
  mv2DeletingKey = key;
  document.getElementById('mv2-confirm-text').textContent =
    '确定删除「' + r.material + ' - ' + r.param + '」(' + r.year + '年' + r.month + '月) 这一行吗？';
  document.getElementById('mv2-confirm-close').focus();
  openModal('mv2-confirm-modal');
}

function mv2ApplyDelete() {
  const key = mv2DeletingKey;
  mv2DeletingKey = '';
  closeModal('mv2-confirm-modal');

  if (!key) return;
  const before = mv2Rows.length;
  mv2Rows = mv2Rows.filter(function (x) { return mv2KeyOf(x) !== key; });
  if (mv2Rows.length === before) return;   // 没删掉（比如重复点了）

  mv2Save();
  // 删的是当前页最后一条时，这一页会空掉 —— mv2RenderTable 内部会夹住页码自动回退一页
  mv2RenderTable();
  toast('已删除');
}

/* ---------- 期初库存时间配置 ---------- */

function mv2OpenTimeModal() {
  // input[type=month] 只认 YYYY-MM，所以先过一遍归一化
  document.getElementById('mv2-time-input').value = mv2LoadTime();
  openModal('mv2-time-modal');
}

function mv2ApplyTime() {
  const v = document.getElementById('mv2-time-input').value;
  if (!v) { toast('请选择期初库存时间'); return; }
  if (!mv2SaveTime(v)) { toast('保存失败：浏览器存储不可用'); return; }
  mv2SyncTimeTitle();
  // 期初库存时间就是「期初库存量」的可编辑基准月（见 mv2CanEdit），
  // 所以配置一改，列表里哪些行带编辑按钮就跟着变 —— 必须重渲染，否则列表停留在旧状态。
  mv2RenderTable();
  closeModal('mv2-time-modal');
  toast('期初库存时间已更新为 ' + mv2TimeText(v));
}

/** 把当前设置写进按钮的 title，鼠标悬停就能看到，不用为它单开一块展示位 */
function mv2SyncTimeTitle() {
  const btn = document.getElementById('mv2-opening-time');
  if (btn) btn.title = '当前：' + mv2TimeText(mv2LoadTime());
}

/* ============================================================
 * 模版下载 / 导入
 * ------------------------------------------------------------
 * 导出为 **Excel（.xlsx）**，列结构与列表一致（去掉「操作」列）：
 *   第 1 行：填报说明（跨 8 列合并，红字）——只给人看，导入时自动跳过
 *   第 2 行：年份,月份,报送生产线信息,行业填报标签,物料名称,参数名称,单位,填报值
 *   第 3 行起：当前查询条件下的数据行（人工一般只改「填报值」）
 * 导入 = 按「年份 / 月份 / 生产线 / 标签 / 物料 / 参数」六个字段定位：
 *          列表里已有该行 → 更新填报值与单位；
 *          列表里没有、但六个字段都合规（物料 / 参数在配置清单里）→ 作为新行补进来，
 *            所以「下载模版 → 原样导入」也是把误删的行还原回来的办法；
 *          字段不全或在清单外 → 跳过并计数，避免把不相干的行写进来。
 *        表头行位置是**探测**出来的（认第一列的「年份」），带不带说明行都能导。
 * ============================================================ */

const MV2_XLSX_HEAD = ['年份', '月份', '报送生产线信息', '行业填报标签', '物料名称', '参数名称', '单位', '填报值'];

const MV2_XLSX_NOTE = '填报说明：除填报值列，需人工填写外，其他列均不可修改！';
const MV2_XLSX_NOTE_HPT = 22;

/** 当前查询条件下的导出二维数组（第 0 行是表头） */
function mv2BuildRows() {
  const rows = [MV2_XLSX_HEAD.slice()];
  mv2FilteredRows().forEach(function (r) {
    rows.push([r.year, r.month, r.line, r.tag, r.material, r.param, r.unit, r.value]);
  });
  return rows;
}

function mv2ExportXlsx() {
  if (!mv2FilteredRows().length) {
    toast('当前条件下没有数据可下载');
    return;
  }

  const rows = [[MV2_XLSX_NOTE]].concat(mv2BuildRows());
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [
    { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 16 },
    { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 14 },
  ];

  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: MV2_XLSX_HEAD.length - 1 } }];
  ws['!rows'] = [{ hpt: MV2_XLSX_NOTE_HPT }];
  if (ws['A1']) {
    ws['A1'].s = {
      font: { color: { rgb: 'FFFF0000' }, bold: true },
      alignment: { horizontal: 'left', vertical: 'center' },
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '手工数据填报');
  XLSX.writeFile(wb, '手工数据填报模版_' + mv2QueryLabel() + '.xlsx');
}

/** 拆 CSV 文本为二维数组（处理引号包裹、引号转义、\r\n） */
function mv2ParseCsv(text) {
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

function mv2CellText(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * 找表头行在第几行（0 起算）：认第一列是不是「年份」。
 * 前 5 行找不到返回 **-1**（注意不是回落到 0）—— 调用方据此判断「这文件不是本页导出的模版」。
 *
 * 为什么非要认出来：损坏的二进制文件被 SheetJS 硬解出来时，会得到一堆乱七八糟的行，
 * 若此时回落到「第 1 行就是表头」，这些垃圾行会被逐行判为「物料 / 参数对不上」，
 * 提示成「N 行与配置对不上」—— 用户明明传的是坏文件，却被告诉是配置问题，完全误导。
 */
function mv2FindHeadRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    if (mv2CellText((rows[r] || [])[0]) === MV2_XLSX_HEAD[0]) return r;
  }
  return -1;
}

function mv2ImportRows(rows) {
  if (!rows || !rows.length) {
    return { ok: false, message: '文件里没有内容，或不是有效的 Excel / CSV 文件' };
  }

  const headRow = mv2FindHeadRow(rows);
  if (headRow < 0) {
    return { ok: false, message: '这不是本页导出的模版文件，请先用「模版下载」拿到正确格式' };
  }
  if (rows.length < headRow + 2) {
    return { ok: false, message: '文件里只有表头，没有可导入的数据行' };
  }

  const index = {};
  mv2Rows.forEach(function (r) { index[mv2KeyOf(r)] = r; });

  let updated = 0;
  let added = 0;
  let skipped = 0;
  let dataRows = 0;

  for (let r = headRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    if (row.every(function (c) { return !mv2CellText(c); })) continue;
    dataRows++;

    const row2 = {
      year: Number(mv2CellText(row[0])),
      month: Number(mv2CellText(row[1])),
      line: mv2CellText(row[2]),
      tag: mv2CellText(row[3]),
      material: mv2CellText(row[4]),
      param: mv2CellText(row[5]),
      unit: mv2CellText(row[6]),
      value: mv2CellText(row[7]),
    };

    // 六个定位字段都要合规，否则这行不知道往哪落
    const known = row2.year && row2.month
      && RC_LINES.indexOf(row2.line) >= 0
      && RC_TAGS.indexOf(row2.tag) >= 0
      && RC_MATERIALS.indexOf(row2.material) >= 0
      && RC_PARAM_NAMES.indexOf(row2.param) >= 0;
    if (!known) { skipped++; continue; }

    const key = mv2KeyOf(row2);
    const exist = index[key];
    if (exist) {
      exist.value = row2.value;
      exist.unit = row2.unit || exist.unit;
      updated++;
    } else {
      mv2Rows.push(row2);
      index[key] = row2;
      added++;
    }
  }

  if (!dataRows) return { ok: false, message: '文件里没有可导入的数据行' };
  return { ok: updated + added > 0, updated: updated, added: added, skipped: skipped };
}

function mv2ReadTable(file, cb) {
  const reader = new FileReader();

  reader.onload = function () {
    try {
      if (/\.csv$/i.test(file.name)) {
        cb(mv2ParseCsv(String(reader.result).replace(/^\ufeff/, '')), null);
        return;
      }
      const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      cb(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }), null);
    } catch (e) {
      cb(null, '文件解析失败，请使用模版下载得到的 Excel 文件');
    }
  };

  reader.onerror = function () { cb(null, '文件读取失败'); };

  if (/\.csv$/i.test(file.name)) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

/* ---------- 事件 ---------- */

function bindMv2Events() {
  document.getElementById('mv2-search').addEventListener('click', function () {
    mv2Page = 1;                     // 换了查询条件必须回到第 1 页，否则可能停在一个空页上
    mv2RenderTable();
    toast('已查询「' + mv2QueryLabel() + '」，共 ' + mv2FilteredRows().length + ' 条');
  });

  // 清空查询条件 = 看全部数据
  document.getElementById('mv2-reset').addEventListener('click', function () {
    document.getElementById('mv2-year').value = '';
    document.getElementById('mv2-month').value = '';
    document.getElementById('mv2-material').value = '';
    mv2Page = 1;
    mv2RenderTable();
    toast('已重置为全部数据');
  });

  // 改了条件后按回车也能查（三个下拉都支持）
  ['mv2-year', 'mv2-month', 'mv2-material'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', function () {
      mv2Page = 1;
      mv2RenderTable();
    });
  });

  // 翻页：页码 / 上一页 / 下一页 / 每页条数
  document.getElementById('mv2-pager').addEventListener('click', function (e) {
    const btn = e.target.closest('.mv2-page-btn');
    if (!btn || btn.disabled) return;
    mv2Page = Number(btn.dataset.page) || 1;
    mv2RenderTable();
  });

  document.getElementById('mv2-pager').addEventListener('change', function (e) {
    if (e.target.id !== 'mv2-page-size') return;
    mv2PageSize = Number(e.target.value) || MV2_PAGE_SIZE_DEFAULT;
    mv2Page = 1;                     // 换了每页条数也回第 1 页，不然位置会乱跳
    mv2RenderTable();
  });

  // 列表：编辑 / 删除
  document.getElementById('mv2-tbody').addEventListener('click', function (e) {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    if (e.target.closest('.mv2-edit')) mv2OpenEdit(tr.dataset.key);
    else if (e.target.closest('.mv2-del')) mv2Delete(tr.dataset.key);
  });

  // 编辑弹窗
  document.getElementById('mv2-edit-ok').addEventListener('click', mv2ApplyEdit);
  document.getElementById('mv2-edit-cancel').addEventListener('click', function () { closeModal('mv2-edit-modal'); });
  document.getElementById('mv2-edit-close').addEventListener('click', function () { closeModal('mv2-edit-modal'); });

  // 期初库存时间配置
  document.getElementById('mv2-opening-time').addEventListener('click', mv2OpenTimeModal);
  document.getElementById('mv2-time-ok').addEventListener('click', mv2ApplyTime);
  document.getElementById('mv2-time-cancel').addEventListener('click', function () { closeModal('mv2-time-modal'); });
  document.getElementById('mv2-time-close').addEventListener('click', function () { closeModal('mv2-time-modal'); });

  // 模版下载
  document.getElementById('mv2-export').addEventListener('click', function () {
    mv2ExportXlsx();
    toast('模版已下载，填好填报值后可直接导入');
  });

  // 导入
  const file = document.getElementById('mv2-file');
  document.getElementById('mv2-import').addEventListener('click', function () {
    file.value = '';   // 同一个文件连选两次也要能触发 change
    file.click();
  });

  file.addEventListener('change', function () {
    const f = file.files && file.files[0];
    if (!f) return;

    mv2ReadTable(f, function (rows, err) {
      if (err) { toast(err); return; }
      const res = mv2ImportRows(rows);
      if (!res.ok) {
        if (res.skipped && !res.updated && !res.added) {
          toast('导入失败：' + res.skipped + ' 行的物料 / 参数等与配置对不上');
        } else {
          toast(res.message || '导入失败');
        }
        return;
      }
      mv2Save();
      mv2FillMaterialOptions();   // 导入可能带进新物料，下拉要跟着更新
      mv2RenderTable();
      const parts = [];
      if (res.updated) parts.push('更新 ' + res.updated + ' 行');
      if (res.added) parts.push('新增 ' + res.added + ' 行');
      if (res.skipped) parts.push('跳过 ' + res.skipped + ' 行');
      toast('已导入：' + parts.join('，'));
    });
  });

  // 删除确认弹窗
  document.getElementById('mv2-confirm-ok').addEventListener('click', mv2ApplyDelete);
  document.getElementById('mv2-confirm-cancel').addEventListener('click', function () {
    mv2DeletingKey = '';
    closeModal('mv2-confirm-modal');
  });
  document.getElementById('mv2-confirm-close').addEventListener('click', function () {
    mv2DeletingKey = '';
    closeModal('mv2-confirm-modal');
  });

  // 点遮罩关弹窗
  ['mv2-edit-modal', 'mv2-time-modal', 'mv2-confirm-modal'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target.id === id) {
        if (id === 'mv2-confirm-modal') mv2DeletingKey = '';
        closeModal(id);
      }
    });
  });
}

/* ---------- 初始化 ---------- */

/**
 * 填充「物料名称」下拉。
 * 候选取**当前数据里实际出现过的物料**（去重、保持出现顺序），而不是照搬配置层的全量清单 ——
 * 免得下拉里塞一堆查出来没数据的选项。导入可能带进新物料，所以导入后要重填一次。
 */
function mv2FillMaterialOptions() {
  const sel = document.getElementById('mv2-material');
  const keep = sel.value;
  const mats = [];
  mv2Rows.forEach(function (r) {
    if (mats.indexOf(r.material) < 0) mats.push(r.material);
  });
  sel.innerHTML = '<option value="">全部</option>'
    + mats.map(function (m) { return '<option value="' + rcEsc(m) + '">' + rcEsc(m) + '</option>'; }).join('');
  // 尽量保留用户已选的物料（导入前后不跳）
  sel.value = mats.indexOf(keep) >= 0 ? keep : '';
}

function initManualEntryV2Page() {
  initLayout('manual-entry-v2', { moduleId: 'carbon' });

  mv2Config = rcLoadConfig();
  mv2Rows = mv2Load();

  // 三个查询条件都带一个空值项「全部」，且**默认选中它** ——
  // 即一进页面看的就是全部数据（不按年 / 月 / 物料过滤），而不是某个固定月份。
  document.getElementById('mv2-year').innerHTML = yearOptions('', '全部');
  document.getElementById('mv2-month').innerHTML = monthOptions('', '全部');
  mv2FillMaterialOptions();

  mv2Page = 1;
  mv2SyncTimeTitle();
  mv2RenderAll();
  bindMv2Events();
}

if (document.querySelector('.app-shell')) initManualEntryV2Page();
