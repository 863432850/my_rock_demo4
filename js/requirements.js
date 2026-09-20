/**
 * 需求说明/注意事项 —— 上传文件 + 在线预览
 *
 * 与「整体流程图」保持同一套保存逻辑：
 *   文件体   → assets/requirements.<ext>
 *   元信息   → js/doc-defaults.js 的 DEFAULT_REQUIREMENTS
 *
 * 支持格式与预览方式：
 *   pdf          浏览器原生 iframe 预览
 *   docx         mammoth 转 HTML 渲染
 *   xlsx / xls   SheetJS 解析后按工作表渲染成表格
 *   md/markdown  marked 渲染
 *
 * 解析库在 vendor/ 下，随代码包一起走，离线可用。
 */
var docsServerReady = false;
var reqDraft = null;        // 当前文档 { fileName, fileType, filePath, dataUrl, savedAt }
var reqRenderToken = 0;     // 异步渲染令牌，防止快速换文件时旧结果覆盖新结果
var xlsxBook = null;        // 已解析的工作簿缓存
var xlsxActive = 0;         // 当前展示的工作表下标

var MAX_DOC_SIZE = 20 * 1024 * 1024;
var XLSX_MAX_ROWS = 500;    // 表格预览最多渲染行数，避免超大表卡死
var XLSX_MAX_COLS = 50;

/* ============================================================
 * 一、类型判定与数据读取
 * ============================================================ */

/** 取文档扩展名 */
function reqExt(doc) {
  if (!doc) return '';
  var name = doc.fileName || doc.filePath || '';
  var m = String(name).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

/** 归一化文档类型：pdf / docx / docx-legacy / xlsx / md / '' */
function reqKind(doc) {
  var ext = reqExt(doc);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc-legacy';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return '';
}

function reqKindLabel(doc) {
  var map = { pdf: 'PDF', docx: 'Word', 'doc-legacy': 'Word（旧版 .doc）', xlsx: 'Excel', md: 'Markdown' };
  return map[reqKind(doc)] || '未知格式';
}

/** 预览地址：已保存的走文件路径，并加时间戳避免浏览器缓存旧文件 */
function reqSrc(doc) {
  var src = doc.dataUrl || doc.filePath || '';
  if (!src || doc.dataUrl) return src;
  var stamp = doc.savedAt ? encodeURIComponent(String(doc.savedAt)) : String(Date.now());
  return src + (src.indexOf('?') >= 0 ? '&' : '?') + 't=' + stamp;
}

function reqDataUrlToBuffer(dataUrl) {
  var m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('无效的文件数据');
  if (!m[2]) throw new Error('文件内容为空');   // 0 字节文件
  var bin = atob(m[2]);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 拿到文件的二进制内容：新上传的从 dataUrl 解，已保存的从服务端取 */
function reqBuffer(doc) {
  if (doc.dataUrl) {
    return new Promise(function (resolve) { resolve(reqDataUrlToBuffer(doc.dataUrl)); });
  }
  return fetch(reqSrc(doc), { cache: 'no-store' }).then(function (res) {
    if (!res.ok) throw new Error('文件读取失败（HTTP ' + res.status + '），请确认文件已在代码包中');
    return res.arrayBuffer();
  });
}

/**
 * 解码文本：优先 UTF-8；若出现替换字符（U+FFFD）说明原文件多半是 GBK/GB18030，
 * 国内需求文档常见，这里自动回退一次，避免中文乱码。
 */
function decodeTextSmart(buf) {
  var bytes = new Uint8Array(buf);
  var text = new TextDecoder('utf-8').decode(bytes);
  if (text.indexOf('\uFFFD') === -1) return text;
  try {
    var gbk = new TextDecoder('gb18030').decode(bytes);
    // 只有 GBK 解出来确实更干净时才采用
    if (gbk.indexOf('\uFFFD') === -1) return gbk;
  } catch (e) { /* 浏览器不支持 gb18030 时忽略 */ }
  return text;
}

/** 拿到文件的文本内容（markdown 用） */
function reqText(doc) {
  return reqBuffer(doc).then(function (buf) {
    return decodeTextSmart(buf);
  });
}

/* ============================================================
 * 二、HTML 清洗（本地原型也顺手防一下脚本注入）
 * ============================================================ */

function reqSanitize(html) {
  var tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form').forEach(function (el) {
    el.remove();
  });
  tpl.content.querySelectorAll('*').forEach(function (el) {
    Array.prototype.slice.call(el.attributes).forEach(function (attr) {
      var name = attr.name.toLowerCase();
      var value = String(attr.value || '');
      if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name);
    });
  });
  return tpl.innerHTML;
}

