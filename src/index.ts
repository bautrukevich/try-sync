import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { createMiddleware } from "hono/factory";

type Bindings = {
  SECRET_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(logger());
app.use(prettyJSON());

const auth = createMiddleware(async (c, next) => {
  const token = c.req.param("token");
  const { SECRET_TOKEN } = c.env;
  if (token !== SECRET_TOKEN) {
    return c.text("Unauthorized", 401);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.post("/webhooks/notion/:token", auth, (c) => {
  return c.text("OK");
});

app.post("/webhooks/github/:token", auth, (c) => {
  return c.text("OK");
});

export default app;
