import { useCallback, useEffect, useState } from "react";
import type { BridgeMessage } from "../../bridge/types";

/**
 * React hook for the DevTools panel to communicate with the background script
 * and receive messages from the web page.
 */
export function useDevToolsBridge() {
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect to the background script
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const port = chrome.runtime.connect({ name: "Symplek-devtools-panel" });

    // Initialize the connection with the tab ID
    port.postMessage({
      name: "init",
      tabId: tabId,
    });

    setIsConnected(true);

    const messageListener = (message: BridgeMessage) => {
      if (message.source === "Symplek-page") {
        setMessages((prev) => [...prev.slice(-999), message]); // Keep last 1000 messages
      }
    };

    port.onMessage.addListener(messageListener);

    const disconnectListener = () => {
      setIsConnected(false);
      // Attempt reconnection after a delay
      setTimeout(() => {
        window.location.reload(); // Simple reconnection strategy for DevTools panel
      }, 1000);
    };

    port.onDisconnect.addListener(disconnectListener);

    return () => {
      port.onMessage.removeListener(messageListener);
      port.onDisconnect.removeListener(disconnectListener);
      port.disconnect();
    };
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isConnected,
    clearMessages,
  };
}
