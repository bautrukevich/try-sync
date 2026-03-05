import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import githubRouter from "./routes/github";

export type Bindings = {
  NOTION_API_KEY: string;
  NOTION_DATABASE_ID: string;
  GITHUB_WEBHOOK_SECRET: string;
  LOG_LEVEL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(logger());
app.use(prettyJSON());

app.get("/", (c) => c.text("OK"));

app.route("/", githubRouter);

export default app;
