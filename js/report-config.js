/**
 * 填报项配置页 —— 从数据填报页右上角「填报项配置」进入
 *
 * 三步：
 *   1 报送生产线信息（多选下拉）
 *   2 行业填报标签（多选下拉）—— 选中项决定第 3 步生成哪些配置区
 *   3 物料与参数配置 —— 每个标签下可增删物料，每个物料下可增删参数
 *                        参数字段：参数名称 / 单位 / 保留小数位数
 *
 * 选项清单、默认配置、读写函数都在 js/report-config-store.js（与填报页共用），
 * 本文件只负责界面与交互。
 *
 * 底部按钮：取消（不保存、直接返回）/ 保存配置（校验后落 localStorage）。
 */

/* ---------- 运行态 ---------- */

let RC = rcDefaultState();

/* ============================================================
 * 多选下拉组件
 * ============================================================ */

/**
 * @param {HTMLElement} el   容器（.ms）
 * @param {string[]}    options 全部可选项
 * @param {string[]}    selected 已选项（数组引用即 state，直接改它）
 * @param {Function}    onChange 选择变化后的回调（用于第 2 步联动第 3 步）
 */
function createMultiSelect(el, options, selected, onChange) {
  el.innerHTML =
    '<button type="button" class="ms-field"></button>'
    + '<svg class="ms-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>'
    + '<div class="ms-panel">'
    + options.map(function (o) {
      return '<label class="ms-opt' + (selected.indexOf(o) >= 0 ? ' checked' : '') + '">'
        + '<input type="checkbox" value="' + rcEsc(o) + '"' + (selected.indexOf(o) >= 0 ? ' checked' : '') + ' />'
        + '<span>' + rcEsc(o) + '</span>'
        + '</label>';
    }).join('')
    + '</div>';

  const field = el.querySelector('.ms-field');
  const panel = el.querySelector('.ms-panel');

  function paintField() {
    field.innerHTML = selected.length
      ? selected.map(function (v) {
        return '<span class="ms-chip">' + rcEsc(v) + '<i class="ms-chip-x" data-v="' + rcEsc(v) + '" title="移除">×</i></span>';
      }).join('')
      : '<span class="ms-placeholder">请选择</span>';
  }

  function paintPanel() {
    Array.prototype.forEach.call(panel.querySelectorAll('.ms-opt'), function (opt) {
      const on = selected.indexOf(opt.querySelector('input').value) >= 0;
      opt.classList.toggle('checked', on);
      opt.querySelector('input').checked = on;
    });
  }

  field.addEventListener('click', function (e) {
    // 点标签上的 × 是移除该项，不展开面板
    const x = e.target.closest('.ms-chip-x');
    if (x) {
      e.stopPropagation();
      const i = selected.indexOf(x.dataset.v);
      if (i >= 0) selected.splice(i, 1);
      paintField();
      paintPanel();
      if (onChange) onChange();
      return;
    }
    // 关掉别的下拉，同一时间只开一个；再点自己则是收起
    const wasOpen = el.classList.contains('open');
    closeDropdowns();
    if (!wasOpen) el.classList.add('open');
  });

  panel.addEventListener('change', function (e) {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const v = cb.value;
    const i = selected.indexOf(v);
    if (cb.checked && i < 0) selected.push(v);
    if (!cb.checked && i >= 0) selected.splice(i, 1);
    paintField();
    paintPanel();
    if (onChange) onChange();
  });

  paintField();
  paintPanel();
}

/* ============================================================
 * 单选下拉组件（物料 / 参数名称 / 单位三个字段用）
 * ============================================================
 * 为什么不用 <select>：这些清单是行业标准口径，需要「面板里能按关键字过滤」，
 *   还要在值不在清单里时（老配置带过来的自定义值）也能正常显示和改，
 *   原生 select 的样式、宽度、搜索都不够用。
 *
 * 交互约定：
 *   - 面板里的选项**一次性全渲染在 HTML 里**，点击走 wrap 上的事件委托（与增删行同一套）；
 *   - 选中只改数据 + 更新该下拉自己的显示，**不重画整个配置区**，避免闪一下；
 *   - 过滤框里输入列表里没有的词时，列表底部出现「使用「xx」」——
 *     标准清单不可能穷尽所有企业口径，留这个窄口子免得清单外的东西没法加。
 */

/** 当前值不在清单里时，把它插到列表最前面（老配置带过来的自定义值） */
function rsOptions(options, value) {
  const list = options.slice();
  if (value && list.indexOf(value) < 0) list.unshift(value);
  return list;
}

