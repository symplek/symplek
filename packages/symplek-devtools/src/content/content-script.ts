import { initBridgeListener } from "./bridge-listener";

// Content script for Symplek DevTools
console.log("[Symplek DevTools] Content script loaded");

// Initialize the message bridge
initBridgeListener();
