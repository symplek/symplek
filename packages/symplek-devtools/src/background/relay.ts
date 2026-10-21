/**
 * Background relay for Symplek DevTools.
 * Manages connections between DevTools panels and content scripts.
 */

const connections: Record<number, chrome.runtime.Port> = {};

export function initRelay(): void {
  // Listen for connections from the DevTools panel
  chrome.runtime.onConnect.addListener((port) => {
    const extensionListener = (message: any) => {
      // The original connection event should include the tabId
      if (message.name === "init") {
        connections[message.tabId] = port;
        return;
      }
    };

    port.onMessage.addListener(extensionListener);

    port.onDisconnect.addListener((port) => {
      port.onMessage.removeListener(extensionListener);

      const tabs = Object.keys(connections);
      for (let i = 0, len = tabs.length; i < len; i++) {
        if (connections[Number(tabs[i])] === port) {
          delete connections[Number(tabs[i])];
          break;
        }
      }
    });
  });

  // Listen for messages from content scripts and relay them to the DevTools panel
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.tab?.id && connections[sender.tab.id]) {
      connections[sender.tab.id].postMessage(message);
    }
    return true;
  });
}
