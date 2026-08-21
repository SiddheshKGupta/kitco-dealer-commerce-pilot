import { createServer } from "vite";

const server = await createServer({
	appType: "custom",
	configFile: false,
	logLevel: "silent",
	server: { middlewareMode: true },
});
try {
	await server.ssrLoadModule("/scripts/build-canonical-import.ts");
} finally {
	await server.close();
}
