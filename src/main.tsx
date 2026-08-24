import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// React (and its own splash) has taken over — drop the inline HTML one so
// there is no flash of the static version behind the app.
document.getElementById("splash")?.remove();
