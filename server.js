const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const rootDir = __dirname;
const dataFilePath = path.join(rootDir, 'data', 'ToolConfig.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'VinodPatilTR';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Tctoolmanager';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'data/ToolConfig.json';
const USE_GITHUB_STORAGE = Boolean(GITHUB_TOKEN);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

function githubPathEncode(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

async function githubRequest(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options && options.headers ? options.headers : {})
    }
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err && err.message) detail = err.message;
    } catch (e) {
      // keep fallback detail
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function readStoreWithMeta() {
  if (!USE_GITHUB_STORAGE) {
    const raw = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.tools || !Array.isArray(parsed.tools)) {
      parsed.tools = [];
    }
    return { store: parsed, sha: null };
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPathEncode(GITHUB_FILE_PATH)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const data = await githubRequest(url, { method: 'GET' });
  const raw = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.tools || !Array.isArray(parsed.tools)) {
    parsed.tools = [];
  }
  return { store: parsed, sha: data.sha || null };
}

async function writeStore(store, sha) {
  const output = JSON.stringify(store, null, 2) + '\n';
  if (!USE_GITHUB_STORAGE) {
    await fs.writeFile(dataFilePath, output, 'utf8');
    return;
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPathEncode(GITHUB_FILE_PATH)}`;
  const body = {
    message: 'Update ToolConfig.json via API',
    content: Buffer.from(output, 'utf8').toString('base64'),
    branch: GITHUB_BRANCH,
    ...(sha ? { sha } : {})
  };
  await githubRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function normalizeTool(input) {
  return {
    id: Number(input.id),
    toolname: String(input.toolname || '').trim(),
    tooldescription: String(input.tooldescription || '').trim(),
    toolurl: String(input.toolurl || '').trim(),
    createddatetime: String(input.createddatetime || '').trim(),
    createdby: String(input.createdby || '').trim(),
    ToolActive: Number(input.ToolActive) === 1 ? 1 : 0,
    Totaluserclickcount: Number(input.Totaluserclickcount) || 0,
    Remark: String(input.Remark || '').trim()
  };
}

function validateRequired(tool) {
  if (!tool.toolname) return 'toolname is required';
  if (!tool.toolurl) return 'toolurl is required';
  if (!tool.createdby) return 'createdby is required';
  return null;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function toFilePath(urlPath) {
  const cleanedPath = urlPath === '/' ? '/ToolConfigManager_6.html' : urlPath;
  const safePath = path.normalize(cleanedPath).replace(/^([.][.][/\\])+/, '');
  return path.join(rootDir, safePath);
}

async function serveStatic(req, res, pathname) {
  try {
    const filePath = toFilePath(pathname);
    if (!filePath.startsWith(rootDir)) {
      sendText(res, 403, 'Forbidden');
      return;
    }
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendText(res, 404, 'Not Found');
      return;
    }
    sendJson(res, 500, { error: 'Failed to read file', detail: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/api/tools') {
      const { store } = await readStoreWithMeta();
      sendJson(res, 200, store.tools);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/tools') {
      const input = await readJsonBody(req);
      const { store, sha } = await readStoreWithMeta();
      const payload = normalizeTool(input || {});
      payload.id = Math.max(0, ...store.tools.map(t => Number(t.id) || 0)) + 1;

      if (!payload.createddatetime) {
        const date = new Date();
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        payload.createddatetime = `${dd}-${mm}-${yyyy}`;
      }

      const validationError = validateRequired(payload);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      store.tools.push(payload);
      await writeStore(store, sha);
      sendJson(res, 201, payload);
      return;
    }

    const putMatch = pathname.match(/^\/api\/tools\/(\d+)$/);
    if (req.method === 'PUT' && putMatch) {
      const id = Number(putMatch[1]);
      const input = await readJsonBody(req);
      const { store, sha } = await readStoreWithMeta();
      const idx = store.tools.findIndex(t => Number(t.id) === id);
      if (idx === -1) {
        sendJson(res, 404, { error: 'Tool not found' });
        return;
      }

      const merged = normalizeTool({ ...store.tools[idx], ...input, id });
      const validationError = validateRequired(merged);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      store.tools[idx] = merged;
      await writeStore(store, sha);
      sendJson(res, 200, merged);
      return;
    }

    const clickMatch = pathname.match(/^\/api\/tools\/(\d+)\/click$/);
    if (req.method === 'PATCH' && clickMatch) {
      const id = Number(clickMatch[1]);
      const { store, sha } = await readStoreWithMeta();
      const idx = store.tools.findIndex(t => Number(t.id) === id);
      if (idx === -1) {
        sendJson(res, 404, { error: 'Tool not found' });
        return;
      }

      const current = Number(store.tools[idx].Totaluserclickcount) || 0;
      store.tools[idx].Totaluserclickcount = current + 1;
      await writeStore(store, sha);
      sendJson(res, 200, store.tools[idx]);
      return;
    }

    const delMatch = pathname.match(/^\/api\/tools\/(\d+)$/);
    if (req.method === 'DELETE' && delMatch) {
      const id = Number(delMatch[1]);
      const { store, sha } = await readStoreWithMeta();
      const before = store.tools.length;
      store.tools = store.tools.filter(t => Number(t.id) !== id);

      if (store.tools.length === before) {
        sendJson(res, 404, { error: 'Tool not found' });
        return;
      }

      await writeStore(store, sha);
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: 'Internal server error', detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`TC Tool API running at http://localhost:${PORT}`);
});