/* ============================================================
 * 三、预览渲染
 * ============================================================ */

function reqNextToken() { return ++reqRenderToken; }

function reqEmptyHtml() {
  return '<div class="flow-empty">'
    + '<div class="flow-empty-icon">📄</div>'
    + '<p>请上传需求说明文件</p>'
    + '<p class="flow-empty-sub">支持 pdf、word（docx）、excel（xlsx / xls）、markdown（md），'
    + '建议不超过 20MB；保存后写入代码包，提交 GitHub 后他人可见</p>'
    + '</div>';
}

function reqLoadingHtml(text) {
  return '<div class="doc-loading"><span class="doc-spinner"></span>' + (text || '正在解析文件…') + '</div>';
}

function reqErrorHtml(msg) {
  return '<div class="doc-error"><div class="doc-error-icon">⚠️</div><p>' + msg + '</p></div>';
}

function renderDocPreview(doc) {
  var wrap = document.getElementById('req-preview');
  if (!wrap) return;

  if (!doc || !(doc.dataUrl || doc.filePath)) {
    wrap.innerHTML = reqEmptyHtml();
    xlsxBook = null;
    return;
  }

  var kind = reqKind(doc);

  if (kind === 'pdf') {
    wrap.innerHTML = '<iframe class="flow-pdf" src="' + reqSrc(doc) + '" title="需求说明预览"></iframe>';
    return;
  }

  if (kind === 'doc-legacy') {
    wrap.innerHTML = reqErrorHtml('暂不支持旧版 .doc 格式，请在 Word 中「另存为」.docx 后重新上传');
    return;
  }

  if (kind === 'docx') { renderDocx(doc); return; }
  if (kind === 'xlsx') { renderXlsx(doc); return; }
  if (kind === 'md') { renderMarkdown(doc); return; }

  wrap.innerHTML = reqErrorHtml('不支持的文件格式，请上传 pdf / docx / xlsx / xls / md 文件');
}

/** Word：mammoth 转 HTML */
function renderDocx(doc) {
  var wrap = document.getElementById('req-preview');
  wrap.innerHTML = reqLoadingHtml('正在解析 Word 文档…');
  var token = reqNextToken();

  reqBuffer(doc).then(function (buf) {
    if (typeof mammoth === 'undefined') throw new Error('解析库未加载（vendor/mammoth.browser.min.js）');
    return mammoth.convertToHtml({ arrayBuffer: buf });
  }).then(function (result) {
    if (token !== reqRenderToken) return;
    var html = reqSanitize(result.value || '');
    wrap.innerHTML = html.trim()
      ? '<div class="doc-paper"><div class="doc-render">' + html + '</div></div>'
      : reqErrorHtml('文档内容为空');
    if (result.messages && result.messages.length) {
      console.warn('[需求说明] mammoth 提示:', result.messages);
    }
  }).catch(function (err) {
    if (token !== reqRenderToken) return;
    wrap.innerHTML = reqErrorHtml('Word 解析失败：' + ((err && err.message) || '未知错误'));
  });
}

/** Excel：SheetJS 解析，按工作表渲染 */
function renderXlsx(doc) {
  var wrap = document.getElementById('req-preview');
  wrap.innerHTML = reqLoadingHtml('正在解析 Excel 表格…');
  var token = reqNextToken();

  reqBuffer(doc).then(function (buf) {
    if (typeof XLSX === 'undefined') throw new Error('解析库未加载（vendor/xlsx.full.min.js）');
    return XLSX.read(new Uint8Array(buf), { type: 'array' });
  }).then(function (wb) {
    if (token !== reqRenderToken) return;
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
      wrap.innerHTML = reqErrorHtml('表格中没有可显示的工作表');
      return;
    }
    xlsxBook = wb;
    xlsxActive = 0;
    paintXlsxSheet();
  }).catch(function (err) {
    if (token !== reqRenderToken) return;
    wrap.innerHTML = reqErrorHtml('Excel 解析失败：' + ((err && err.message) || '未知错误'));
  });
}

