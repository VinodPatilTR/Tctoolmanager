// Backend: Azure SQL via sql-server.js (uses your AAD/SSMS login).
// Start backend:  az login   ->   npm install   ->   npm run start:sql
// Open the page:  http://localhost:3000/TCToolConfigManager.html
window.TCTOOL_LOCAL_MODE = false;
window.TCTOOL_DIRECT_GITHUB_MODE = false;

// Deployed Azure App Service API (primary). Falls back to localhost when running locally.
window.TCTOOL_API_BASE = 'https://tctool-manager-api.azurewebsites.net/api/tools';

// Fallback bases — localhost used when running sql-server.js locally.
window.TCTOOL_API_CANDIDATES = [
  'https://tctool-manager-api.azurewebsites.net/api/tools',
  'http://localhost:3000/api/tools',
  'http://127.0.0.1:3000/api/tools'
];

// GitHub target file.
window.TCTOOL_GITHUB_OWNER = 'VinodPatilTR';
window.TCTOOL_GITHUB_REPO = 'Tctoolmanager';
window.TCTOOL_GITHUB_BRANCH = 'main';
window.TCTOOL_GITHUB_FILE_PATH = 'data/ToolConfig.json';

// Required for create/update/delete/click writes.
// Leave blank in git. Set your token manually for production use.
window.TCTOOL_GITHUB_TOKEN = window.TCTOOL_GITHUB_TOKEN || '';

// ─── AAD sign-in (MSAL.js) for per-user MFA login from the page ───
// Tenant ID GUID, or 'organizations' for any work/school account.
window.TCTOOL_AAD_TENANT_ID = 'e205bfab-7c3a-4369-86f3-030001469257';
// Application (client) ID from the TCTool Manager UI App Registration.
window.TCTOOL_AAD_CLIENT_ID = 'ab9a58b5-8d46-4d9e-813e-a580fbd3ba08';
// Scope to request — Azure SQL needs this exact resource.
window.TCTOOL_SQL_SCOPE = 'https://database.windows.net/.default';
