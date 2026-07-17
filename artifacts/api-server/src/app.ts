import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "node:path";
import fs from "node:fs";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isProduction = process.env["NODE_ENV"] === "production";
const isElectron = !!process.env["ELECTRON"];

// Trust the reverse proxy so secure cookies and rate-limiting work behind HTTPS proxy
if (!isElectron) {
  app.set("trust proxy", 1);
}

// Session middleware — created once and cached so the MemoryStore persists across requests.
// SESSION_SECRET is checked at request time (may be set after module load in some modes).
let _sessionMiddleware: RequestHandler | null = null;

app.use((req, res, next) => {
  const sessionSecret = process.env["SESSION_SECRET"];
  if (!sessionSecret) {
    res.status(503).json({ error: "Server not configured. Please restart the application." });
    return;
  }
  if (!_sessionMiddleware) {
    _sessionMiddleware = session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: isElectron ? "strict" : "lax",
        secure: isProduction && !isElectron,
        maxAge: 8 * 60 * 60 * 1000,
      },
    });
  }
  _sessionMiddleware(req, res, next);
});

app.use("/api", router);

// In Electron/production mode, serve the built frontend static files
if (isElectron || isProduction) {
  const frontendDir = process.env["FRONTEND_DIR"]
    ?? path.resolve(
      fs.existsSync(path.join((process as any).resourcesPath ?? "", "frontend", "index.html"))
        ? path.join((process as any).resourcesPath ?? "", "frontend")
        : path.join(__dirname, "..", "..", "production-tracker", "dist", "public"),
    );

  if (fs.existsSync(frontendDir)) {
    app.use(express.static(frontendDir));
    // SPA fallback — serve index.html for any non-API route
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      const indexFile = path.join(frontendDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }
}

export default app;
