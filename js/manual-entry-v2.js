/**
 * 库存手工填报 —— 碳排放管理 > 业务界面 > 库存手工填报
 * （文件与模块 id 仍叫 v2 / manual-entry-v2，只有显示名改了：「手工数据填报v2」→「库存手工填报」）
 *
 * 与 v1（manual-entry.html 的 12 个月卡看板）是**两条独立的线**：
 *   v1 = 月度存证视角：首页只回答「哪个月没填」→ 进去按「主体 × 页签」填一整张表
 *   v2 = 数据台账视角：一行一个参数项，带 查询 / 编辑 / 删除 / 模版下载 / 导入
 * 两者各存各的 localStorage 键，互不干扰（改这里不会影响 v1 的月卡与详情页）。
 *
 * 页面结构：
 *   查询条件（年份 / 月份 / 物料名称）
 *   列表（年份 / 月份 / 报送生产线信息 / 行业填报标签 / 物料名称 / 参数名称 / 单位 / 填报值 + 操作）
 *   列表右上角：期初库存时间配置 / 物料配置 / 模版下载 / 导入
 *
 * 两个配置入口的作用范围（都不要想当然地扩大）：
 *   期初库存时间配置 → 决定**哪一月的「期初库存量」行可以手工编辑**（见 mv2CanEdit），
 *                      也决定**模版里哪个月要带「期初库存量」行**（见 mv2ExportParamsFor）
 *   物料配置（是否手工盘库）→ 只决定**模版下载带出哪些物料**（见 mv2BuildRows），
 *                              不影响列表内容、也不影响查询
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

/** 两个库存参数名（种子数据 / 可编辑性判定 / 模版生成共用，免得散落魔术字符串） */
const MV2_OPENING_PARAM = '期初库存量';
const MV2_CLOSING_PARAM = '期末库存量';

/** 物料配置存储键 */
const MV2_MATCFG_KEY = 'emission-mgmt-manual-v2-material-config-v1';

/**
 * 物料配置弹窗的候选清单：两个页签（化石燃料 / 原料）→ 各自的物料。
 * 数组顺序就是弹窗里的展示顺序（也是模版里同月各物料的排列顺序）。
 *
 * 「是否手工盘库」开关的作用范围**只有「模版下载」**：
 * 它决定下载的模版里带出哪些物料，不影响列表里已有的数据，也不影响「查询」。
 */
const MV2_MATCFG_TABS = [
  {
    tag: '化石燃料',
    materials: ['兰炭', '无烟煤', '烟煤', '能力平', '褐煤', '洗精煤', '其他洗煤', '煤矸石', '煤泥', '焦炭'],
  },
  {
    tag: '原料',
    materials: ['钼铁合金', '镍铁', '废钢', '直接还原铁', '生铁', '电极', '白云石', '石灰石'],
  },
];

/** 物料配置的候选物料全量（去重，保持页签顺序） */
function mv2MatCfgMaterials() {
  const out = [];
  MV2_MATCFG_TABS.forEach(function (t) {
    t.materials.forEach(function (m) { if (out.indexOf(m) < 0) out.push(m); });
  });
  return out;
}

/**
 * 导入校验用的「已知物料」= 填报项配置的物料清单 ∪ 物料配置的候选物料。
 *
 * 为什么不能只用 RC_MATERIALS：物料配置里新加的物料（石灰石、钼铁合金…）不在填报项配置清单里，
 * 若只认 RC_MATERIALS，模版里这些行导入时会被判成「物料对不上配置」而整行跳过 ——
 * 用户明明填的是本页导出的模版，却被告知格式不对。
 */
const MV2_KNOWN_MATERIALS = RC_MATERIALS.concat(
  mv2MatCfgMaterials().filter(function (m) { return RC_MATERIALS.indexOf(m) < 0; })
);

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
        material: mat, param: MV2_CLOSING_PARAM, unit: 't', value: MV2_SEED_CLOSE[i][k],
      });
    });
  });
  return rows;
}

/* ---------- 行数据读写 ---------- */

let mv2Config = null;
let mv2Rows = [];
let mv2EditingKey = '';

