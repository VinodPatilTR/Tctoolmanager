/* eslint-disable no-console */
// TC Tool Manager — Azure SQL backend.
// Exposes the same /api/tools routes server.js does, but reads/writes
// dbo.TCToolConfig in Azure SQL Database instead of data/ToolConfig.json.
//
// Auth mirrors SSMS "Azure Active Directory - Universal with MFA":
//   1. Run once:  az login
//   2. Run:       npm run start:sql
//   3. Open:      http://localhost:3000/TCToolConfigManager.html
//
// Required env vars (set in PowerShell before running):
//   $env:SQL_SERVER   = "eu2-dev-taxcaddy-sqlsrv.database.windows.net"
//   $env:SQL_DATABASE = "<your-database-name>"
// Optional:
//   $env:SQL_AUTH     = "default" | "interactive" | "password"
//   $env:SQL_USER     = "<aad user>"   (password mode only — no MFA)
//   $env:SQL_PASSWORD = "<password>"   (password mode only — no MFA)
//   $env:PORT         = "3000"

const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { URL } = require('url');
const sql = require('mssql');
const { InteractiveBrowserCredential, DefaultAzureCredential } = require('@azure/identity');

const PORT = Number(process.env.PORT) || 3000;
const rootDir = __dirname;

const SQL_SERVER = process.env.SQL_SERVER || 'eu2-dev-taxcaddy-sqlsrv.database.windows.net';
const SQL_DATABASE = process.env.SQL_DATABASE || '';
const SQL_AUTH = (process.env.SQL_AUTH || 'default').toLowerCase();
const SQL_USER = process.env.SQL_USER || '';
const SQL_PASSWORD = process.env.SQL_PASSWORD || '';

if (!SQL_DATABASE) {
  console.warn('[warn] SQL_DATABASE env var is empty. Set it before running, e.g. $env:SQL_DATABASE="TaxCaddyDev"');
}

function getCredential() {
  if (SQL_AUTH === 'interactive') {
    return new InteractiveBrowserCredential({
      tenantId: process.env.AAD_TENANT_ID || 'organizations',
      clientId: process.env.AAD_CLIENT_ID || '04b07795-8ddb-461a-bbee-02f9e1bf7b46',
      redirectUri: 'http://localhost:8400'
    });
  }
  return new DefaultAzureCredential();
}

let cachedCredential = null;
async function getAccessToken() {
  if (!cachedCredential) cachedCredential = getCredential();
  const token = await cachedCredential.getToken('https://database.windows.net/.default');
  if (!token || !token.token) throw new Error('Failed to obtain AAD access token');
  return token.token;
}

function buildSqlConfig(accessToken) {
  const base = {
    server: SQL_SERVER,
    database: SQL_DATABASE,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
  };

  if (SQL_AUTH === 'password') {
    return {
      ...base,
      user: SQL_USER,
      password: SQL_PASSWORD,
      authentication: {
        type: 'azure-active-directory-password',
        options: { userName: SQL_USER, password: SQL_PASSWORD }
      }
    };
  }

  // Interactive or default: pass a pre-fetched AAD token to tedious.
  return {
    ...base,
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: accessToken }
    }
  };
}

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const token = SQL_AUTH === 'password' ? null : await getAccessToken();
      return sql.connect(buildSqlConfig(token));
    })().catch(err => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// ── HTTP helpers ─────────────────────────────────────────────
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

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON payload')); }
    });
    req.on('error', reject);
  });
}

// ── Row mapping ──────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

function rowToTool(r) {
  return {
    id: Number(r.id),
    toolname: r.toolname || '',
    tooldescription: r.tooldescription || '',
    toolurl: r.toolurl || '',
    createddatetime: formatDate(r.createddatetime),
    createdby: r.createdby || '',
    ToolActive: r.ToolActive ? 1 : 0,
    Totaluserclickcount: Number(r.Totaluserclickcount) || 0,
    Remark: r.Remark || ''
  };
}

function normalizeInput(input) {
  return {
    toolname: String(input.toolname || '').trim(),
    tooldescription: String(input.tooldescription || '').trim(),
    toolurl: String(input.toolurl || '').trim(),
    createdby: String(input.createdby || '').trim(),
    ToolActive: Number(input.ToolActive) === 1 ? 1 : 0,
    Totaluserclickcount: Number(input.Totaluserclickcount) || 0,
    Remark: String(input.Remark || '').trim()
  };
}

function validate(t) {
  if (!t.toolname) return 'toolname is required';
  if (!t.toolurl) return 'toolurl is required';
  if (!t.createdby) return 'createdby is required';
  return null;
}

// ── Data access ──────────────────────────────────────────────
async function listTools() {
  const pool = await getPool();
  const result = await pool.request().query(
    `SELECT id, toolname, tooldescription, toolurl, createddatetime,
            createdby, ToolActive, Totaluserclickcount, Remark
     FROM dbo.TCToolConfig
     ORDER BY id ASC`
  );
  return result.recordset.map(rowToTool);
}

async function getTool(id) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(
      `SELECT id, toolname, tooldescription, toolurl, createddatetime,
              createdby, ToolActive, Totaluserclickcount, Remark
       FROM dbo.TCToolConfig WHERE id = @id`
    );
  return result.recordset[0] ? rowToTool(result.recordset[0]) : null;
}

