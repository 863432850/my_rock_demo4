/**
 * ============================================================
 * 框架层（app.js）—— 多模块平台壳
 * ------------------------------------------------------------
 * 只放「与业务无关」的东西：
 *   1. 一级模块注册表 MODULES（顶栏入口 + 每个模块自己的侧栏）
 *   2. 布局骨架：顶栏 / 侧栏 / 面包屑 / 页面标题
 *   3. 通用工具：时间、提示、弹窗、下拉选项
 *   4. 文档写入服务对接（流程图、需求说明，按模块分别存）
 *
 * 新增一个一级模块只需两步：
 *   1. 往下面 MODULES 里追加 { id, name, home, getSidebar }
 *      —— getSidebar 只写业务菜单，「流程图&需求说明」分组由 withDocsSidebar() 自动挂上，
 *         不需要每个模块自己配（避免漏配）
 *   2. 建 js/docs/{id}/doc-defaults.js 与 assets/{id}/（可以都先空着，保存时服务会写入）
 *
 * 业务页面请另建 xxx.html + js/xxx.js：
 *   <script src="js/app.js"></script>
 *   <script src="js/xxx.js"></script>
 *   页面里调 initLayout('菜单id', { moduleId: '模块id' })
 * ============================================================
 */

/** 平台名（顶栏左上角） */
const PLATFORM_NAME = '双碳管理平台';

/** 业务数据落浏览器 localStorage 用的键前缀（换项目时改这里） */
const STORAGE_KEY = 'emission-mgmt-v1';

/**
 * 「流程图 / 需求说明」分组：每个模块都有一份，靠 ?module= 区分。
 * 页面是同一对 html，内容与保存位置按模块隔离（见 js/docs/{module}/ 与 assets/{module}/）。
 */
function docsSidebarGroup(moduleId) {
  return {
    id: 'docs',
    name: '流程图&需求说明',
    items: [
      { id: 'flowchart', name: '整体流程图', href: 'flowchart.html?module=' + moduleId },
      { id: 'requirements', name: '需求说明/注意事项', href: 'requirements.html?module=' + moduleId },
    ],
  };
}

/**
 * 一级模块注册表。
 * home 是模块首页（点顶栏入口、点面包屑首级都落这里）。
 *
 * 侧栏项可选 `disabled: true` —— 表示该页已「封存」：仍占菜单位置、仍能直接开 URL 查看，
 * 但菜单项渲染成不可点的 <span>（灰字 + 禁止光标）。见 initLayout 里的渲染分支。
 */
const MODULES = [
  {
    id: 'carbon',
    name: '碳排放管理',
    home: 'manual-entry-v2.html',
    getSidebar: function () {
      return [
        {
          id: 'biz',
          name: '业务界面',
          items: [
            { id: 'manual-entry', name: '手工数据填报（旧版）', href: 'manual-entry.html', disabled: true },
            { id: 'manual-entry-v2', name: '手工数据填报v2', href: 'manual-entry-v2.html' },
          ],
        },
      ];
    },
  },
  {
    id: 'verify',
    name: '碳核查管理',
    home: 'verify-data.html',
    getSidebar: function () {
      return [
        {
          id: 'biz',
          name: '业务界面',
          items: [
            { id: 'verify-data', name: '核查数据管理', href: 'verify-data.html' },
          ],
        },
      ];
    },
  },
];

/** 默认模块（URL 没给有效 module 参数时用它） */
const DEFAULT_MODULE_ID = 'carbon';

function getModule(moduleId) {
  return MODULES.find(function (m) { return m.id === moduleId; }) || MODULES[0];
}

/**
 * 取模块显示名。
 * 全屏子页（month-report / report-detail / report-config）不套平台壳，
 * 但浏览器标题里仍要体现归属，统一走这里，避免各自写死字符串。
 */
function moduleName(moduleId) {
  return getModule(moduleId).name;
}

/**
 * 从 ?module= 取当前模块 id（流程图 / 需求说明这类「两模块共用一套页面」的场景用）。
 * 取不到或不在注册表里时回落到默认模块。
 */
function currentModuleId() {
  try {
    var id = new URLSearchParams(location.search).get('module');
    if (id && MODULES.some(function (m) { return m.id === id; })) return id;
  } catch (e) { /* ignore */ }
  return DEFAULT_MODULE_ID;
}