/**
 * 物料配置（`{ 页签: [开关为开的物料] }`）。默认全关，初始化时从存储覆盖，见 initManualEntryV2Page。
 * 它只影响「模版下载」带出哪些物料，不参与列表过滤。
 */
let mv2MatCfg = mv2DefaultMatCfg();

/** 弹窗里正在编辑的草稿：点「保存」才落库，取消 / 关窗直接丢弃（改动不会半途生效） */
let mv2MatCfgDraft = null;

/** 弹窗当前选中的页签 */
let mv2MatCfgTab = '';

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
 * 认不出来的一律回落到默认值：`mv2TimeParts()` 的正则指望它把值压成 `YYYY-MM`，
 * 兜不住的话脏数据会一路漏到「年份 / 月份」两个下拉的回填上。
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

/**
 * 期初库存时间 → `{ year, month }`，给「年份 / 月份」两个下拉回填用。
 *
 * 借 `mv2NormMonth()` 兜底：它认不出格式时**一定**返回 `MV2_TIME_DEFAULT`，
 * 所以这里的正则必定命中，不用再写一条回落分支
 * ——（历史值可能是早期 `datetime-local` 留下的 `2026-09-01T00:00`）。
 */
function mv2TimeParts(v) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(mv2NormMonth(v));
  return { year: Number(m[1]), month: Number(m[2]) };
}

/* ---------- 物料配置读写 ---------- */

/**
 * 物料配置的形状：`{ '化石燃料': ['无烟煤', ...], '原料': [...] }`
 * —— 每个页签对应一个数组，数组里就是该页签下「是否手工盘库」开关**为开**的物料。
 *
 * 默认**全部关闭**：由用户按需打开（不预设任何物料，避免默认值和用户预期不一致）。
 */
function mv2DefaultMatCfg() {
  const cfg = {};
  MV2_MATCFG_TABS.forEach(function (t) { cfg[t.tag] = []; });
  return cfg;
}

/**
 * 整理成规范形状。只保留**清单里真实存在**的物料 ——
 * 存储里的脏数据（清单改过之后遗留的旧物料名、手改过的值）一律丢掉，
 * 免得模版里凭空多出配置界面上根本看不到的物料。
 */
function mv2NormMatCfg(raw) {
  const cfg = mv2DefaultMatCfg();
  if (!raw || typeof raw !== 'object') return cfg;
  MV2_MATCFG_TABS.forEach(function (t) {
    const list = raw[t.tag];
    if (!Array.isArray(list)) return;
    cfg[t.tag] = t.materials.filter(function (m) { return list.indexOf(m) >= 0; });
  });
  return cfg;
}

function mv2LoadMatCfg() {
  try {
    const raw = localStorage.getItem(MV2_MATCFG_KEY);
    if (raw) return mv2NormMatCfg(JSON.parse(raw));
  } catch (e) { /* 存储损坏就当没配过，回落默认（全关） */ }
  return mv2DefaultMatCfg();
}

function mv2SaveMatCfg(cfg) {
  try {
    localStorage.setItem(MV2_MATCFG_KEY, JSON.stringify(mv2NormMatCfg(cfg)));
    return true;
  } catch (e) {
    return false;
  }
}

/** 某物料在给定配置下「是否手工盘库」是不是开着的 */
function mv2IsMatOn(tag, mat, cfg) {
  return (((cfg || mv2MatCfg) || {})[tag] || []).indexOf(mat) >= 0;
}

/** 开关为开的物料总数（按钮 title / 保存提示用） */
function mv2MatOnCount(cfg) {
  const c = cfg || mv2MatCfg;
  return MV2_MATCFG_TABS.reduce(function (n, t) {
    return n + (((c || {})[t.tag] || []).length);
  }, 0);
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
  // 年月两个下拉，与「模版下载」弹窗同一套（yearOptions / monthOptions）
  const ym = mv2TimeParts(mv2LoadTime());
  document.getElementById('mv2-time-year').innerHTML = yearOptions(ym.year);
  document.getElementById('mv2-time-month').innerHTML = monthOptions(ym.month);
  openModal('mv2-time-modal');
}

