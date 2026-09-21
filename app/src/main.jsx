// Entry point. Import order matters:
// 1. styles: tokens.css (design tokens + self-hosted fonts) before app.css (component recipes);
// 2. the vendored structure-hash script (window.SGHash, byte-for-byte from Zero to Signing);
// 3. the wallet/chain bridge (window.SGLib) over the vendored connect/transactions bundles;
// 4. the app.
import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/tokens.css";
import "@phosphor-icons/web/regular";
import "./styles/app.css";

import "./lib.js";

import { App } from "./app.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
