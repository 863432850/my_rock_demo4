/**
 * 填报项配置 —— 共享数据层
 *
 * 这个文件被这些页面共同引用：
 *   report-config.html  （填报项配置页）—— 读写配置
 *   month-report.html   （数据填报页）—— 只读配置，按配置生成页签与表格
 *   report-detail.html  （填报详情页）—— 只读配置，按配置把已存数据摊开展示
 *
 * 所以选项清单、默认配置、存储键、读取函数都放这里，避免多处各写一份、改一处漏一处。
 * 引用顺序：必须在 report-config.js / month-report.js / report-detail.js 之前。
 */

/** 第 1 步：报送生产线信息（多选） */
const RC_LINES = [
  '全厂',
  '石灰工序',
  '锅炉发电',
  '焦化工序',
  '烧结工序',
  '炼铁工序',
  '转炉炼钢工序',
  '掺烧自产二次能源的化石燃料发电设施',
];

/** 第 2 步：行业填报标签（多选）—— 选中项决定第 3 步的配置区，也决定填报页的参数页签 */
const RC_TAGS = [
  '化石燃料',
  '自产二次能源',
  '原料',
  '产品',
  '外购电力/热力信息',
  '生产数据',
];

/**
 * 第 3 步的物料下拉选项。
 * 按化石燃料 → 焦化产品 → 油品 → 燃气的顺序排，方便在下拉里找。
 * 物料名称 / 参数名称 / 单位三个字段在配置页都是**下拉选择**，不开放自由输入，
 * 就是为了让各企业填的口径一致（不然「无烟煤」「白煤」「无烟煤(块)」各写各的，汇总时对不上）。
 */
const RC_MATERIALS = [
  '无烟煤', '烟煤', '炼焦煤', '洗精煤', '其他洗煤', '型煤', '煤矸石',
  '焦炭', '石油焦', '焦炉煤气', '高炉煤气', '转炉煤气',
  '原油', '汽油', '柴油', '燃料油', '液化石油气', '天然气',
  '其他石油制品', '其他焦化产品',
];

/** 第 3 步的参数名称下拉选项 —— 库存类 + 活动水平类 + 排放因子类 */
const RC_PARAM_NAMES = [
  '期初库存量', '期末库存量', '库存变化量',
  '购入量', '消费量', '输出量', '净消耗量',
  '低位发热量', '单位热值含碳量', '碳氧化率',
];

/** 第 3 步的单位下拉选项 */
const RC_UNITS = [
  't', '万t', 'kg', 'm³', '万m³', 'Nm³',
  'GJ', 'TJ', '万kWh', 'MWh', 'tCO2', 'tCO2e', '%', 'kgC/GJ',
];

const RC_STORE_KEY = 'emission-mgmt-report-config-v1';

/**
 * 配置结构版本。**改了默认参数名 / 默认物料 / 结构时把它 +1**。
 * rcLoadConfig() 只认版本号一致的存储，旧版本一律忽略并回落到默认配置。
 * 目的：避免本地残留的旧配置把新默认值顶掉，让人以为代码没生效。
 * v1 = 期初库存 / 期末库存，2 个物料（焦炭、烟煤），无预填值
 * v2 = 改名期初库存量 / 期末库存量，加预填值
 * v3 = 物料扩到 4 个（无烟煤 / 烟煤 / 洗精煤 / 焦炭）
 * v4 = 去掉参数上的「计算获取方式」（数据填报页对应的「取值方式」列一并去掉）
 */
const RC_CONFIG_VERSION = 4;

/**
 * 默认配置：首次进入（本地没存过配置 / 存的版本过旧）时使用。
 * 按需求：只勾「全厂」+「化石燃料」，化石燃料下挂 4 个物料
 * （无烟煤、烟煤、洗精煤、焦炭），每个物料只有期初库存量、期末库存量两个参数
 * （单位 t、保留 2 位小数）。
 *
 * params[].default 是该参数的**预填值**：数据填报页首次打开时会带出来（用户可改）。
 * 目前只有期初库存量配了预填值（上期结转的账面库存），期末库存量要等盘点完才知道，故意留空。
 */
function rcDefaultState() {
  const STOCK_PARAMS = function (openingStock) {
    return [
      { name: '期初库存量', unit: 't', decimals: 2, default: openingStock },
      { name: '期末库存量', unit: 't', decimals: 2, default: '' },
    ];
  };
  return {
    version: RC_CONFIG_VERSION,
    lines: ['全厂'],
    tags: ['化石燃料'],
    data: {
      '化石燃料': [
        { material: '无烟煤', params: STOCK_PARAMS('980.00') },
        { material: '烟煤', params: STOCK_PARAMS('1860.00') },
        { material: '洗精煤', params: STOCK_PARAMS('2450.00') },
        { material: '焦炭', params: STOCK_PARAMS('3250.00') },
      ],
    },
  };
}

/** HTML 转义（各页面都要拼 HTML 字符串，放共享层） */
function rcEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** 某个标签下的物料数组（配置缺失时给空数组，调用方不用再判空） */
function rcMatsOf(cfg, tag) {
  return (cfg && cfg.data && cfg.data[tag]) || [];
}

/**
 * 读取配置。以下情况一律回到默认配置：
 *   - 存储不存在 / JSON 损坏 / 结构不对
 *   - **版本号与 RC_CONFIG_VERSION 不一致**（旧配置不套用，见该常量注释）
 * 同时过滤掉已不在选项清单里的标签与工序（选项清单调整后，旧配置不会带出无源内容）。
 */
function rcLoadConfig() {
  try {
    const raw = localStorage.getItem(RC_STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const shapeOk = saved && Array.isArray(saved.lines) && Array.isArray(saved.tags) && saved.data;
      const versionOk = saved && saved.version === RC_CONFIG_VERSION;
      if (shapeOk && versionOk) {
        return {
          version: RC_CONFIG_VERSION,
          lines: saved.lines.filter(function (v) { return RC_LINES.indexOf(v) >= 0; }),
          tags: saved.tags.filter(function (v) { return RC_TAGS.indexOf(v) >= 0; }),
          data: saved.data,
        };
      }
    }
  } catch (e) { /* 配置损坏就当没有，回到默认 */ }
  return rcDefaultState();
}

/** 写入配置（带上当前版本号）。返回是否成功。 */
function rcSaveConfig(cfg) {
  try {
    cfg.version = RC_CONFIG_VERSION;
    localStorage.setItem(RC_STORE_KEY, JSON.stringify(cfg));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 配置页的「返回数据填报页」地址。
 * 从填报页跳过来时会带上 year / month（见 month-report.js 的「填报项配置」按钮），
 * 这里原样带回，保证返回后仍是同一个年月，不会退回默认月份。
 */
function rcReportUrl(search) {
  const q = String(search == null ? location.search : search).replace(/^\?/, '');
  const y = (q.match(/(?:^|&)year=([^&]*)/) || [])[1];
  const m = (q.match(/(?:^|&)month=([^&]*)/) || [])[1];
  return 'month-report.html' + (y || m ? '?year=' + (y || '') + '&month=' + (m || '') : '');
}