function mv2ApplyTime() {
  const year = Number(document.getElementById('mv2-time-year').value);
  const month = Number(document.getElementById('mv2-time-month').value);
  if (!year || !month) { toast('请选择年份和月份'); return; }

  const v = year + '-' + (month < 10 ? '0' : '') + month;
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

/* ---------- 物料配置弹窗 ---------- */

/** 深拷贝一份配置当草稿（浅拷贝会让「取消」也把改动带出去） */
function mv2CloneMatCfg(cfg) {
  const out = {};
  MV2_MATCFG_TABS.forEach(function (t) {
    out[t.tag] = ((cfg || {})[t.tag] || []).slice();
  });
  return out;
}

function mv2RenderMatCfgTabs() {
  const box = document.getElementById('mv2-matcfg-tabs');
  if (!box) return;
  box.innerHTML = MV2_MATCFG_TABS.map(function (t) {
    return '<button type="button" class="status-tab' + (t.tag === mv2MatCfgTab ? ' active' : '') + '"'
      + ' data-tag="' + rcEsc(t.tag) + '">' + rcEsc(t.tag) + '</button>';
  }).join('');
}

/** 当前页签下的物料表格：一列物料名，一列「是否手工盘库」开关 */
function mv2RenderMatCfgList() {
  const box = document.getElementById('mv2-matcfg-list');
  if (!box) return;

  const tab = MV2_MATCFG_TABS.filter(function (t) { return t.tag === mv2MatCfgTab; })[0];
  if (!tab || !mv2MatCfgDraft) { box.innerHTML = ''; return; }

  const on = mv2MatCfgDraft[tab.tag] || [];
  box.innerHTML = '<table class="data-table mv2-matcfg-table">'
    + '<thead><tr><th>物料名称</th>'
    + '<th class="mv2-matcfg-col-on">是否手工盘库</th></tr></thead>'
    + '<tbody>'
    + tab.materials.map(function (m) {
      const isOn = on.indexOf(m) >= 0;
      return '<tr>'
        + '<td>' + rcEsc(m) + '</td>'
        + '<td class="mv2-matcfg-col-on">'
        + '<button type="button" class="switch' + (isOn ? ' on' : '') + '"'
        + ' role="switch" aria-checked="' + (isOn ? 'true' : 'false') + '"'
        + ' data-mat="' + rcEsc(m) + '"'
        + ' title="' + (isOn ? '已开启' : '已关闭') + '">'
        + '<span class="switch-knob"></span></button>'
        + '</td></tr>';
    }).join('')
    + '</tbody></table>';
}

function mv2RenderMatCfg() {
  mv2RenderMatCfgTabs();
  mv2RenderMatCfgList();
}

function mv2OpenMatCfgModal() {
  mv2MatCfgDraft = mv2CloneMatCfg(mv2MatCfg);
  mv2MatCfgTab = MV2_MATCFG_TABS[0].tag;    // 每次打开都回到第一个页签，位置可预期
  mv2RenderMatCfg();
  openModal('mv2-matcfg-modal');
}

/** 切页签。只改选中态并重画列表，**不丢草稿**（在另一个页签勾的开关要留住） */
function mv2SwitchMatCfgTab(tag) {
  if (!MV2_MATCFG_TABS.some(function (t) { return t.tag === tag; })) return;
  mv2MatCfgTab = tag;
  mv2RenderMatCfg();
}

/**
 * 切换某个物料的开关（改的是**草稿**，不落库）。
 * 就地改这一个按钮的类与 aria，不整表重画 —— 重画会让按钮失焦，键盘连续操作很难受。
 */
function mv2ToggleMatCfg(btn, mat) {
  if (!mv2MatCfgDraft) return;
  const tag = mv2MatCfgTab;
  const list = mv2MatCfgDraft[tag] || (mv2MatCfgDraft[tag] = []);
  const i = list.indexOf(mat);
  const isOn = i < 0;                        // 原来没开 → 这次是「打开」
  if (isOn) list.push(mat);
  else list.splice(i, 1);

  btn.classList.toggle('on', isOn);
  btn.setAttribute('aria-checked', isOn ? 'true' : 'false');
  btn.title = isOn ? '已开启' : '已关闭';
}

function mv2ApplyMatCfg() {
  const next = mv2NormMatCfg(mv2MatCfgDraft);
  if (!mv2SaveMatCfg(next)) { toast('保存失败：浏览器存储不可用'); return; }
  mv2MatCfg = next;
  mv2MatCfgDraft = null;

  // 列表本身不受物料配置影响（它只作用于「模版下载」），所以这里不需要重画表格；
  // 但按钮 title 上的「已开启 N 个」要跟着变。
  mv2SyncMatCfgTitle();
  closeModal('mv2-matcfg-modal');

  const n = mv2MatOnCount();
  toast(n ? ('物料配置已保存：已开启 ' + n + ' 个物料') : '物料配置已保存：当前没有开启任何物料');
}

function mv2CloseMatCfgModal() {
  mv2MatCfgDraft = null;                     // 丢弃未保存的改动
  closeModal('mv2-matcfg-modal');
}

/** 把已开启的物料数写进按钮 title，不开弹窗也能知道现在配了几个 */
function mv2SyncMatCfgTitle() {
  const btn = document.getElementById('mv2-matcfg');
  if (btn) btn.title = '当前已开启 ' + mv2MatOnCount() + ' 个物料';
}

/* ============================================================
 * 模版下载 / 导入
 * ------------------------------------------------------------
 * 点「模版下载」**先弹窗选年份 + 月份**，再按「物料配置」与该年月生成模版：
 *   第 1 行：填报说明（跨 8 列合并，红字）——只给人看，导入时自动跳过
 *   第 2 行：年份,月份,报送生产线信息,行业填报标签,物料名称,参数名称,单位,填报值
 *   第 3 行起：**开关为开的物料** 展开出来的行，年终月两列已按所选填好
 *
 * 弹窗里年月默认 = **当前月的上一个月**（见 mv2ExportDefaultYM，补报上一期）。
 *
 * 三条生成规则（都在 mv2BuildRows / mv2ExportParamsFor 里）：
 *   1. 物料 = 物料配置里开关为「开」的物料 —— 不看列表里有没有数据
 *   2. 行 = 只有所选年月**等于「期初库存时间配置」那个月**时，才带「期初库存量」行，
 *          其余月份只带「期末库存量」行（期初只在基准月人工录入，别处是派生值）
 *   3. 填报值**一律留空** —— 模版是发出去让人填的，带出数字会分不清哪格该填
 *
 * 导入 = 按「年份 / 月份 / 生产线 / 标签 / 物料 / 参数」六个字段定位：
 *          列表里已有该行 → 更新填报值与单位；
 *          列表里没有、但六个字段都合规（物料 / 参数在已知清单里）→ 作为新行补进来，
 *            所以误删的行也能用模版补回来（行会回来，但填报值要重新填 —— 模版不带旧值）；
 *          字段不全或在清单外 → 跳过并计数，避免把不相干的行写进来。
 *        表头行位置是**探测**出来的（认第一列的「年份」），带不带说明行都能导。
 * ============================================================ */

const MV2_XLSX_HEAD = ['年份', '月份', '报送生产线信息', '行业填报标签', '物料名称', '参数名称', '单位', '填报值'];

const MV2_XLSX_NOTE = '填报说明：1.除填报值列，需人工填写外，其他列均不可修改；2.填报值，保量2位小数';
const MV2_XLSX_NOTE_HPT = 22;

/**
 * 模版里某物料要有哪些参数行。
 *
 * 规则：**只有选中的年月正好等于「期初库存时间配置」那个月，才带「期初库存量」行**；
 * 其余月份只带「期末库存量」行。
 *
 * 依据：期初库存量只在基准月是人工录入的，其他月份的期初等于上月期末（派生值），
 * 下发一张派生值让用户填没有意义，还会让人以为要重新盘一次库。
 */
function mv2ExportParamsFor(year, month) {
  const isBase = mv2MonthKeyOf({ year: year, month: month }) === mv2LoadTime();
  return isBase ? [MV2_OPENING_PARAM, MV2_CLOSING_PARAM] : [MV2_CLOSING_PARAM];
}

/** 某物料某参数的单位：优先取填报项配置里的口径（与 v1 一致），配置里没有就回落 't' */
function mv2UnitOfParam(tag, material, param) {
  const mats = rcMatsOf(mv2Config, tag);
  for (let i = 0; i < mats.length; i++) {
    if (mats[i].material !== material) continue;
    const ps = mats[i].params || [];
    for (let j = 0; j < ps.length; j++) {
      if (ps[j].name === param) return ps[j].unit || 't';
    }
  }
  return 't';
}

/** 模版里新生成的行用哪条生产线：取填报项配置的第一条，没配就「全厂」 */
function mv2DefaultLine() {
  const lines = (mv2Config && mv2Config.lines) || [];
  return lines.length ? lines[0] : '全厂';
}

/**
 * 模版内容的二维数组（第 0 行是表头）。
 *
 *   物料维度 = 物料配置里开关为「开」的物料（按页签、页签内顺序）
 *   参数维度 = 见 mv2ExportParamsFor（只有基准月才带「期初库存量」行）
 *   年 / 月  = 用户在下载弹窗里选的，直接写进前两列
 *
 * **填报值一律留空**：模版是发给用户填的，这一列又是唯一允许人工填的列，
 * 出现数字会让人分不清哪格是「已有数据」、哪格是「等你填」。
 * 所以这里**完全不读列表里已有的值**，也不按数据里的月份来生成。
 */
function mv2BuildRows(year, month) {
  const rows = [MV2_XLSX_HEAD.slice()];
  const line = mv2DefaultLine();
  const matFilter = mv2QueryMaterial();

  MV2_MATCFG_TABS.forEach(function (tab) {
    tab.materials.forEach(function (mat) {
      if (!mv2IsMatOn(tab.tag, mat)) return;                  // 开关为关的物料不进模版
      if (matFilter !== null && mat !== matFilter) return;    // 查询条件里的物料筛选仍然生效
      mv2ExportParamsFor(year, month).forEach(function (param) {
        rows.push([
          year, month, line, tab.tag, mat, param,
          mv2UnitOfParam(tab.tag, mat, param),
          '',                                                 // ← 填报值留空，等用户填
        ]);
      });
    });
  });
  return rows;
}

/**
 * 下载弹窗里年 / 月的默认值：**当前月的上一个月**（相对系统今天）。
 *
 * 依据：模版是拿来「补报上一期」的 —— 这个月开填，填的是刚过去的那个月，
 * 所以点开弹窗什么都不用改，直接确定就是对的。
 *
 * 为什么不用列表数据 / 查询条件来推默认值（早期三条优先级的旧规则，已移除）：
 *   - 「数据里的最新月」会被缺月带偏 —— 8 月忘了报、9 月报完了，最新月是 9 月，
 *     但真正要填的还是 8 月；
 *   - 「查询条件里的年月」是用户临时的筛选动作，不是默认值，混进来会让同一个
 *     按钮在不同筛选状态下弹出不同年月，说不清也测不稳。
 *
 * 用纯算术而不是 `d.setMonth(d.getMonth() - 1)`：后者在月末会溢出
 * （3 月 31 日减一个月得到 3 月 3 日 —— 2 月没有 31 号），跨年也不直观。
 */
function mv2ExportDefaultYM() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;                       // getMonth() 是 0 基的
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

function mv2OpenExportModal() {
  const ym = mv2ExportDefaultYM();
  document.getElementById('mv2-export-year').innerHTML = yearOptions(ym.year);
  document.getElementById('mv2-export-month').innerHTML = monthOptions(ym.month);
  openModal('mv2-export-modal');
}

function mv2ApplyExport() {
  const year = Number(document.getElementById('mv2-export-year').value);
  const month = Number(document.getElementById('mv2-export-month').value);
  if (!year || !month) { toast('请选择年份和月份'); return; }
  if (!mv2ExportXlsx(year, month)) return;   // 失败时 mv2ExportXlsx 已给出提示，别再补一条「已下载」
  closeModal('mv2-export-modal');
  toast('模版已下载（' + year + '年' + month + '月），填好填报值后可直接导入');
}

/**
 * 导出模版。返回**是否真的写出了文件** —— 调用方据此决定提示语，
 * 免得失败时先弹一条错误提示、又紧跟一条「模版已下载」自相矛盾。
 */
function mv2ExportXlsx(year, month) {
  if (!mv2MatOnCount()) {
    toast('请先点「物料配置」，把要填报的物料打开（是否手工盘库）');
    return false;
  }

  const body = mv2BuildRows(year, month);
  if (body.length < 2) {
    toast('当前条件下没有可导出的物料，请检查「物料配置」的开关与物料名称筛选');
    return false;
  }

  const rows = [[MV2_XLSX_NOTE]].concat(body);
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
  XLSX.writeFile(wb, '手工数据填报模版_' + year + '年' + month + '月.xlsx');
  return true;
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

    // 六个定位字段都要合规，否则这行不知道往哪落。
    // 物料用 MV2_KNOWN_MATERIALS（填报项配置清单 ∪ 物料配置候选）——
    // 物料配置里新开的物料不在填报项配置清单里，只认后者会把模版行全判成「对不上配置」。
    const known = row2.year && row2.month
      && RC_LINES.indexOf(row2.line) >= 0
      && RC_TAGS.indexOf(row2.tag) >= 0
      && MV2_KNOWN_MATERIALS.indexOf(row2.material) >= 0
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

  // 模版下载：先弹窗选年月（见 mv2OpenExportModal），确认后再生成
  document.getElementById('mv2-export').addEventListener('click', mv2OpenExportModal);
  document.getElementById('mv2-export-ok').addEventListener('click', mv2ApplyExport);
  document.getElementById('mv2-export-cancel').addEventListener('click', function () { closeModal('mv2-export-modal'); });
  document.getElementById('mv2-export-close').addEventListener('click', function () { closeModal('mv2-export-modal'); });

  // 物料配置弹窗
  document.getElementById('mv2-matcfg').addEventListener('click', mv2OpenMatCfgModal);
  document.getElementById('mv2-matcfg-ok').addEventListener('click', mv2ApplyMatCfg);
  document.getElementById('mv2-matcfg-cancel').addEventListener('click', mv2CloseMatCfgModal);
  document.getElementById('mv2-matcfg-close').addEventListener('click', mv2CloseMatCfgModal);

  // 页签切换
  document.getElementById('mv2-matcfg-tabs').addEventListener('click', function (e) {
    const btn = e.target.closest('.status-tab');
    if (btn) mv2SwitchMatCfgTab(btn.dataset.tag);
  });

  // 开关（事件委托：「是否手工盘库」那一列都是 .switch）
  document.getElementById('mv2-matcfg-list').addEventListener('click', function (e) {
    const sw = e.target.closest('.switch[data-mat]');
    if (sw) mv2ToggleMatCfg(sw, sw.dataset.mat);
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
  ['mv2-edit-modal', 'mv2-time-modal', 'mv2-confirm-modal', 'mv2-matcfg-modal', 'mv2-export-modal'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target.id !== id) return;
      if (id === 'mv2-confirm-modal') mv2DeletingKey = '';
      if (id === 'mv2-matcfg-modal') mv2MatCfgDraft = null;   // 丢弃未保存的改动
      closeModal(id);
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
  mv2MatCfg = mv2LoadMatCfg();

  // 三个查询条件都带一个空值项「全部」，且**默认选中它** ——
  // 即一进页面看的就是全部数据（不按年 / 月 / 物料过滤），而不是某个固定月份。
  document.getElementById('mv2-year').innerHTML = yearOptions('', '全部');
  document.getElementById('mv2-month').innerHTML = monthOptions('', '全部');
  mv2FillMaterialOptions();

  mv2Page = 1;
  mv2SyncTimeTitle();
  mv2SyncMatCfgTitle();
  mv2RenderAll();
  bindMv2Events();
}

if (document.querySelector('.app-shell')) initManualEntryV2Page();