async function insertTool(t) {
  const pool = await getPool();
  const result = await pool.request()
    .input('toolname', sql.NVarChar(250), t.toolname)
    .input('tooldescription', sql.NVarChar(500), t.tooldescription || null)
    .input('toolurl', sql.NVarChar(500), t.toolurl)
    .input('createdby', sql.NVarChar(250), t.createdby)
    .input('ToolActive', sql.Bit, t.ToolActive)
    .input('Totaluserclickcount', sql.Int, t.Totaluserclickcount)
    .input('Remark', sql.NVarChar(500), t.Remark || null)
    .query(
      `INSERT INTO dbo.TCToolConfig
         (toolname, tooldescription, toolurl, createdby, ToolActive, Totaluserclickcount, Remark)
       OUTPUT INSERTED.id
       VALUES (@toolname, @tooldescription, @toolurl, @createdby, @ToolActive, @Totaluserclickcount, @Remark)`
    );
  const newId = result.recordset[0].id;
  return getTool(newId);
}

async function updateTool(id, t) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .input('toolname', sql.NVarChar(250), t.toolname)
    .input('tooldescription', sql.NVarChar(500), t.tooldescription || null)
    .input('toolurl', sql.NVarChar(500), t.toolurl)
    .input('createdby', sql.NVarChar(250), t.createdby)
    .input('ToolActive', sql.Bit, t.ToolActive)
    .input('Totaluserclickcount', sql.Int, t.Totaluserclickcount)
    .input('Remark', sql.NVarChar(500), t.Remark || null)
    .query(
      `UPDATE dbo.TCToolConfig
       SET toolname = @toolname,
           tooldescription = @tooldescription,
           toolurl = @toolurl,
           createdby = @createdby,
           ToolActive = @ToolActive,
           Totaluserclickcount = @Totaluserclickcount,
           Remark = @Remark
       WHERE id = @id`
    );
  if (result.rowsAffected[0] === 0) return null;
  return getTool(id);
}

async function incrementClick(id) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(
      `UPDATE dbo.TCToolConfig
       SET Totaluserclickcount = ISNULL(Totaluserclickcount, 0) + 1
       WHERE id = @id`
    );
  if (result.rowsAffected[0] === 0) return null;
  return getTool(id);
}

async function deleteTool(id) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`DELETE FROM dbo.TCToolConfig WHERE id = @id`);
  return result.rowsAffected[0] > 0;
}

// ── Static file serving ──────────────────────────────────────
function toFilePath(urlPath) {
  const cleaned = urlPath === '/' ? '/TCToolConfigManager.html' : urlPath;
  const safe = path.normalize(cleaned).replace(/^([.][.][/\\])+/, '');
  return path.join(rootDir, safe);
}

async function serveStatic(req, res, pathname) {
  try {
    const filePath = toFilePath(pathname);
    if (!filePath.startsWith(rootDir)) { sendText(res, 403, 'Forbidden'); return; }
    const data = await fs.readFile(filePath);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') { sendText(res, 404, 'Not Found'); return; }
    sendJson(res, 500, { error: 'Failed to read file', detail: err.message });
  }
}

// ── Router ───────────────────────────────────────────────────
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
    if (req.method === 'GET' && pathname === '/api/health') {
      await getPool();
      sendJson(res, 200, { ok: true, storage: 'azure-sql', server: SQL_SERVER, database: SQL_DATABASE, auth: SQL_AUTH });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tools') {
      const rows = await listTools();
      sendJson(res, 200, rows);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/tools') {
      const body = await readJsonBody(req);
      const payload = normalizeInput(body || {});
      const err = validate(payload);
      if (err) { sendJson(res, 400, { error: err }); return; }
      const created = await insertTool(payload);
      sendJson(res, 201, created);
      return;
    }

    const itemMatch = pathname.match(/^\/api\/tools\/(\d+)$/);
    if (req.method === 'PUT' && itemMatch) {
      const id = Number(itemMatch[1]);
      const body = await readJsonBody(req);
      const existing = await getTool(id);
      if (!existing) { sendJson(res, 404, { error: 'Tool not found' }); return; }
      const merged = normalizeInput({ ...existing, ...body });
      const err = validate(merged);
      if (err) { sendJson(res, 400, { error: err }); return; }
      const updated = await updateTool(id, merged);
      sendJson(res, 200, updated);
      return;
    }

    const clickMatch = pathname.match(/^\/api\/tools\/(\d+)\/click$/);
    if (req.method === 'PATCH' && clickMatch) {
      const id = Number(clickMatch[1]);
      const updated = await incrementClick(id);
      if (!updated) { sendJson(res, 404, { error: 'Tool not found' }); return; }
      sendJson(res, 200, updated);
      return;
    }

    if (req.method === 'DELETE' && itemMatch) {
      const id = Number(itemMatch[1]);
      const ok = await deleteTool(id);
      if (!ok) { sendJson(res, 404, { error: 'Tool not found' }); return; }
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error('[error]', error);
    sendJson(res, 500, { error: 'Internal server error', detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`TC Tool SQL API running at http://localhost:${PORT}`);
  console.log(`  SQL server  : ${SQL_SERVER}`);
  console.log(`  SQL database: ${SQL_DATABASE || '(not set — set $env:SQL_DATABASE)'}`);
  console.log(`  Auth mode   : ${SQL_AUTH}`);
});
