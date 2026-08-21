import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./styles/global.css";
import "./components/ui/ui.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
