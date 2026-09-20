/**
 * 本地静态服务 + 文档写入 API（按一级模块隔离）
 * 启动：npm start  或  node server.js
 *
 * 文档按模块分目录存：
 *   元信息  js/docs/{module}/doc-defaults.js
 *   文件体  assets/{module}/flowchart.*   assets/{module}/requirements.*
 * 接口：/api/docs/{module}/{status|flowchart|requirements}
 * 保存后把这些文件提交 GitHub，他人打开即见相同内容。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8088;
const DOCS_ROOT = path.join(ROOT, 'js', 'docs');
const ASSETS_ROOT = path.join(ROOT, 'assets');
// 需求说明支持上传 pdf / word / excel，单文件上限 20MB；base64 后约膨胀 1/3
const MAX_BODY = 32 * 1024 * 1024;

/**
 * 合法的模块 id（与 js/app.js 的 MODULES 对应）。
 * 白名单是为了防目录穿越 —— 模块 id 会拼进文件路径，
 * 不校验的话 /api/docs/../../etc/flowchart 这种请求能写到项目外面去。
 */
const MODULE_IDS = ['carbon', 'verify'];

function assertModuleId(id) {
  if (MODULE_IDS.indexOf(id) < 0) {
    const err = new Error('未知模块：' + id);
    err.status = 404;
    throw err;
  }
  return id;
}

function docsJsPath(moduleId) {
  return path.join(DOCS_ROOT, moduleId, 'doc-defaults.js');
}

