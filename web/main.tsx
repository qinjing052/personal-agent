import React from "react";
import { createRoot } from "react-dom/client";
import App from "./src/App.js";
import "./src/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
