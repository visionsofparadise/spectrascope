import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { contentSecurityPolicy } from "./src/shared/contentSecurityPolicy";

export default defineConfig(({ command }) => ({
	plugins: [
		react(),
		{
			name: "spectrascope-content-security-policy",
			transformIndexHtml: () => [
				{
					tag: "meta",
					attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(command === "serve") },
					injectTo: "head-prepend",
				},
			],
		},
	],
	define: {
		"process.platform": JSON.stringify(process.platform),
		"process.arch": JSON.stringify(process.arch),
	},
}));
