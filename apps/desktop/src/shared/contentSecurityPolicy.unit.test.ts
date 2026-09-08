import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./contentSecurityPolicy";

describe("renderer content security policy", () => {
	it("allows packaged assets, media streaming and the existing icon providers with external scripts blocked", () => {
		const policy = contentSecurityPolicy(false);
		expect(policy.split("; ")).toContain("script-src 'self'");
		expect(policy).toContain("media-src 'self' media: blob:");
		expect(policy).toContain("https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com");
		expect(policy).not.toContain("unsafe-eval");
		expect(policy).not.toContain("localhost");
	});
	it("adds local development connections and the Vite bootstrap only in development", () => {
		expect(contentSecurityPolicy(true)).toContain("ws://localhost:*");
		expect(contentSecurityPolicy(true)).toContain("script-src 'self' 'unsafe-inline'");
	});
});
