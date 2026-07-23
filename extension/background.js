/**
 * TorBox Streamer — Background Script
 * Handles native messaging with the Python host.
 */

const NATIVE_HOST = "com.torbox_streamer.host";
let nativePort = null;
let messageQueue = [];
let isConnected = false;

// Track current page info per tab
const tabInfo = {};

// ─── Native Messaging ───────────────────────────────────────────────────────

function connectNativeHost() {
  if (nativePort) {
    try {
      nativePort.disconnect();
    } catch (e) {}
  }

  nativePort = browser.runtime.connectNative(NATIVE_HOST);
  isConnected = true;

  nativePort.onMessage.addListener((msg) => {
    // Route response to the waiting popup
    browser.runtime.sendMessage({ type: "NATIVE_RESPONSE", data: msg }).catch(() => {});
  });

  nativePort.onDisconnect.addListener((port) => {
    isConnected = false;
    const error = port.error ? port.error.message : "unknown";
    console.warn(`Native host disconnected: ${error}`);
    browser.runtime.sendMessage({
      type: "NATIVE_ERROR",
      data: { message: `Native host disconnected: ${error}` },
    }).catch(() => {});
  });
}

function sendToNative(msg) {
  if (!isConnected || !nativePort) {
    connectNativeHost();
  }
  try {
    nativePort.postMessage(msg);
  } catch (e) {
    // Reconnect and retry once
    connectNativeHost();
    nativePort.postMessage(msg);
  }
}

// ─── Message Routing ────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {
    case "PAGE_INFO":
      // Content script reporting page info
      if (sender.tab) {
        tabInfo[sender.tab.id] = msg.data;
      }
      break;

    case "NATIVE_REQUEST":
      // Popup wants to send a message to the native host
      sendToNative(msg.data);
      break;

    case "GET_TAB_INFO":
      // Popup asking for current tab's IMDb info
      return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) {
          return tabInfo[tabs[0].id] || null;
        }
        return null;
      });

    case "CONNECT_NATIVE":
      connectNativeHost();
      break;
  }
});

// Clean up tab info when tabs close
browser.tabs.onRemoved.addListener((tabId) => {
  delete tabInfo[tabId];
});

// Toolbar icon click → open the modal in the active tab
browser.browserAction.onClicked.addListener((tab) => {
  browser.tabs.sendMessage(tab.id, { type: "OPEN_MODAL" }).catch(() => {});
});

// Connect on startup
connectNativeHost();
