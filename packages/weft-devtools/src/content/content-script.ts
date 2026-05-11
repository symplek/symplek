import { initBridgeListener } from "./bridge-listener";

// Content script for Weft DevTools
console.log("[Weft DevTools] Content script loaded");

// Initialize the message bridge
initBridgeListener();