/**
 * 生成一个单选下拉的 HTML。
 * @param {string} scope   回定位数据用的 data-* 属性串（含 data-field）
 * @param {string[]} options 选项清单
 * @param {string} value   当前值
 * @param {string} placeholder 未选时的占位文案
 */
function rsHtml(scope, options, value, placeholder) {
  const fields = rsOptions(options, value).map(function (o) {
    return '<button type="button" class="rs-opt' + (o === value ? ' is-active' : '') + '" data-v="' + rcEsc(o) + '">' + rcEsc(o) + '</button>';
  }).join('');

  return '<div class="rs' + (value ? '' : ' is-empty') + '">'
    + '<button type="button" class="rs-field" ' + scope + '>'
    + '<span class="rs-text">'
    + (value ? rcEsc(value) : '<span class="rs-ph">' + rcEsc(placeholder) + '</span>')
    + '</span>'
    + '</button>'
    + '<svg class="rs-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>'
    + '<div class="rs-panel">'
    + '<div class="rs-search"><input type="text" class="rs-search-input" placeholder="输入可快速筛选" /></div>'
    + '<div class="rs-list">' + fields
    + '<button type="button" class="rs-opt rs-opt-custom" hidden></button>'
    + '</div>'
    + '</div>'
    + '</div>';
}

/** 关掉所有展开中的下拉（单选下拉 + 多选下拉） */
function closeDropdowns() {
  document.querySelectorAll('.rs.open, .ms.open').forEach(function (el) { el.classList.remove('open'); });
}

/** 按关键字过滤下拉面板里的选项，并决定要不要给出「使用自定义值」入口 */
function rsFilter(box, q) {
  const kw = String(q == null ? '' : q).trim();
  const lower = kw.toLowerCase();
  const list = box.querySelectorAll('.rs-opt:not(.rs-opt-custom)');
  let exact = false;

  Array.prototype.forEach.call(list, function (o) {
    const match = !lower || o.dataset.v.toLowerCase().indexOf(lower) >= 0;
    o.hidden = !match;
    if (lower && o.dataset.v.toLowerCase() === lower) exact = true;
  });

  const custom = box.querySelector('.rs-opt-custom');
  // 清单里已经有完全一样的词、或没输入关键字 → 不给自定义入口
  if (kw && !exact) {
    custom.hidden = false;
    custom.dataset.v = kw;
    custom.textContent = '使用「' + kw + '」';
  } else {
    custom.hidden = true;
    custom.removeAttribute('data-v');
  }
}

/**
 * 把下拉选中的值写进配置数据。
 * 物料用 data-mi 定位，参数名称 / 单位再用 data-pi 定位到具体参数。
 */
function rsApply(el, value) {
  const tag = el.dataset.tag;
  const m = (RC.data[tag] || [])[+el.dataset.mi];
  if (!m) return;

  if (el.dataset.field === 'material') {
    m.material = value;
    return;
  }
  const p = m.params[+el.dataset.pi];
  if (p) p[el.dataset.field] = value;
}

/** 选中后只更新这一个下拉的显示，不重画配置区 */
function rsPaint(box, value) {
  box.querySelector('.rs-text').textContent = value;
  box.classList.toggle('is-empty', !value);
  box.querySelectorAll('.rs-opt').forEach(function (o) {
    o.classList.toggle('is-active', o.dataset.v === value);
  });
}

/* ============================================================
 * 第 3 步：物料与参数配置
 * ============================================================ */

function rcCountParams(mats) {
  return mats.reduce(function (n, m) { return n + m.params.length; }, 0);
}

function rcRenderBlocks() {
  const wrap = document.getElementById('rc-blocks');

  if (!RC.tags.length) {
    wrap.innerHTML = '<div class="rc-empty-tip">请先在上方「行业填报标签」中选择标签，选中的标签会在这里生成配置区。</div>';
    return;
  }

  wrap.innerHTML = RC.tags.map(function (tag) {
    const mats = RC.data[tag] || (RC.data[tag] = []);
    const matCount = mats.length;
    const paramCount = rcCountParams(mats);

    const head =
      '<div class="rc-block-head">'
      + '<span class="rc-block-name">' + rcEsc(tag) + '</span>'
      + '<span class="rc-block-meta">' + matCount + ' 个物料 · ' + paramCount + ' 个参数项</span>'
      + '<button type="button" class="btn btn-primary btn-sm rc-add-mat" data-tag="' + rcEsc(tag) + '">+ 添加物料</button>'
      + '</div>';

    let body;
    if (!matCount) {
      body = '<div class="rc-block-empty">'
        + '<p>「' + rcEsc(tag) + '」下还没有物料</p>'
        + '<button type="button" class="btn btn-primary btn-sm rc-add-mat" data-tag="' + rcEsc(tag) + '">+ 添加物料</button>'
        + '</div>';
    } else {
      body = mats.map(function (m, mi) {
        return rcRenderMaterial(tag, m, mi);
      }).join('');
    }

    return '<div class="rc-block">' + head + '<div class="rc-block-body">' + body + '</div></div>';
  }).join('');
}