/** 某模块的文档浏览器暂存键（流程图草稿 / 已删除标记 / 需求说明草稿） */
function docsStorageKeys(moduleId) {
  moduleId = moduleId || DEFAULT_MODULE_ID;
  return {
    flowchart: 'docs-flowchart-' + moduleId + '-v1',
    flowchartCleared: 'docs-flowchart-cleared-' + moduleId,
    requirements: 'docs-requirements-' + moduleId + '-v1',
    requirementsCleared: 'docs-requirements-cleared-' + moduleId,
  };
}

/** 某模块的文档写入接口路径 */
function docsApiPath(moduleId, kind) {
  return '/api/docs/' + encodeURIComponent(moduleId || DEFAULT_MODULE_ID) + '/' + kind;
}

/** 每个模块都自动挂上「流程图&需求说明」，避免新增模块时漏配 */
function withDocsSidebar(moduleId, groups) {
  groups = (groups || []).slice();
  var hasDocs = groups.some(function (g) { return g.id === 'docs'; });
  if (!hasDocs) groups.push(docsSidebarGroup(moduleId));
  return groups;
}

function flattenSidebar(groups) {
  var items = [];
  (groups || []).forEach(function (group) {
    (group.items || []).forEach(function (item) { items.push(item); });
  });
  return items;
}

function findSidebarItem(groups, id) {
  var items = flattenSidebar(groups);
  return items.find(function (s) { return s.id === id; }) || items[0];
}

/**
 * 文档页按 ?module= 动态加载 js/docs/{module}/doc-defaults.js，加载完再跑页面脚本。
 *
 * 为什么要动态加载：两个模块共用 flowchart.html / requirements.html 一对页面，
 * 但各自的 DEFAULT_FLOWCHART / DEFAULT_REQUIREMENTS 在不同文件里。
 * 走 <script> 动态插入而不是在 html 里写死 src，是因为 html 里拿不到运行时才解析出的 module 参数。
 *
 * onerror 也继续往下走：文件不存在（新模块还没存过文档）不该把页面卡死，
 * 那时 DEFAULT_* 未定义，页面脚本自己会走「空槽位」分支。
 */
function loadModuleDocDefaults(thenSrc) {
  var moduleId = currentModuleId();
  var s = document.createElement('script');
  s.src = 'js/docs/' + encodeURIComponent(moduleId) + '/doc-defaults.js';
  function next() {
    var page = document.createElement('script');
    page.src = thenSrc;
    document.body.appendChild(page);
  }
  s.onload = next;
  s.onerror = next;
  document.body.appendChild(s);
}

/* ============================================================
 * 一、通用工具
 * ============================================================ */

function pad(n) { return String(n).padStart(2, '0'); }

/** 当前时间，格式 2026-09-18 09:09:03 */
function nowText() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** 轻提示 */
function toast(msg) {
  var el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
}

function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('show');
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

/** 年份下拉（2020~2035） */
function yearOptions(selected, placeholder) {
  var html = placeholder ? '<option value="">' + placeholder + '</option>' : '';
  for (var y = 2020; y <= 2035; y++) {
    html += '<option value="' + y + '"' + (String(selected) === String(y) ? ' selected' : '') + '>' + y + '年</option>';
  }
  return html;
}

/**
 * 月份下拉（1~12）。
 * placeholder 传了就在最前面加一个空值项（如「全部」）——「查全部」的语义由调用方决定：
 * 空值即不按月份过滤。不传时行为与以前完全一致（v1 的调用不受影响）。
 */
function monthOptions(selected, placeholder) {
  var html = placeholder ? '<option value="">' + placeholder + '</option>' : '';
  for (var m = 1; m <= 12; m++) {
    html += '<option value="' + m + '"' + (Number(selected) === m ? ' selected' : '') + '>' + m + '月</option>';
  }
  return html;
}

