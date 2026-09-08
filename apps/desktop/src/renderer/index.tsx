import "@fontsource-variable/space-grotesk";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@fontsource/dm-mono/400-italic.css";
import "@fontsource/dm-mono/500-italic.css";
import "./index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- root element guaranteed in index.html
createRoot(document.getElementById("root")!).render(<App />);
