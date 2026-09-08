export function contentSecurityPolicy(development: boolean): string {
	return [
		"default-src 'self'",
		`script-src 'self'${development ? " 'unsafe-inline'" : ""}`,
		"style-src 'self' 'unsafe-inline'",
		`connect-src 'self' media: https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com${development ? " http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*" : ""}`,
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"media-src 'self' media: blob:",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'none'",
		"frame-src 'none'",
	].join("; ");
}
