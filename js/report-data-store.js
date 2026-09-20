/**
 * 填报数据 —— 共享数据层
 *
 * 被这些页面共同引用：
 *   manual-entry.html  （首页看板）—— 读月度状态（决定月卡颜色 / 文案）
 *   month-report.html  （数据填报页）—— 读已存数据（重新填报时带入）/ 保存数据
 *   report-detail.html （填报详情页）—— 读某个月的完整数据，只读展示
 *
 * 数据分两层：
 *   1. 月度状态（rdStateOf）—— 演示编排，见 RD_MONTHS。真实系统应改成调接口。
 *   2. 填报值（rdDataFor）—— 优先取用户在 localStorage 里存过的，
 *      没有存储且该月「已通过」时，用 rdDemoValues() 生成一份稳定的演示数据。
 *
 * 值的存放结构（与 month-report.js 的 RP_VALUES 完全一致）：
 *   { '全厂::化石燃料': { '0:1': { value: '123', remark: '' } } }
 *   键 = 主体 + '::' + 页签；二级键 = 物料下标 + ':' + 参数下标
 */

const RD_BASE_YEAR = new Date().getFullYear();

const RD_STORE_KEY = 'emission-mgmt-report-data-v1';

/** 每个状态的中文名（首页月卡、填报页角标都用它） */
const RD_LABEL = {
  passed: '已通过',
  filling: '填报中',
  pending: '未填报',
  notStarted: '未开始',
};

/**
 * 月度状态演示编排（下标 0 对应 1 月）：
 * 1~7 月已通过、8 月填报中、9 月未填报、10~12 月未开始。
 */
const RD_MONTHS = [
  'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed',
  'filling',
  'pending',
  'notStarted', 'notStarted', 'notStarted',
];

/** 取某年某月的状态：基准年按 RD_MONTHS，往年全部已通过，未来年全部未开始 */
function rdStateOf(year, month) {
  const i = Math.min(12, Math.max(1, Number(month) || 1)) - 1;
  if (year === RD_BASE_YEAR) return RD_MONTHS[i];
  return year < RD_BASE_YEAR ? 'passed' : 'notStarted';
}

function rdLabelOf(state) {
  return RD_LABEL[state] || RD_LABEL.notStarted;
}

/* ---------- 存储读写 ---------- */

function rdKey(year, month) {
  return String(year) + '-' + String(month);
}

function rdAll() {
  try {
    return JSON.parse(localStorage.getItem(RD_STORE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

/** 某月已保存的记录 { values, updatedAt }，没存过返回 null */
function rdStored(year, month) {
  const rec = rdAll()[rdKey(year, month)];
  return rec && rec.values ? rec : null;
}

/** 保存某月的填报值。返回是否成功。 */
function rdSave(year, month, values) {
  const all = rdAll();
  all[rdKey(year, month)] = { values: values, updatedAt: nowText() };
  try {
    localStorage.setItem(RD_STORE_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- 演示数据 ---------- */

/** 稳定的伪随机（同一个 seed 永远得到同一个数），避免每次刷新数据都在跳 */
function rdNoise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** 从「980.00 t」这类文本里取数字，取不到返回 null */
function rdNum(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * 为一「已通过」的月份生成演示数据。
 *
 * 编数原则（关键：同一物料各参数之间要**自洽**，不能各随机各的）：
 *
 *   1. 先定该物料的「量级基准」ref —— 取有预填值的那个参数（无烟煤 980、烟煤 1860…）。
 *      量级不对是最扎眼的假：库存类的数就该在千吨级，不能出现 980 t 的期初配 60 t 的期末。
 *   2. 期初库存量 = 上月结转，围绕预填值只 ±3% 微动（账上结转本就稳定）。
 *   3. 期末库存量 = 本期盘点结果，以 ref 为基准 ±12% 波动 —— 与期初同量级、又不完全相同。
 *   4. 库存变化量 = 期末 − 期初，**直接算出来**而不是单独随机，否则三项永远对不上账。
 *   5. 其他参数（购入量 / 消费量…）有预填值就按预填值 ±5%，没有的按 ref 给。
 *
 * 所有随机都走 rdNoise(seed)，同一个 seed 永远同一个数：
 * 同一个月刷新多少次数据都不变，跨月才换一批。
 */
function rdDemoValues(year, month, cfg) {
  const out = {};
  const lines = (cfg && cfg.lines) || [];
  const tags = (cfg && cfg.tags) || [];

  lines.forEach(function (entity, ei) {
    tags.forEach(function (tag, ti) {
      const mats = rcMatsOf(cfg, tag);
      if (!mats.length) return;

      const cells = {};

      mats.forEach(function (m, mi) {
        const params = m.params || [];
        if (!params.length) return;

        // 每个参数一个稳定 seed（月份变了才换一批）
        const seedOf = function (pi) {
          return month * 100 + ei * 37 + ti * 11 + mi * 7 + pi * 3 + 1;
        };
        const decimalsOf = function (pi) {
          const d = Number(params[pi].decimals);
          return d >= 0 ? d : 2;
        };
        const findIdx = function (kw) {
          for (let i = 0; i < params.length; i++) {
            if (String(params[i].name || '').indexOf(kw) >= 0) return i;
          }
          return -1;
        };

        // 1. 量级基准：优先用带预填值的参数，都没有才按物料序号给个降级量级
        let ref = null;
        for (let i = 0; i < params.length && ref == null; i++) {
          const d = rdNum(params[i].default);
          if (d != null && d > 0) ref = d;
        }
        if (ref == null) ref = 60 + mi * 25;

        // 2/3. 期初、期末先算出来，供「库存变化量」引用
        const openIdx = findIdx('期初');
        const closeIdx = findIdx('期末');

        const presetOf = function (i) {
          return i < 0 ? null : rdNum(params[i].default);
        };

        const opening = openIdx < 0 ? null
          : (presetOf(openIdx) == null ? ref : presetOf(openIdx)) * (0.97 + rdNoise(seedOf(openIdx)) * 0.06);

        const closing = closeIdx < 0 ? null
          : ref * (0.88 + rdNoise(seedOf(closeIdx)) * 0.24);

        params.forEach(function (p, pi) {
          const name = String(p.name || '');
          const preset = rdNum(p.default);
          const seed = seedOf(pi);
          let value;

          if (pi === openIdx) {
            value = opening;
          } else if (pi === closeIdx) {
            value = closing;
          } else if (name.indexOf('变化量') >= 0 && opening != null && closing != null) {
            value = closing - opening;                 // 4. 对账：变化量 = 期末 − 期初
          } else {
            const base = preset == null ? ref : preset; // 5. 其余参数
            value = base * (0.95 + rdNoise(seed) * 0.10);
          }

          cells[mi + ':' + pi] = {
            value: Number(value).toFixed(decimalsOf(pi)),
            remark: rdNoise(seed + 0.5) > 0.72 ? '已复核' : '',
          };
        });
      });

      out[entity + '::' + tag] = cells;
    });
  });

  return out;
}

/**
 * 取某月的填报值，没有就返回 null：
 *   存过 → 用存过的（重新填报、刚保存过的都走这条）
 *   没存过且该月已通过 → 生成演示数据（让「查看详情」有东西可看）
 *   其余（填报中 / 未填报 / 未开始）→ null，填报页照旧只带配置里的预填值
 */
function rdDataFor(year, month, cfg) {
  const rec = rdStored(year, month);
  if (rec) return rec.values;
  if (rdStateOf(year, month) === 'passed') return rdDemoValues(year, month, cfg);
  return null;
}
