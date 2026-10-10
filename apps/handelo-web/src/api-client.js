(() => {
  const originalFetch = window.fetch.bind(window);
  let credential = "";
  let credentialPrompt = null;
  function isHandeloApi(input) {
    try { const u = new URL(typeof input === "string" || input instanceof URL ? input : input.url, window.location.href); return u.origin === window.location.origin && u.pathname.startsWith("/api/"); } catch { return false; }
  }
  function askForCredentials() {
    if (credential) return Promise.resolve(credential);
    if (credentialPrompt) return credentialPrompt;
    credentialPrompt = new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-labelledby", "handelo-auth-title");
      dialog.style.cssText = "border:1px solid #554a2c;border-radius:14px;padding:24px;max-width:380px;width:calc(100% - 40px);background:#111;color:#f5f1e6";
      dialog.innerHTML = '<form style="display:grid;gap:14px;font:14px system-ui,sans-serif"><h2 id="handelo-auth-title" style="margin:0">Sign in to Handelo</h2><label style="display:grid;gap:6px">Username<input name="username" autocomplete="username" required style="padding:10px;border-radius:7px;border:1px solid #554a2c;background:#191919;color:#fff"></label><label style="display:grid;gap:6px">Password<input name="password" type="password" autocomplete="current-password" required style="padding:10px;border-radius:7px;border:1px solid #554a2c;background:#191919;color:#fff"></label><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-auth-cancel>Cancel</button><button type="submit">Continue</button></div></form>';
      const form = dialog.querySelector("form"); let done = false;
      const finish = value => { if (done) return; done = true; if (dialog.open) dialog.close(); dialog.remove(); resolve(value); };
      form.addEventListener("submit", event => { event.preventDefault(); const u=String(form.elements.username.value||""); const p=String(form.elements.password.value||""); if(!u||!p)return; credential=btoa(u+":"+p); finish(credential); });
      dialog.querySelector("[data-auth-cancel]").addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
      document.body.appendChild(dialog); dialog.showModal(); form.elements.username.focus();
    }).finally(() => { credentialPrompt = null; });
    return credentialPrompt;
  }
  window.fetch = async function(input, init = {}) {
    if (!isHandeloApi(input)) return originalFetch(input, init);
    let response = await originalFetch(input, init);
    if (response.status !== 401 || response.headers.get("x-handelo-auth-required") !== "1") return response;
    const auth = await askForCredentials(); if (!auth) return response;
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("authorization", "Basic " + auth);
    response = await originalFetch(input, { ...init, headers });
    if (response.status === 401 && response.headers.get("x-handelo-auth-required") === "1") { credential=""; window.alert("Handelo sign-in failed. Check the username and password and try again."); }
    return response;
  };
})();