/** 从「2026年8月」这类文本里取年份 / 月份 */
function rangeYear(range) {
  const m = String(range || '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function rangeMonth(range) {
  const m = String(range || '').match(/(\d{1,2})月/);
  return m ? Number(m[1]) : null;
}

/* ============================================================
 * 二、文档写入服务（流程图 / 需求说明 保存到代码包文件）
 * ============================================================ */

function docsApi(pathname, options) {
  options = options || {};
  return fetch(pathname, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  }).then(function (res) {
    return res.json().catch(function () {
      return { ok: false, message: '服务响应异常' };
    }).then(function (data) {
      if (!res.ok || data.ok === false) {
        var err = new Error((data && data.message) || ('请求失败 ' + res.status));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    });
  });
}

function checkDocsServer(moduleId) {
  return docsApi(docsApiPath(moduleId || currentModuleId(), 'status')).then(function () {
    return true;
  }).catch(function () {
    return false;
  });
}

function docsServerRequiredTip() {
  return '请先在项目目录执行 npm start 启动本地服务，保存才会写入代码包文件';
}

/* ============================================================
 * 三、布局骨架
 * ============================================================ */

/**
 * 渲染顶栏 / 侧栏 / 面包屑。
 * @param {string|null} activeId SIDEBAR 中的 id，用于侧栏高亮；null 表示无侧栏高亮
 * @param {object} opts
 *        opts.moduleId  当前一级模块 id（carbon / verify），决定顶栏高亮与侧栏内容，默认 carbon
 *        opts.pageTitle 面包屑第二级与浏览器标题；缺省取侧栏里对应项的名称
 */
function initLayout(activeId, opts) {
  opts = opts || {};
  var mod = getModule(opts.moduleId || DEFAULT_MODULE_ID);
  var groups = withDocsSidebar(mod.id, typeof mod.getSidebar === 'function' ? mod.getSidebar() : []);
  var item = activeId ? findSidebarItem(groups, activeId) : null;
  var pageTitle = opts.pageTitle || (item ? item.name : mod.name);

  var header = document.getElementById('app-header');
  if (header) {
    header.innerHTML =
      '<div class="app-logo">'
      + '<div class="logo-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none">'
      + '<path d="M12 3c4 3 7 7 7 11a7 7 0 1 1-14 0c0-4 3-8 7-11z" fill="#fff" opacity="0.95"/>'
      + '</svg></div>'
      + '<span>' + PLATFORM_NAME + '</span>'
      + '</div>'
      + '<nav class="app-topnav">'
      + MODULES.map(function (m) {
        return '<a href="' + m.home + '" class="' + (m.id === mod.id ? 'active' : '') + '">' + m.name + '</a>';
      }).join('')
      + '</nav>'
      + '<div class="app-header-right">'
      + '<span>管理员</span>'
      + '<div class="app-avatar">管</div>'
      + '</div>';
  }

  var menu = document.getElementById('sidebar-menu');
  if (menu) {
    menu.innerHTML = groups.map(function (group) {
      var items = (group.items || []).map(function (s) {
        var active = s.id === activeId ? ' active' : '';
        // 封存项：渲染成不可点的 span（不是 <a>），点了不会跳转。
        // 保留 active 高亮，因为直接开 URL 进来时它仍是「当前页」，不该看不出自己在哪。
        if (s.disabled) {
          return '<span class="sidebar-item is-disabled' + active + '"'
            + ' title="该页面已封存，仅供查看">' + s.name + '</span>';
        }
        return '<a class="sidebar-item' + active + '" href="' + s.href + '">' + s.name + '</a>';
      }).join('');
      return '<div class="sidebar-group">'
        + '<div class="sidebar-group-title">' + group.name + '</div>'
        + items
        + '</div>';
    }).join('');
  }

  var crumb = document.getElementById('breadcrumb');
  if (crumb) {
    // 当前页就是模块首页时，首级面包屑不再带链接（点了也是自己）
    var currentPage = location.pathname.split('/').pop();
    var onHome = currentPage === mod.home.split('/').pop();

    crumb.innerHTML = (pageTitle === mod.name)
      ? '<span class="current">' + mod.name + '</span>'
      : (onHome
        ? '<span>' + mod.name + '</span>'
        : '<a href="' + mod.home + '">' + mod.name + '</a>')
      + '<span class="sep">/</span>'
      + '<span class="current">' + pageTitle + '</span>';
  }

  document.title = (pageTitle === mod.name)
    ? mod.name
    : pageTitle + ' · ' + mod.name;
}

/* ============================================================
 * 四、兼容旧常量
 * ------------------------------------------------------------
 * 文档脚本（flowchart.js / requirements.js）用这些键做浏览器暂存。
 * 声明成 var（不是 const）并默认指向当前模块 —— 页面跳转时按 ?module= 解析，
 * 两个模块共用一套页面也能各存各的草稿。
 * ============================================================ */
var __DOCS_KEYS__ = docsStorageKeys(currentModuleId());

var FLOWCHART_KEY = __DOCS_KEYS__.flowchart;
var FLOWCHART_CLEARED_KEY = __DOCS_KEYS__.flowchartCleared;

/** 需求说明的草稿键 / 已删除标记键 */
var REQUIREMENTS_KEY = __DOCS_KEYS__.requirements;
var REQUIREMENTS_CLEARED_KEY = __DOCS_KEYS__.requirementsCleared;
