// Backend: Azure SQL via sql-server.js (uses your AAD/SSMS login).
// Start backend:  az login   ->   npm install   ->   npm run start:sql
// Open the page:  http://localhost:3000/TCToolConfigManager.html
window.TCTOOL_LOCAL_MODE = false;
window.TCTOOL_DIRECT_GITHUB_MODE = false;

// Same-origin API path served by sql-server.js
window.TCTOOL_API_BASE = '/api/tools';

// Fallback bases used when the page is opened via file:// instead of the server.
window.TCTOOL_API_CANDIDATES = [
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
