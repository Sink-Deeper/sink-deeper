import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/manrope/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

import App from "./App";
import { AuthProvider } from "./lib/auth";
import { PlayerProvider } from "./lib/player";

// Optional build-time theme override (VITE_THEME=ember|paper|noir); loaded before first paint
const themeCss = import.meta.glob("./themes/*.css");
const themeId = import.meta.env.VITE_THEME as string | undefined;
const loader = themeId && themeCss[`./themes/${themeId}.css`] ? themeCss[`./themes/${themeId}.css`]() : Promise.resolve();

loader.finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <PlayerProvider>
            <App />
          </PlayerProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
});