function rcRenderMaterial(tag, m, mi) {
  const rows = m.params.length
    ? m.params.map(function (p, pi) {
      const scope = 'data-tag="' + rcEsc(tag) + '" data-mi="' + mi + '" data-pi="' + pi + '"';
      return '<tr>'
        + '<td>' + rsHtml(scope + ' data-field="name"', RC_PARAM_NAMES, p.name, '请选择参数') + '</td>'
        + '<td>' + rsHtml(scope + ' data-field="unit"', RC_UNITS, p.unit, '请选择单位') + '</td>'
        + '<td><input type="number" min="0" max="6" class="rc-input rc-p" data-tag="' + rcEsc(tag) + '" data-mi="' + mi + '" data-pi="' + pi + '" data-field="decimals" value="' + rcEsc(p.decimals) + '" /></td>'
        + '<td class="rc-act"><button type="button" class="rc-link rc-link-danger rc-del-param" data-tag="' + rcEsc(tag) + '" data-mi="' + mi + '" data-pi="' + pi + '">删除</button></td>'
        + '</tr>';
    }).join('')
    : '<tr><td colspan="4" class="rc-param-empty">该物料下还没有参数项，点右侧「+ 添加参数」</td></tr>';

  return '<div class="rc-mat">'
    + '<div class="rc-mat-head">'
    + '<span class="rc-mat-label">物料</span>'
    + rsHtml('data-field="material" data-tag="' + rcEsc(tag) + '" data-mi="' + mi + '"', RC_MATERIALS, m.material, '请选择物料')
    + '<span class="rc-mat-count">' + m.params.length + ' 个参数项</span>'
    + '<button type="button" class="rc-link rc-add-param" data-tag="' + rcEsc(tag) + '" data-mi="' + mi + '">+ 添加参数</button>'
    + '<button type="button" class="rc-link rc-link-danger rc-del-mat" data-tag="' + rcEsc(tag) + '" data-mi="' + mi + '">删除物料</button>'
    + '</div>'
    + '<table class="rc-table">'
    + '<thead><tr>'
    + '<th class="rc-col-pname">参数名称</th>'
    + '<th class="rc-col-unit">单位</th>'
    + '<th class="rc-col-dec">保留小数位数</th>'
    + '<th class="rc-col-act">操作</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>'
    + '</div>';
}

/* ============================================================
 * 事件
 * ============================================================ */

