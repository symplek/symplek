import { createRoot } from "react-dom/client";
import { DevToolsPanel } from "./DevToolsPanel";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<DevToolsPanel />);
}