function paintXlsxSheet() {
  var wrap = document.getElementById('req-preview');
  if (!xlsxBook) return;

  var names = xlsxBook.SheetNames;
  var ws = xlsxBook.Sheets[names[xlsxActive]];
  var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });

  // 多工作表时顶部给一排切换页签
  var tabsHtml = names.length > 1
    ? '<div class="sheet-tabs">' + names.map(function (n, i) {
      return '<button type="button" class="sheet-tab' + (i === xlsxActive ? ' active' : '')
        + '" data-sheet="' + i + '">' + escapeHtml(n) + '</button>';
    }).join('') + '</div>'
    : '';

  if (!rows.length) {
    wrap.innerHTML = tabsHtml + reqErrorHtml('工作表「' + escapeHtml(names[xlsxActive]) + '」没有数据');
    bindSheetTabs();
    return;
  }

  var bodyRows = rows.slice(0, XLSX_MAX_ROWS);
  var truncated = rows.length > XLSX_MAX_ROWS;
  var colCount = Math.min(
    bodyRows.reduce(function (max, r) { return Math.max(max, r.length); }, 0),
    XLSX_MAX_COLS
  );

  var html = '<div class="doc-paper doc-paper-wide"><div class="sheet-meta">'
    + '<span>工作表：<b>' + escapeHtml(names[xlsxActive]) + '</b></span>'
    + '<span>共 ' + rows.length + ' 行</span>'
    + (names.length > 1 ? '<span>共 ' + names.length + ' 个工作表</span>' : '')
    + (truncated ? '<span class="sheet-warn">仅预览前 ' + XLSX_MAX_ROWS + ' 行</span>' : '')
    + '</div><div class="doc-table-wrap"><table class="doc-table"><thead><tr>'
    + '<th class="doc-rowno">#</th>';

  for (var c = 0; c < colCount; c++) {
    html += '<th>' + escapeHtml(bodyRows[0][c]) + '</th>';
  }
  html += '</tr></thead><tbody>';

  for (var r = 1; r < bodyRows.length; r++) {
    html += '<tr><td class="doc-rowno">' + r + '</td>';
    for (var k = 0; k < colCount; k++) {
      html += '<td>' + escapeHtml(bodyRows[r][k]) + '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table></div></div>';

  wrap.innerHTML = tabsHtml + html;
  bindSheetTabs();
}

function bindSheetTabs() {
  var wrap = document.getElementById('req-preview');
  if (!wrap) return;
  wrap.querySelectorAll('.sheet-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      xlsxActive = Number(btn.dataset.sheet) || 0;
      paintXlsxSheet();
    });
  });
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Markdown：marked 渲染 */
function renderMarkdown(doc) {
  var wrap = document.getElementById('req-preview');
  wrap.innerHTML = reqLoadingHtml('正在渲染 Markdown…');
  var token = reqNextToken();

  reqText(doc).then(function (text) {
    if (token !== reqRenderToken) return;
    if (typeof marked === 'undefined') throw new Error('解析库未加载（vendor/marked.min.js）');
    var html = reqSanitize(marked.parse(text || ''));
    wrap.innerHTML = html.trim()
      ? '<div class="doc-paper"><div class="doc-render doc-md">' + html + '</div></div>'
      : reqErrorHtml('文件内容为空');
  }).catch(function (err) {
    if (token !== reqRenderToken) return;
    wrap.innerHTML = reqErrorHtml('Markdown 渲染失败：' + ((err && err.message) || '未知错误'));
  });
}

/* ============================================================
 * 四、工具栏状态
 * ============================================================ */

function updateServerBadge() {
  var badge = document.getElementById('docs-server-badge');
  if (!badge) return;
  if (docsServerReady) {
    badge.textContent = '写入服务已连接';
    badge.className = 'docs-server-badge ok';
  } else {
    badge.textContent = '未连接写入服务（请 npm start）';
    badge.className = 'docs-server-badge warn';
  }
}

function updateReqMeta(doc) {
  var nameEl = document.getElementById('req-file-name');
  var hintEl = document.getElementById('req-save-hint');
  if (!nameEl || !hintEl) return;

  if (!doc || !(doc.dataUrl || doc.filePath)) {
    nameEl.textContent = '未选择文件';
    hintEl.textContent = docsServerReady ? '保存将写入代码包文件' : '未检测到本地服务，请先 npm start';
    return;
  }

  nameEl.textContent = doc.fileName || '未命名文件';
  var typeTag = ' · ' + reqKindLabel(doc);
  if (doc.dataUrl) {
    hintEl.textContent = '已选择' + typeTag + '，请点击保存写入代码包';
  } else if (doc.savedAt) {
    hintEl.textContent = '已保存到代码包' + typeTag + ' · ' + doc.savedAt;
  } else {
    hintEl.textContent = '请点击保存' + typeTag;
  }
}

function updateReqDeleteBtn(doc) {
  var btn = document.getElementById('btn-req-delete');
  if (!btn) return;
  btn.disabled = !(doc && (doc.dataUrl || doc.filePath));
}

/* ============================================================
 * 五、代码包读写
 * ============================================================ */

