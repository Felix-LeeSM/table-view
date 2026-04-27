import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./AppRouter";
import { bootTheme } from "@lib/themeBoot";
import "./index.css";

bootTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>,
);