function rcBindBlocks() {
  const wrap = document.getElementById('rc-blocks');

  wrap.addEventListener('click', function (e) {
    const t = e.target;

    // --- 单选下拉：选了一个选项 ---
    const opt = t.closest('.rs-opt');
    if (opt && opt.dataset.v != null) {
      const box = opt.closest('.rs');
      const field = box.querySelector('.rs-field');
      const v = opt.dataset.v;
      rsApply(field, v);
      rsPaint(box, v);
      box.classList.remove('open');
      return;
    }

    // --- 单选下拉：展开 / 收起 ---
    const field = t.closest('.rs-field');
    if (field) {
      const box = field.closest('.rs');
      const wasOpen = box.classList.contains('open');
      closeDropdowns();
      if (!wasOpen) {
        box.classList.add('open');
        const search = box.querySelector('.rs-search-input');
        search.value = '';
        rsFilter(box, '');
        search.focus();
        // 当前选中项在长清单里可能排在很后面，展开时滚到它，省得用户自己翻
        const active = box.querySelector('.rs-opt.is-active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      }
      return;
    }

    // 点下拉面板的空白区（搜索框、列表留白）不要触发收起
    if (t.closest('.rs-panel')) return;

    const addMat = t.closest('.rc-add-mat');
    if (addMat) {
      const tag = addMat.dataset.tag;
      (RC.data[tag] || (RC.data[tag] = [])).push({
        material: '',
        params: [{ name: '', unit: '', decimals: 2 }],
      });
      rcRenderBlocks();
      return;
    }

    const delMat = t.closest('.rc-del-mat');
    if (delMat) {
      const mats = RC.data[delMat.dataset.tag] || [];
      mats.splice(+delMat.dataset.mi, 1);
      rcRenderBlocks();
      return;
    }

    const addParam = t.closest('.rc-add-param');
    if (addParam) {
      const m = (RC.data[addParam.dataset.tag] || [])[+addParam.dataset.mi];
      if (!m) return;
      m.params.push({ name: '', unit: '', decimals: 2 });
      rcRenderBlocks();
      return;
    }

    const delParam = t.closest('.rc-del-param');
    if (delParam) {
      const m = (RC.data[delParam.dataset.tag] || [])[+delParam.dataset.mi];
      if (!m) return;
      m.params.splice(+delParam.dataset.pi, 1);
      rcRenderBlocks();
    }
  });

  // 下拉的过滤框：一边输入一边筛选项
  wrap.addEventListener('input', function (e) {
    const search = e.target.closest('.rs-search-input');
    if (search) rsFilter(search.closest('.rs'), search.value);
  });

  // 过滤框里按回车 = 选中列表里第一项（或那个自定义值）
  wrap.addEventListener('keydown', function (e) {
    const search = e.target.closest('.rs-search-input');
    if (!search || e.key !== 'Enter') return;
    e.preventDefault();
    const box = search.closest('.rs');
    const first = box.querySelector('.rs-opt:not([hidden])');
    if (first && first.dataset.v != null) first.click();
  });

  // 只改数据、不重画，避免输入时丢焦点（保留小数位数仍走这里）
  const onChange = function (e) {
    const el = e.target.closest('.rc-p');
    if (!el) return;
    const m = (RC.data[el.dataset.tag] || [])[+el.dataset.mi];
    if (!m) return;
    const p = m.params[+el.dataset.pi];
    if (!p) return;
    p[el.dataset.field] = el.dataset.field === 'decimals' ? Number(el.value) : el.value;
  };

  wrap.addEventListener('input', onChange);
  wrap.addEventListener('change', onChange);
}

function rcBindPage() {
  document.getElementById('rc-back').addEventListener('click', function (e) {
    e.preventDefault();
    if (history.length > 1) history.back();
    else location.href = 'month-report.html';
  });

  document.getElementById('rc-save').addEventListener('click', function () {
    if (!RC.lines.length) { toast('请先选择报送生产线信息'); return; }
    if (!RC.tags.length) { toast('请先选择行业填报标签'); return; }

    // 简单校验：标签下至少一个物料，且物料与参数名称都不为空
    for (let i = 0; i < RC.tags.length; i++) {
      const tag = RC.tags[i];
      const mats = RC.data[tag] || [];
      if (!mats.length) { toast('「' + tag + '」下还没有物料'); return; }
      for (let j = 0; j < mats.length; j++) {
        if (!String(mats[j].material).trim()) { toast('「' + tag + '」下有物料未填名称'); return; }
        for (let k = 0; k < mats[j].params.length; k++) {
          if (!String(mats[j].params[k].name).trim()) {
            toast('「' + tag + ' - ' + mats[j].material + '」有参数未填名称');
            return;
          }
        }
      }
    }

    if (!rcSaveConfig(RC)) {
      toast('保存失败：浏览器存储不可用');
      return;
    }

    // 保存成功 → 关闭本页，回到「立即上报」界面（带回原来的年月）
    location.href = rcReportUrl();
  });

  document.getElementById('rc-cancel').addEventListener('click', function () {
    // 取消 = 不保存、直接回「立即上报」界面（已保存的配置不受影响，下次进来仍是上次保存的）
    location.href = rcReportUrl();
  });

  // 点空白处收起下拉（单选下拉 + 多选下拉）
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.ms') && !e.target.closest('.rs')) closeDropdowns();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDropdowns();
  });
}

/* ---------- 初始化 ---------- */

function rcRender() {
  createMultiSelect(document.getElementById('rc-lines'), RC_LINES, RC.lines, null);
  createMultiSelect(document.getElementById('rc-tags'), RC_TAGS, RC.tags, rcRenderBlocks);
  rcRenderBlocks();
}

function initReportConfigPage() {
  // 读配置（存储缺失/损坏时自动回到默认）；选项清单调整后旧配置会被过滤
  RC = rcLoadConfig();

  rcRender();
  rcBindBlocks();
  rcBindPage();
}

if (document.querySelector('.config-page')) initReportConfigPage();
