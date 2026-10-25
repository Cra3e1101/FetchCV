import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { motionTransitions } from "./ui/motion";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";
import "./ui/workspace.css";
import {applyInterfaceTheme} from "./ui/interface-theme";
import App from "./App";
import "./ui/replica-alignment.css";
import "./ui/replica-components.css";
import "./ui/agent-motion.css";

applyInterfaceTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user" transition={motionTransitions.enter}><App /></MotionConfig>
  </React.StrictMode>,
);
