import { initRelay } from "./relay";

// Background service worker for Weft DevTools
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Weft DevTools] Extension installed");
});

// Initialize the background relay
initRelay();
