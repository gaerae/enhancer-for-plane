// background.js — handles content-script messages (open the options page)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "pe-open-options") {
    chrome.runtime.openOptionsPage();
  }
});
