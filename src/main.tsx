import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootTheme } from "@lib/themeBoot";
import "./index.css";

bootTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
