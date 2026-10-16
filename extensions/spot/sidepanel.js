(() => {
  const config = globalThis.SPOT_EXTENSION;
  const frame = document.getElementById("app");
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
  let loadedAt = 0;

  function say(message) {
    statusLine.textContent = message;
  }

  function setReady(value) {
    ready = value;
    if (!value) sessionId = null;
    captureButton.disabled = !value;
  }

  function loadApp() {
    setReady(false);
    loadedAt = 0;
    say("Loading Spot…");
    frame.src = appUrl;
  }

  frame.addEventListener("load", () => {
    loadedAt = Date.now();
    setTimeout(() => {
      if (!ready && loadedAt) {
        say("If Spot doesn't load, press Reload. Sign in below if prompted.");
      }
    }, 1500);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.origin !== config.appOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.version !== config.protocolVersion) return;
    if (data.type === "spot:received" && data.sessionId === sessionId && data.captureId === pendingReceipt?.id) {
      pendingReceipt.resolve(true);
    }
    if (data.type === "spot:unavailable" && data.sessionId === sessionId) {
      setReady(false);
      say("Sign in to Spot, then press Reload.");
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
    if (!ready) return;
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
      const { title, text, selection } = result.context;
      const shortTitle = title.length > 60 ? `${title.slice(0, 57)}…` : title;
      say(
        `Shared “${shortTitle}” · ${text.length.toLocaleString()} characters. Review the attachment in your chat.` +
          (selection ? " · selected text" : "") +
          (result.truncated ? " · shortened to fit" : ""),
      );
    } finally {
      delete statusLine.dataset.sticky;
      captureButton.disabled = !ready;
    }
  }

  captureButton.addEventListener("click", () => void usePage());
  document.getElementById("reload").addEventListener("click", loadApp);
  chrome.tabs.onActivated.addListener(() => void refreshHint());
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if (change.status === "complete") void refreshHint();
  });

  loadApp();
})();
