var flowDraft = null;
var docsServerReady = false;

function getFlowchartSrc(data) {
  if (!data) return '';
  var src = data.dataUrl || data.filePath || '';
  if (!src || data.dataUrl) return src;
  // 文件路径加时间戳，避免保存后浏览器缓存旧图
  var stamp = data.savedAt ? encodeURIComponent(String(data.savedAt)) : String(Date.now());
  return src + (src.indexOf('?') >= 0 ? '&' : '?') + 't=' + stamp;
}

function peekLocalFlowchart() {
  try {
    if (localStorage.getItem(FLOWCHART_CLEARED_KEY)) return null;
    var raw = localStorage.getItem(FLOWCHART_KEY);
    if (!raw) return null;
    var stored = JSON.parse(raw);
    if (stored && (stored.dataUrl || stored.filePath)) return stored;
  } catch (e) { /* ignore */ }
  return null;
}

/** 优先读取代码包内置数据（GitHub 可见），浏览器暂存仅作未同步草稿提示 */
function loadFlowchart() {
  if (typeof DEFAULT_FLOWCHART !== 'undefined') {
    if (DEFAULT_FLOWCHART.cleared) return null;
    if (DEFAULT_FLOWCHART.filePath || DEFAULT_FLOWCHART.dataUrl) {
      return Object.assign({}, DEFAULT_FLOWCHART);
    }
  }
  return null;
}

function clearLocalFlowchartCache() {
  try {
    localStorage.removeItem(FLOWCHART_KEY);
    localStorage.removeItem(FLOWCHART_CLEARED_KEY);
  } catch (e) { /* ignore */ }
}

function updateFlowDeleteBtn(data) {
  var btn = document.getElementById('btn-flow-delete');
  if (!btn) return;
  btn.disabled = !(data && (data.dataUrl || data.filePath));
}

function renderFlowPreview(data) {
  var wrap = document.getElementById('flow-preview');
  var src = getFlowchartSrc(data);
  if (!data || !src) {
    wrap.innerHTML =
      '<div class="flow-empty">'
      + '<div class="flow-empty-icon">📋</div>'
      + '<p>请上传流程图图片或 PDF 文件</p>'
      + '<p class="flow-empty-sub">支持 jpg、png、gif、webp、pdf，建议不超过 5MB；保存后写入代码包，提交 GitHub 后他人可见</p>'
      + '</div>';
    return;
  }

  if (data.fileType === 'application/pdf' || /\.pdf$/i.test(data.fileName || '') || /\.pdf$/i.test(data.filePath || '')) {
    wrap.innerHTML = '<iframe class="flow-pdf" src="' + src + '" title="流程图预览"></iframe>';
    return;
  }

  wrap.innerHTML = '<div class="flow-image-box"><img class="flow-image" src="' + src + '" alt="整体流程图" /></div>';
}

function updateFlowMeta(data) {
  var nameEl = document.getElementById('flow-file-name');
  var hintEl = document.getElementById('flow-save-hint');
  if (!data || !(data.dataUrl || data.filePath)) {
    nameEl.textContent = '未选择文件';
    hintEl.textContent = docsServerReady ? '保存将写入代码包文件' : '未检测到本地服务，请先 npm start';
    return;
  }
  nameEl.textContent = data.fileName || '未命名文件';
  if (data.savedAt && data.filePath && !data.dataUrl) {
    hintEl.textContent = '已保存到代码包 · ' + data.savedAt;
  } else if (data.dataUrl) {
    hintEl.textContent = '已选择，请点击保存写入代码包';
  } else if (data.savedAt) {
    hintEl.textContent = '内置数据 · ' + data.savedAt;
  } else {
    hintEl.textContent = '请点击保存';
  }
}

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

