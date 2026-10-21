import { initRelay } from "./relay";

// Background service worker for Symplek DevTools
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Symplek DevTools] Extension installed");
});

// Initialize the background relay
initRelay();
