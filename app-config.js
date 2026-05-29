// HTML-only mode: read/write ToolConfig.json directly via GitHub Contents API.
// This avoids separate backend deployment.
window.TCTOOL_DIRECT_GITHUB_MODE = true;

// Route shape is still /api/tools for in-page logic.
window.TCTOOL_API_BASE = '/api/tools';

// GitHub target file.
window.TCTOOL_GITHUB_OWNER = 'VinodPatilTR';
window.TCTOOL_GITHUB_REPO = 'Tctoolmanager';
window.TCTOOL_GITHUB_BRANCH = 'main';
window.TCTOOL_GITHUB_FILE_PATH = 'data/ToolConfig.json';

// Required for create/update/delete/click writes.
// Leave blank in git. Set your token manually for production use.
window.TCTOOL_GITHUB_TOKEN = window.TCTOOL_GITHUB_TOKEN || '';
