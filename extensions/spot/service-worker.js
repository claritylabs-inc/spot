// The toolbar click opens the sidebar and grants activeTab for that tab. It
// never reads the page; capture only runs from the sidebar's own button.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener((tab) => {
  void chrome.sidePanel.open({ windowId: tab.windowId });
});
