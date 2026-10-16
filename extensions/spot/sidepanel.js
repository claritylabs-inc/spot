(() => {
  const config = globalThis.SPOT_EXTENSION;
  const frame = document.getElementById("app");
  const toolbar = document.querySelector(".bar");
  const captureButton = document.getElementById("capture");
  const statusLine = document.getElementById("status");
  const appUrl = config.appOrigin + config.path;
  const limits = {
    maxText: config.maxTextLength,
    maxTitle: config.maxTitleLength,
    maxUrl: config.maxUrlLength,
  };

  // The app announces itself once a composer can stage a page. Until then
  // nothing is captured, so no page text can wait for a different account.
  let ready = false;
  let sessionId = null;
  let pendingReceipt = null;
  let mounted = false;
  let loadTimeout;
  let signInUntil = 0;
  let signInTabId = null;

  function say(message) {
    statusLine.textContent = message;
    if (ready && sessionId) {
      frame.contentWindow.postMessage({ type: "spot:capture-status", version: config.protocolVersion, sessionId, message }, config.appOrigin);
    }
  }

  function setReady(value) {
    ready = value;
    if (!value) sessionId = null;
    captureButton.disabled = !value;
    toolbar.hidden = true;
    if (value) signInUntil = 0;
  }

  function loadApp() {
    setReady(false);
    mounted = false;
    clearTimeout(loadTimeout);
    loadTimeout = setTimeout(() => {
      if (!mounted) {
        toolbar.hidden = false;
        captureButton.hidden = true;
        say("Spot couldn’t load. Check your connection and try again.");
      }
    }, 15000);
    frame.src = appUrl;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.origin !== config.appOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.version !== config.protocolVersion) return;
    if (data.type === "spot:mounted") {
      mounted = true;
      clearTimeout(loadTimeout);
      toolbar.hidden = true;
      captureButton.hidden = false;
    }
    if (data.type === "spot:capture-request" && ready && data.sessionId === sessionId) {
      if (!navigator.userActivation.isActive) return say("Press Use this page again to share it.");
      void usePage();
    }
    if (data.type === "spot:sign-in" && !ready) {
      signInUntil = Date.now() + 10 * 60 * 1000;
      signInTabId = null;
    }
    if (data.type === "spot:received" && data.sessionId === sessionId && data.captureId === pendingReceipt?.id) {
      pendingReceipt.resolve(true);
    }
    if (data.type === "spot:unavailable" && data.sessionId === sessionId) {
      setReady(false);
      say("");
    }
    if (data.type === "spot:ready" && typeof data.sessionId === "string" && data.sessionId.length <= 80) {
      sessionId = data.sessionId;
      setReady(true);
      say("");
      void refreshHint();
    }
  });

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  const CLICK_ICON =
    "Click the Spot icon on this tab, then press Use this page. Browser pages and some PDF viewers can't be read.";

  async function refreshHint() {
    if (!ready || statusLine.dataset.sticky) return;
    const tab = await activeTab().catch(() => undefined);
    if (tab && tab.url === undefined) say(CLICK_ICON);
    else say("");
  }

  function describeFailure(reason) {
    if (reason === "selection-unreadable") {
      return "That selection can't be read. Select ordinary page text, or clear the selection to use the page.";
    }
    if (reason === "unsupported") {
      return "Spot can't read browser pages, the Chrome Web Store or local files. Open a regular website and try again.";
    }
    if (reason === "empty") {
      return "No readable text found on this page. Select some text and try again.";
    }
    return "Spot couldn't read this page. " + CLICK_ICON;
  }

  function isValid(context) {
    return (
      context &&
      typeof context.title === "string" &&
      context.title.length <= limits.maxTitle &&
      typeof context.url === "string" &&
      context.url.length <= limits.maxUrl &&
      typeof context.text === "string" &&
      context.text.trim().length > 0 &&
      context.text.length <= limits.maxText &&
      typeof context.selection === "boolean"
    );
  }

  async function usePage() {
    if (!ready || captureButton.disabled) return;
    const captureSession = sessionId;
    captureButton.disabled = true;
    statusLine.dataset.sticky = "1";
    try {
      const tab = await activeTab();
      if (!tab || tab.id === undefined) return say("Open a web page to use it with Spot.");
      if (tab.url === undefined) return say(CLICK_ICON);
      if (!/^https?:/i.test(tab.url)) return say(describeFailure("unsupported"));
      let injected;
      try {
        injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: globalThis.spotCapturePage,
          args: [limits],
        });
      } catch {
        return say(describeFailure("unreadable"));
      }
      const result = injected && injected[0] && injected[0].result;
      if (!result || !result.ok) return say(describeFailure(result && result.reason));
      if (!isValid(result.context)) return say(describeFailure("unreadable"));
      if (!ready || sessionId !== captureSession) return say("Your Spot workspace changed. Try again.");
      const captureId = crypto.randomUUID();
      let receiptTimeout;
      const receipt = new Promise((resolve) => {
        pendingReceipt = { id: captureId, resolve };
        receiptTimeout = setTimeout(() => resolve(false), 5000);
      });
      frame.contentWindow.postMessage(
        { type: "spot:page-context", version: config.protocolVersion, sessionId: captureSession, captureId, context: result.context },
        config.appOrigin,
      );
      const received = await receipt;
      clearTimeout(receiptTimeout);
      pendingReceipt = null;
      if (!received || sessionId !== captureSession) return say("Spot didn't receive that page. Press Reload and try again.");
      say("");
    } finally {
      delete statusLine.dataset.sticky;
      captureButton.disabled = !ready;
    }
  }

  captureButton.addEventListener("click", () => void usePage());
  document.getElementById("reload").addEventListener("click", loadApp);
  chrome.tabs.onActivated.addListener(() => void refreshHint());
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (!ready && signInUntil > Date.now() && tab.url?.startsWith(config.appOrigin + "/login?from=extension")) {
      signInTabId = id;
    }
    if (change.status !== "complete") return;
    // A sign-in tab finishes by opening the welcome guide. Reload only the
    // signed-out frame; cookies stay with the app and never enter this bridge.
    if (!ready && signInUntil > Date.now() && id === signInTabId) loadApp();
    else void refreshHint();
  });

  loadApp();
})();
