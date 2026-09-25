// playwright.config.mjs — dev/verify loop only, never shipped in a game.
import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './test',
	timeout: 30_000,
	fullyParallel: false,
	webServer: {
		command: 'node server.js 5510',
		url: 'http://127.0.0.1:5510/index.html',
		reuseExistingServer: ! process.env.CI,
		timeout: 15_000,
	},
	use: {
		baseURL: 'http://127.0.0.1:5510',
	},
} );
