import type { BridgeMessage } from "../bridge/types";

/**
 * Initializes the content script listener that bridges messages
 * from the web page to the extension's background script.
 */
export function initBridgeListener(): void {
  window.addEventListener("message", (event) => {
    // Only accept messages from the same frame
    if (event.source !== window) return;

    const data = event.data as BridgeMessage;

    // Check if the message is from our page emitter
    if (data && data.source === "Weft-page") {
      try {
        chrome.runtime.sendMessage(data);
      } catch (error) {
        // Handle cases where the extension context might be invalidated
        console.error(
          "[Weft DevTools] Failed to send message to background:",
          error,
        );
      }
    }
  });
}