function assetsDir(moduleId) {
  return path.join(ASSETS_ROOT, moduleId);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（上限 32MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** 空的文档槽位（已删除状态） */
function emptyDocSlot() {
  return { fileName: '', fileType: '', filePath: '', savedAt: '', cleared: true };
}

function ensureAssetsDir(moduleId) {
  const dir = assetsDir(moduleId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCurrentDefaults(moduleId) {
  const emptyDoc = { fileName: '', fileType: '', filePath: '', savedAt: '', cleared: true };
  const fallback = {
    flowchart: Object.assign({}, emptyDoc),
    requirements: Object.assign({}, emptyDoc),
  };
  const file = docsJsPath(moduleId);
  if (!fs.existsSync(file)) return fallback;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const sandbox = { DEFAULT_FLOWCHART: null, DEFAULT_REQUIREMENTS: null };
    vm.runInNewContext(text, sandbox, { timeout: 1000 });
    if (sandbox.DEFAULT_FLOWCHART) fallback.flowchart = sandbox.DEFAULT_FLOWCHART;
    if (sandbox.DEFAULT_REQUIREMENTS) fallback.requirements = sandbox.DEFAULT_REQUIREMENTS;
  } catch (e) {
    console.warn('[docs] 读取 ' + moduleId + '/doc-defaults.js 失败，将使用空默认值:', e.message);
  }
  return fallback;
}

function writeDocDefaults(moduleId, flowchart, requirements) {
  const dir = path.join(DOCS_ROOT, moduleId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = [
    '/**',
    ' * ' + moduleId + ' 模块内置文档数据（由本地服务 npm start 保存时自动写入）',
    ' * 提交本文件 + assets/' + moduleId + '/ 下的文档文件后，他人打开项目即可看到相同内容',
    ' */',
    'var DEFAULT_FLOWCHART = ' + JSON.stringify(flowchart, null, 2) + ';',
    '',
    'var DEFAULT_REQUIREMENTS = ' + JSON.stringify(requirements, null, 2) + ';',
    '',
  ].join('\n');
  fs.writeFileSync(docsJsPath(moduleId), content, 'utf8');
}

function extFor(fileName, fileType) {
  const m = String(fileName || '').match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  if (fileType === 'application/pdf') return 'pdf';
  if (fileType === 'image/png') return 'png';
  if (fileType === 'image/jpeg') return 'jpg';
  if (fileType === 'image/gif') return 'gif';
  if (fileType === 'image/webp') return 'webp';
  if (fileType === 'image/svg+xml') return 'svg';
  if (fileType === 'application/msword') return 'doc';
  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (fileType === 'application/vnd.ms-excel') return 'xls';
  if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (fileType === 'text/markdown') return 'md';
  return 'bin';
}

/** 清理 assets/{module}/ 下某个前缀的全部文件（保留 keepName），用于换格式时删掉旧扩展名文件 */
function clearAssetsByPrefix(moduleId, prefix, keepName) {
  ensureAssetsDir(moduleId);
  const dir = assetsDir(moduleId);
  const re = new RegExp('^' + prefix + '\\.', 'i');
  fs.readdirSync(dir).forEach(function (name) {
    if (!re.test(name)) return;
    if (keepName && name === keepName) return;
    fs.unlinkSync(path.join(dir, name));
  });
}

function clearFlowchartAssets(moduleId, keepName) {
  clearAssetsByPrefix(moduleId, 'flowchart', keepName);
}

function clearRequirementsAssets(moduleId, keepName) {
  clearAssetsByPrefix(moduleId, 'requirements', keepName);
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('无效的文件数据');
  return {
    mime: m[1],
    buffer: Buffer.from(m[2], 'base64'),
  };
}

/**
 * 通用「上传文件 → 写入 assets/{module}/ + 记录到该模块的 doc-defaults.js」
 * @param {'flowchart'|'requirements'} slot 文档槽位
 * @param {string} moduleId 模块 id
 * @param {object} current loadCurrentDefaults(moduleId) 的结果
 * @param {object} body    请求体 { fileName, fileType, dataUrl, filePath, savedAt }
 */
function saveDocSlot(slot, moduleId, current, body) {
  if (!body.dataUrl && !body.filePath) {
    const err = new Error('缺少文件数据');
    err.status = 400;
    throw err;
  }

  if (!body.dataUrl) {
    // 仅更新元信息（不重传文件体）
    return {
      fileName: body.fileName || current[slot].fileName,
      fileType: body.fileType || current[slot].fileType,
      filePath: body.filePath,
      savedAt: body.savedAt || timestamp(),
      cleared: false,
    };
  }

  const decoded = decodeDataUrl(body.dataUrl);
  const fileType = body.fileType || decoded.mime;
  const fileName = body.fileName || (slot + '.' + extFor('', fileType));
  const assetName = slot + '.' + extFor(fileName, fileType);
  ensureAssetsDir(moduleId);
  // 先写新文件，成功后再清理该槽位其他格式的旧文件，避免写失败时把原文件删掉
  fs.writeFileSync(path.join(assetsDir(moduleId), assetName), decoded.buffer);
  clearAssetsByPrefix(moduleId, slot, assetName);
  return {
    fileName: fileName,
    fileType: fileType,
    filePath: 'assets/' + moduleId + '/' + assetName,
    savedAt: body.savedAt || timestamp(),
    cleared: false,
  };
}

async function handleSaveFlowchart(req, res, moduleId) {
  const body = await readBody(req);
  const current = loadCurrentDefaults(moduleId);
  const flowchart = saveDocSlot('flowchart', moduleId, current, body);
  writeDocDefaults(moduleId, flowchart, current.requirements);
  sendJson(res, 200, { ok: true, flowchart: flowchart, message: '流程图已写入代码包' });
}

async function handleDeleteFlowchart(req, res, moduleId) {
  const current = loadCurrentDefaults(moduleId);
  clearFlowchartAssets(moduleId, '');
  const flowchart = emptyDocSlot();
  writeDocDefaults(moduleId, flowchart, current.requirements);
  sendJson(res, 200, { ok: true, flowchart: flowchart, message: '流程图已从代码包删除' });
}

async function handleSaveRequirements(req, res, moduleId) {
  const body = await readBody(req);
  const current = loadCurrentDefaults(moduleId);
  const requirements = saveDocSlot('requirements', moduleId, current, body);
  writeDocDefaults(moduleId, current.flowchart, requirements);
  sendJson(res, 200, { ok: true, requirements: requirements, message: '需求说明已写入代码包' });
}

async function handleDeleteRequirements(req, res, moduleId) {
  const current = loadCurrentDefaults(moduleId);
  clearRequirementsAssets(moduleId, '');
  const requirements = emptyDocSlot();
  writeDocDefaults(moduleId, current.flowchart, requirements);
  sendJson(res, 200, { ok: true, requirements: requirements, message: '需求说明已从代码包删除' });
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const cleaned = decoded.replace(/^\/+/, '');
  const full = path.normalize(path.join(root, cleaned || 'index.html'));
  if (!full.startsWith(root)) return null;
  return full;
}

function serveStatic(req, res, pathname) {
  let filePath = safeJoin(ROOT, pathname === '/' ? '/index.html' : pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // 文档文件按模块放在 assets/{module}/ 下，换文件后要能立刻看到新的，所以同 html/js/css 一样不缓存
  const noCache = ext === '.js' || ext === '.html' || ext === '.css'
    || /^\/assets\/[^/]+\/(flowchart|requirements)\./.test(pathname);
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': noCache ? 'no-store' : 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async function (req, res) {
  const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsed.pathname;
  const method = req.method || 'GET';

  try {
    // 文档接口：/api/docs/{module}/{status|flowchart|requirements}
    const docMatch = pathname.match(/^\/api\/docs\/([^/]+)\/([a-z]+)$/);
    if (docMatch) {
      const moduleId = assertModuleId(decodeURIComponent(docMatch[1]));
      const kind = docMatch[2];

      if (kind === 'status' && method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          mode: 'file',
          module: moduleId,
          message: '文档写入服务已就绪，保存将写入仓库文件',
        });
        return;
      }
      if (kind === 'flowchart' && method === 'POST') {
        await handleSaveFlowchart(req, res, moduleId);
        return;
      }
      if (kind === 'flowchart' && method === 'DELETE') {
        await handleDeleteFlowchart(req, res, moduleId);
        return;
      }
      if (kind === 'requirements' && method === 'POST') {
        await handleSaveRequirements(req, res, moduleId);
        return;
      }
      if (kind === 'requirements' && method === 'DELETE') {
        await handleDeleteRequirements(req, res, moduleId);
        return;
      }
      sendJson(res, 405, { ok: false, message: '方法不允许' });
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      serveStatic(req, res, pathname);
      return;
    }
    sendJson(res, 405, { ok: false, message: '方法不允许' });
  } catch (err) {
    console.error('[server]', err);
    sendJson(res, err.status || 500, { ok: false, message: err.message || '服务器错误' });
  }
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  console.log('  双碳管理平台原型服务已启动');
  console.log('  地址: http://127.0.0.1:' + PORT + '/');
  console.log('  流程图 / 需求说明 点击「保存」按模块写入:');
  console.log('    - js/docs/{' + MODULE_IDS.join('|') + '}/doc-defaults.js');
  console.log('    - assets/{' + MODULE_IDS.join('|') + '}/flowchart.*  requirements.*');
  console.log('  保存后请把上述文件一并提交到 GitHub');
  console.log('');
});
