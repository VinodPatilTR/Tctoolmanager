/* eslint-disable no-console */
// MSAL.js sign-in helper for TC Tool Manager.
// Loaded by TCToolConfigManager.html and TCToolConfigmanagerread.html.
// The Sign in button (#signin-btn) is in the HTML. This script wires it up.

(function () {
  const tenantId = window.TCTOOL_AAD_TENANT_ID || '';
  const clientId = window.TCTOOL_AAD_CLIENT_ID || '';
  const scope = window.TCTOOL_SQL_SCOPE || 'https://database.windows.net/.default';

  // Default click handler — shown before MSAL loads or if not configured.
  window.__msalBtnClick = () => alert('Authentication is loading, please try again in a moment.');

  // Expose a stub no-op auth so callers can always use the same API.
  window.tctoolAuth = {
    enabled: false,
    isSignedIn: () => false,
    account: null,
    getToken: async () => null,
    signIn: async () => { throw new Error('AAD sign-in not configured'); },
    signOut: async () => {}
  };

  if (!tenantId || !clientId) {
    console.info('[auth] MSAL disabled — set TCTOOL_AAD_TENANT_ID and TCTOOL_AAD_CLIENT_ID in app-config.js to enable.');
    const btn = document.getElementById('signin-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; btn.title = 'Sign-in not configured'; }
    return;
  }

  // Load MSAL.js, then bootstrap.
  const s = document.createElement('script');
  s.src = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
  s.async = true;
  s.onload = bootstrap;
  s.onerror = () => {
    console.error('[auth] Failed to load MSAL.js from CDN');
    const btn = document.getElementById('signin-btn');
    if (btn) { btn.textContent = 'Auth unavailable'; btn.disabled = true; btn.style.opacity = '0.5'; btn.title = 'Failed to load MSAL — check network/proxy'; }
  };
  document.head.appendChild(s);

  function bootstrap() {
    const msalConfig = {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin + window.location.pathname
      },
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
    };
    const msal = new window.msal.PublicClientApplication(msalConfig);

    msal.initialize().then(async () => {
      // Handle redirect result — captures account + token after AAD redirect back.
      let redirectResult = null;
      try { redirectResult = await msal.handleRedirectPromise(); } catch (e) { console.warn('[auth] redirect handler', e); }
      if (redirectResult && redirectResult.account) msal.setActiveAccount(redirectResult.account);

      const accounts = msal.getAllAccounts();
      if (accounts.length && !msal.getActiveAccount()) msal.setActiveAccount(accounts[0]);

      window.tctoolAuth = {
        enabled: true,
        isSignedIn: () => Boolean(msal.getActiveAccount()),
        get account() { return msal.getActiveAccount(); },
        getToken: async () => {
          const account = msal.getActiveAccount();
          if (!account) return null;
          try {
            const r = await msal.acquireTokenSilent({ account, scopes: [scope] });
            return r.accessToken;
          } catch (err) {
            console.warn('[auth] silent token failed, trying redirect', err);
            // Redirect to AAD to get a fresh token; page reloads after.
            await msal.acquireTokenRedirect({ account, scopes: [scope] });
            return null; // unreachable — page redirects
          }
        },
        signIn: async () => {
          // Use redirect (not popup) — works in all corporate browser environments.
          await msal.loginRedirect({ scopes: [scope], prompt: 'select_account' });
          // Execution stops here; page navigates to AAD, then returns.
        },
        signOut: async () => {
          const account = msal.getActiveAccount();
          await msal.logoutRedirect({ account, postLogoutRedirectUri: window.location.href });
          // Execution stops here; page navigates to AAD logout, then returns.
        }
      };

      // Wire up the button's click handler now that MSAL is ready.
      window.__msalBtnClick = async () => {
        try {
          if (window.tctoolAuth.isSignedIn()) await window.tctoolAuth.signOut();
          else await window.tctoolAuth.signIn();
        } catch (e) {
          console.error(e);
          alert('Sign-in failed: ' + (e && e.message ? e.message : e));
        }
      };

      renderButton();

      // After redirect back, if signed in, reload data with bearer token.
      if (window.tctoolAuth.isSignedIn() && typeof window.manualRefresh === 'function') {
        window.manualRefresh();
      }
    });
  }

  function renderButton() {
    const btn = document.getElementById('signin-btn');
    if (!btn) return;
    if (window.tctoolAuth.isSignedIn()) {
      const acc = window.tctoolAuth.account;
      btn.textContent = `Sign out (${(acc && acc.username) || 'signed in'})`;
      btn.title = 'Click to sign out';
    } else {
      btn.textContent = 'Sign in';
      btn.title = 'Sign in with Microsoft account (MFA)';
    }
  }
})();
