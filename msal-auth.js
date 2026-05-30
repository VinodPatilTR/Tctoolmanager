/* eslint-disable no-console */
// MSAL.js sign-in helper for TC Tool Manager.
// Loaded by TCToolConfigManager.html and TCToolConfigmanagerread.html.
// If TCTOOL_AAD_TENANT_ID / TCTOOL_AAD_CLIENT_ID are blank in app-config.js,
// this script does nothing — the page works in anonymous / GitHub fallback mode.

(function () {
  const tenantId = window.TCTOOL_AAD_TENANT_ID || '';
  const clientId = window.TCTOOL_AAD_CLIENT_ID || '';
  const scope = window.TCTOOL_SQL_SCOPE || 'https://database.windows.net/.default';

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
    injectSignInButton(false);
    return;
  }

  // Load MSAL.js, then bootstrap.
  const s = document.createElement('script');
  s.src = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
  s.async = true;
  s.onload = bootstrap;
  s.onerror = () => console.error('[auth] Failed to load MSAL.js from CDN');
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
      // Handle redirect responses (no-op when using popup, but safe).
      try { await msal.handleRedirectPromise(); } catch (e) { console.warn('[auth] redirect handler', e); }

      const accounts = msal.getAllAccounts();
      if (accounts.length) msal.setActiveAccount(accounts[0]);

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
            console.warn('[auth] silent token failed, prompting popup', err);
            const r = await msal.acquireTokenPopup({ account, scopes: [scope] });
            return r.accessToken;
          }
        },
        signIn: async () => {
          const r = await msal.loginPopup({ scopes: [scope], prompt: 'select_account' });
          msal.setActiveAccount(r.account);
          renderButton();
          if (typeof window.manualRefresh === 'function') window.manualRefresh();
        },
        signOut: async () => {
          const account = msal.getActiveAccount();
          await msal.logoutPopup({ account, mainWindowRedirectUri: window.location.href });
          renderButton();
          if (typeof window.manualRefresh === 'function') window.manualRefresh();
        }
      };

      injectSignInButton(true);
      renderButton();

      // If already signed in, refresh data with bearer token.
      if (window.tctoolAuth.isSignedIn() && typeof window.manualRefresh === 'function') {
        window.manualRefresh();
      }
    });
  }

  function injectSignInButton(enabled) {
    const ready = () => {
      const topbar = document.querySelector('.topbar > div:last-child');
      if (!topbar) { setTimeout(ready, 50); return; }
      if (document.getElementById('signin-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'signin-btn';
      btn.className = 'reload-btn';
      btn.title = 'Sign in with Microsoft account (MFA)';
      btn.style.cssText = 'border-color:#0f67ac;color:#0f67ac;';
      btn.textContent = enabled ? 'Sign in' : 'Sign in (not configured)';
      if (!enabled) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; }
      btn.onclick = async () => {
        try {
          if (window.tctoolAuth.isSignedIn()) await window.tctoolAuth.signOut();
          else await window.tctoolAuth.signIn();
        } catch (e) {
          console.error(e);
          alert('Sign-in failed: ' + (e && e.message ? e.message : e));
        }
      };
      topbar.appendChild(btn);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      ready();
    }
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