function persistFlowchartToRepo(draft) {
  return docsApi(docsApiPath(currentModuleId(), 'flowchart'), {
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

function deleteFlowchartFromRepo() {
  return docsApi(docsApiPath(currentModuleId(), 'flowchart'), { method: 'DELETE' });
}

function initFlowchartPage() {
  // 流程图是两个模块共用的一页，靠 ?module= 决定挂哪个模块的侧栏、读写哪个模块的文件
  initLayout('flowchart', { moduleId: currentModuleId(), pageTitle: '整体流程图' });

  var saved = loadFlowchart();
  flowDraft = saved ? Object.assign({}, saved) : null;
  renderFlowPreview(flowDraft);
  updateFlowMeta(flowDraft);
  updateFlowDeleteBtn(flowDraft);

  var localDraft = peekLocalFlowchart();
  if (localDraft && localDraft.dataUrl) {
    var repoHasFlow = !!(saved && (saved.filePath || saved.dataUrl));
    var differentName = localDraft.fileName && saved && localDraft.fileName !== saved.fileName;
    if (!repoHasFlow || differentName || localDraft.dataUrl) {
      if (confirm('检测到浏览器中有未同步的流程图。\n\n是否加载到预览区？加载后请再点击「保存到代码包」写入仓库文件。')) {
        flowDraft = Object.assign({}, localDraft, { savedAt: '' });
        renderFlowPreview(flowDraft);
        updateFlowMeta(flowDraft);
        updateFlowDeleteBtn(flowDraft);
      }
    }
  }

  checkDocsServer(currentModuleId()).then(function (ok) {
    docsServerReady = ok;
    updateServerBadge();
    updateFlowMeta(flowDraft);
  });

  document.getElementById('flow-upload').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var isImage = /^image\//.test(file.type);
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isImage && !isPdf) {
      toast('仅支持图片或 PDF 文件');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('文件过大，请控制在 5MB 以内');
      e.target.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      flowDraft = {
        fileName: file.name,
        fileType: isPdf ? 'application/pdf' : file.type,
        dataUrl: reader.result,
        savedAt: '',
      };
      renderFlowPreview(flowDraft);
      updateFlowMeta(flowDraft);
      updateFlowDeleteBtn(flowDraft);
      toast(docsServerReady ? '已加载，请点击保存写入代码包' : '已加载，但需先 npm start 才能保存到代码包');
    };
    reader.onerror = function () {
      toast('文件读取失败');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  document.getElementById('btn-flow-save').addEventListener('click', function () {
    if (!flowDraft || !(flowDraft.dataUrl || flowDraft.filePath)) {
      toast('请先上传流程图文件');
      return;
    }
    if (!docsServerReady) {
      toast(docsServerRequiredTip());
      return;
    }
    var btn = document.getElementById('btn-flow-save');
    btn.disabled = true;
    persistFlowchartToRepo(flowDraft).then(function (res) {
      flowDraft = Object.assign({}, res.flowchart);
      clearLocalFlowchartCache();
      renderFlowPreview(flowDraft);
      updateFlowMeta(flowDraft);
      updateFlowDeleteBtn(flowDraft);
      toast('流程图已写入代码包，请提交 GitHub');
    }).catch(function (err) {
      docsServerReady = false;
      updateServerBadge();
      toast((err && err.message) || docsServerRequiredTip());
    }).then(function () {
      btn.disabled = false;
    });
  });

  document.getElementById('btn-flow-delete').addEventListener('click', function () {
    if (!flowDraft || !(flowDraft.dataUrl || flowDraft.filePath)) return;
    if (!confirm('确认删除当前流程图？删除后将从代码包中移除，需重新提交 GitHub。')) return;
    if (!docsServerReady) {
      toast(docsServerRequiredTip());
      return;
    }
    deleteFlowchartFromRepo().then(function () {
      flowDraft = null;
      clearLocalFlowchartCache();
      renderFlowPreview(null);
      updateFlowMeta(null);
      updateFlowDeleteBtn(null);
      toast('流程图已从代码包删除');
    }).catch(function (err) {
      docsServerReady = false;
      updateServerBadge();
      toast((err && err.message) || docsServerRequiredTip());
    });
  });
}

if (document.querySelector('.flowchart-page')) initFlowchartPage();
