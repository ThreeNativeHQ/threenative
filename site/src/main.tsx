import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { AppForPath } from "./app.js";
import "./styles/tailwind.css";

const root = document.getElementById("root");
if (root === null) throw new Error("TN_SITE_NO_ROOT: index.html has no #root element.");

hydrateRoot(
  root,
  <StrictMode>
    <AppForPath path={window.location.pathname} />
  </StrictMode>,
);