/** 优先读取代码包内置数据（提交 GitHub 后他人打开即可见） */
function loadRequirements() {
  if (typeof DEFAULT_REQUIREMENTS !== 'undefined') {
    if (DEFAULT_REQUIREMENTS.cleared) return null;
    if (DEFAULT_REQUIREMENTS.filePath || DEFAULT_REQUIREMENTS.dataUrl) {
      return Object.assign({}, DEFAULT_REQUIREMENTS);
    }
  }
  return null;
}

function persistRequirementsToRepo(draft) {
  return docsApi(docsApiPath(currentModuleId(), 'requirements'), {
    method: 'POST',
    body: {
      fileName: draft.fileName,
      fileType: draft.fileType,
      dataUrl: draft.dataUrl || undefined,
      filePath: draft.dataUrl ? undefined : draft.filePath,
      savedAt: nowText(),
    },
  });
}

function deleteRequirementsFromRepo() {
  return docsApi(docsApiPath(currentModuleId(), 'requirements'), { method: 'DELETE' });
}

/* ============================================================
 * 六、页面初始化
 * ============================================================ */

function initRequirementsPage() {
  // 需求说明是两个模块共用的一页，靠 ?module= 决定挂哪个模块的侧栏、读写哪个模块的文件
  initLayout('requirements', { moduleId: currentModuleId(), pageTitle: '需求说明/注意事项' });

  var uploadInput = document.getElementById('req-upload');
  var saveBtn = document.getElementById('btn-req-save');
  var deleteBtn = document.getElementById('btn-req-delete');

  reqDraft = loadRequirements();
  renderDocPreview(reqDraft);
  updateReqMeta(reqDraft);
  updateReqDeleteBtn(reqDraft);

  checkDocsServer(currentModuleId()).then(function (ok) {
    docsServerReady = ok;
    updateServerBadge();
    updateReqMeta(reqDraft);
  });

  uploadInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    if (['pdf', 'docx', 'xlsx', 'xls', 'md', 'markdown', 'doc'].indexOf(ext) === -1) {
      toast('仅支持 pdf、word、excel、markdown 文件');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_DOC_SIZE) {
      toast('文件过大，请控制在 20MB 以内（当前 ' + (file.size / 1024 / 1024).toFixed(1) + 'MB）');
      e.target.value = '';
      return;
    }
    if (file.size === 0) {
      toast('文件内容为空，请检查后重新上传');
      e.target.value = '';
      return;
    }

    var wrap = document.getElementById('req-preview');
    wrap.innerHTML = reqLoadingHtml('正在读取文件…');

    var reader = new FileReader();
    reader.onload = function () {
      reqDraft = {
        fileName: file.name,
        fileType: file.type || '',
        dataUrl: reader.result,
        savedAt: '',
      };
      renderDocPreview(reqDraft);
      updateReqMeta(reqDraft);
      updateReqDeleteBtn(reqDraft);
      toast(docsServerReady ? '已加载，请点击保存写入代码包' : '已加载，但需先 npm start 才能保存到代码包');
    };
    reader.onerror = function () {
      renderDocPreview(reqDraft);
      toast('文件读取失败');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  saveBtn.addEventListener('click', function () {
    if (!reqDraft || !(reqDraft.dataUrl || reqDraft.filePath)) {
      toast('请先上传需求说明文件');
      return;
    }
    if (!docsServerReady) {
      toast(docsServerRequiredTip());
      return;
    }
    saveBtn.disabled = true;
    persistRequirementsToRepo(reqDraft).then(function (res) {
      reqDraft = Object.assign({}, res.requirements);
      renderDocPreview(reqDraft);
      updateReqMeta(reqDraft);
      updateReqDeleteBtn(reqDraft);
      toast('需求说明已写入代码包，请提交 GitHub');
    }).catch(function (err) {
      docsServerReady = false;
      updateServerBadge();
      updateReqMeta(reqDraft);
      toast((err && err.message) || docsServerRequiredTip());
    }).then(function () {
      saveBtn.disabled = false;
    });
  });

  deleteBtn.addEventListener('click', function () {
    if (!reqDraft || !(reqDraft.dataUrl || reqDraft.filePath)) return;
    if (!confirm('确认删除当前需求说明文件？删除后将从代码包中移除，需重新提交 GitHub。')) return;
    if (!docsServerReady) {
      toast(docsServerRequiredTip());
      return;
    }
    deleteRequirementsFromRepo().then(function () {
      reqDraft = null;
      renderDocPreview(null);
      updateReqMeta(null);
      updateReqDeleteBtn(null);
      toast('需求说明已从代码包删除');
    }).catch(function (err) {
      docsServerReady = false;
      updateServerBadge();
      toast((err && err.message) || docsServerRequiredTip());
    });
  });
}

if (document.querySelector('.requirements-page')) initRequirementsPage();
