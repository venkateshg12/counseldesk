# Phase 08 — Redis and rate limiting

## 1. Goal

Protect the API before the expensive endpoint exists. The public chat endpoint (Phase 16) costs
real model quota on every message; without limits, one script can burn a free tier in minutes or
hammer the staff login with password guesses.

This phase copies the e-commerce rate limiter — a Redis sliding-window log executed atomically in
Lua, with a circuit breaker and an in-memory fallback — and the anonymous `visitorId` cookie. Then
it defines this project's limits: the global pre-auth limiter, the three login axes, refresh, and a
chat limiter that the chat route will use.

Nothing in the limiter's algorithm is rewritten. What's new is choosing the numbers and keys for a
chatbot, which is a different shape of abuse than a shop.

## 2. What I will understand after this phase

1. How a sliding-window log works and why it's done in one Lua script (atomicity).
2. What a circuit breaker does and why the limiter falls back to memory instead of failing.
3. Why login is limited on three axes and why the per-account limit is not punitive.
4. How a client IP is extracted safely behind proxies.
5. How to size limits for an LLM endpoint: protect the quota, not just the server.

## 3. Prerequisites

- Phase 07 done.
- `counseldesk-redis` healthy (`docker compose ps`), `REDIS_HOST=localhost`, `REDIS_PORT=6381` in
  `.env`.

## 4. Files

All COPY (with `.js` import suffixes as the only change) unless noted. Sources are under
`e-commerce/apps/backends/mongo/src/`.

```
apps/api/src/
├── utils/rateLimiter/
│   ├── circuitBreaker.ts            COPY  utils/rateLimiter/circuitBreaker.ts
│   ├── ipExtractor.ts               COPY  utils/rateLimiter/ipExtractor.ts
│   ├── luaScript.ts                 COPY  utils/rateLimiter/luaScript.ts
│   ├── memoryStore.ts               COPY  utils/rateLimiter/memoryStore.ts
│   ├── redisStore.ts                COPY  utils/rateLimiter/redisStore.ts
│   └── index.ts                     COPY  utils/rateLimiter/index.ts
├── types/rateLimiter.types.ts       COPY  types/rateLimiter.types.ts
├── constants/rateLimiter.constant.ts ADAPT constants/rateLimiter.constant.ts (prefixes)
├── config/redis.ts                  ADAPT config/redis.ts (no cache config)
├── config/rateLimiter.ts            ADAPT config/rateLimiter.ts (this project's limits)
├── jobs/redis/connection.ts         COPY  jobs/redis/connection.ts (used by /health now, BullMQ in Phase 09)
├── middleware/rateLimiter.ts        COPY  middleware/rateLimiter.ts
├── middleware/visitorId.ts          COPY  middleware/visitorId.ts
├── types/express.d.ts               (visitorId added)
├── constants/env.ts                 (REDIS_*, TRUSTED_PROXY_CIDRS)
├── routes/auth.route.ts             (limiters on login and refresh)
├── app.ts                           (trust proxy, visitorId, globalLimiter, redis in /health)
└── index.ts                         (close the redis connection on shutdown)
```

## 5. Concepts

**Sliding-window log.** Each request is stored as a member of a Redis sorted set, scored by its
timestamp. To decide a new request: delete members older than the window, count what's left, and if
under the limit, add this one. Unlike a fixed window ("100 per clock minute"), there is no burst at
the edge where a client gets 100 at 12:00:59 and 100 more at 12:01:00.

**Why Lua.** "Delete old, count, maybe add" is three commands. If two API instances ran them
interleaved, both could read 99 and both add, allowing 101. Redis runs a Lua script as one atomic
step: no other command runs in between. That's the only reason the algorithm is in Lua.

**Three variants (all copied).** _Single bucket_ for ordinary limits. _Punitive_: exceeding the limit
sets a lock key that blocks the key for a fixed time (login per IP+email). _Dual bucket_: two keys
checked together and committed only if both pass (the global limiter: per browser and per IP).

**Circuit breaker + memory fallback.** If Redis is down, every request would wait for a timeout and
then either fail (blocking all traffic) or skip limiting (opening the gates). The breaker counts
failures; after 10 in a row it "opens" and the limiter uses an in-memory store instead, so limits
still apply — per process rather than globally. After 30 seconds one probe request tries Redis again
("half-open"); success closes the breaker.

**Login on three axes.** Per (IP, email) — punitive: locks that pair for 30 minutes. Per email — not
punitive, because anyone can type someone else's email, and a lockout on it would let anyone lock a
staff member out. Per IP — loose, to catch one machine trying many accounts. Each stops a different
attack; e-commerce's config explains each in comments you're copying.

**Client IP behind proxies.** On Render the TCP connection comes from Render's proxy, not the user.
The real IP is in headers, which clients can forge. `extractClientIp` trusts headers only when the
connection comes from an address listed in `TRUSTED_PROXY_CIDRS`. Empty locally (no proxy).

**Sizing limits for an LLM endpoint.** A shop's catalog limit protects the database. A chat limit
protects **money and quota**: each message is several model calls. The chat limiter is a dual bucket:
a visitor gets 20 messages per 10 minutes (far above a real conversation's pace), an IP gets 60 (a
household or office shares one), plus a daily cap of 100 messages per visitor so a slow, patient
script still can't drain the free tier.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter api add ioredis@^5.11.1 proxy-addr@^2.0.8 ipaddr.js@^2.5.0
pnpm --filter api add -D @types/proxy-addr@^2.0.3
```

ioredis 6 exists, but the copied limiter is written against 5's API; staying on 5 keeps "copy
verbatim" true.

### Step 2 — Env

Append to `env.ts` (copied from mongo's lines):

```ts
export const REDIS_HOST = getEnv("REDIS_HOST");
export const REDIS_PORT = getEnv("REDIS_PORT");
// Empty for a local passwordless Redis; set both for a hosted one.
export const REDIS_USERNAME = getEnv("REDIS_USERNAME", "");
export const REDIS_PASSWORD = getEnv("REDIS_PASSWORD", "");
export const TRUSTED_PROXY_CIDRS = getEnv("TRUSTED_PROXY_CIDRS", "");
```

### Step 3 — Copy the limiter

Copy every file listed under "COPY" in section 4. In each, change only relative imports to end in
`.js` and point `../constants/https` at `../constants/http.js`. Do not "tidy" anything: this code is
correct and tested by hand in production, and you want it identical so you can diff it against the
original later.

`src/config/redis.ts` — copy, delete `getCacheRedisConfig` and its comment (no cache in this
project), keep `getRedisConfig` (BullMQ, Phase 09) and `getRateLimiterRedisConfig` (fails fast so the
breaker trips quickly), keep both long explanatory comments at the bottom.

`src/constants/rateLimiter.constant.ts` — copy, then replace the prefix block with only the prefixes
this project uses, and add chat and day constants:

```ts
export const DEFAULT_KEY_PREFIX = "rl:global";
export const GLOBAL_VISITOR_PREFIX = "rl:global:guest";
export const GLOBAL_IP_PREFIX = "rl:global:ip";

export const AUTH_LOGIN_PREFIX = "rl:auth:login";
export const AUTH_LOGIN_ACCOUNT_PREFIX = "rl:auth:login:account";
export const AUTH_LOGIN_SOURCE_PREFIX = "rl:auth:login:source";
export const AUTH_REFRESH_PREFIX = "rl:auth:refresh";
export const AUTH_REFRESH_SOURCE_PREFIX = "rl:auth:refresh:source";

export const CHAT_VISITOR_PREFIX = "rl:chat:visitor";
export const CHAT_IP_PREFIX = "rl:chat:ip";
export const CHAT_DAILY_PREFIX = "rl:chat:daily";
```

Keep `HTTP_HEADERS`, the time constants and `CIRCUIT_BREAKER_DEFAULTS` unchanged, and add:

```ts
export const TEN_MINUTES_MS = 10 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
```

`src/types/express.d.ts` — add the field the copied middleware sets:

```ts
      visitorId?: string;
```

### Step 4 — `src/config/rateLimiter.ts`

ADAPT. Copied unchanged from mongo: the four key resolvers (`ipAndEmailKeyResolver`,
`emailKeyResolver`, `ipKeyResolver`, `visitorKeyResolver`, `refreshSessionKeyResolver`) with their
comments, `globalLimiter`, the three login limiters with their comments, and the two refresh
limiters. Removed: register, forgot/reset password, verify, checkout, promo, catalog, protected API.
Added: the chat limiters.

```ts
// …copied imports (with .js), resolvers, globalLimiter, login and refresh limiters…

/*
  Chat. Every message costs several model calls, so these limits protect quota and money, not the
  server. A real conversation is a message every few seconds at most; 20 per 10 minutes per browser
  is far above that. The IP bucket is looser because an office or household shares one address.
 */
export const chatLimiter = createDualRateLimiter({
  visitorPrefix: CHAT_VISITOR_PREFIX,
  ipPrefix: CHAT_IP_PREFIX,
  windowMs: TEN_MINUTES_MS,
  visitorLimit: 20,
  ipLimit: 60,
  visitorKeyResolver: (req: Request) => visitorKeyResolver(req),
  ipKeyResolver: (req: Request) => extractClientIp(req),
});

// A patient script stays under the 10-minute limit forever; this caps a browser's whole day.
export const chatDailyLimiter = createRateLimiter({
  prefix: CHAT_DAILY_PREFIX,
  windowMs: ONE_DAY_MS,
  max: 100,
  keyResolver: (req: Request) => `guest:${visitorKeyResolver(req)}`,
});
```

The global limiter's numbers (500 per browser, 2000 per IP per 5 minutes) are kept: they're a flood
defence, not a business rule, and still fit.

### Step 5 — Wire it

`app.ts`, in this order (the same order as e-commerce's `index.ts`):

```ts
import { trustProxy } from "./utils/rateLimiter/index.js";
import { visitorIdMiddleware } from "./middleware/visitorId.js";
import { globalLimiter } from "./config/rateLimiter.js";
import { redisConnection } from "./jobs/redis/connection.js";
// …
const app = express();
// Trust exactly the proxies the rate limiter trusts, so req.ip and the limiter agree.
app.set("trust proxy", trustProxy);
app.use(requestId);
app.use(helmet(/* … */));
app.use(cors(/* … */));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(visitorIdMiddleware);
app.use(globalLimiter);
```

`visitorIdMiddleware` reads `req.cookies`, so it must come after `cookieParser`. The global limiter
uses `req.visitorId`, so after that.

Update `/health` to report Redis without failing on it (mongo's rule: Redis is reported but not fatal,
because the limiter degrades to memory):

```ts
app.get("/health", async (_req, res) => {
  const [postgresUp, redisUp] = await Promise.all([
    pool.query("SELECT 1").then(
      () => true,
      () => false,
    ),
    redisConnection.ping().then(
      () => true,
      () => false,
    ),
  ]);

  res.status(postgresUp ? 200 : SERVICE_UNAVAILABLE).json(
    ok({
      status: postgresUp ? "ok" : "degraded",
      postgres: postgresUp ? "up" : "down",
      redis: redisUp ? "up" : "down",
    }),
  );
});
```

`jobs/redis/connection.ts` — copy, change `console.*` to `logger.info` / `logger.error` with an
`{ error }` field.

`index.ts` shutdown, after `closeDB()`:

```ts
await redisConnection.quit();
```

`routes/auth.route.ts`:

```ts
import {
  loginAccountLimiter,
  loginLimiter,
  loginSourceLimiter,
  refreshTokenLimiter,
  refreshTokenSourceLimiter,
} from "../config/rateLimiter.js";
// …
authRoutes.post(
  "/login",
  loginSourceLimiter,
  loginAccountLimiter,
  loginLimiter,
  loginHandler,
);
authRoutes.get(
  "/refresh",
  refreshTokenSourceLimiter,
  refreshTokenLimiter,
  refreshHandler,
);
```

The login limiters read `req.body.email`, so they run after `express.json()` — which they do,
because route middleware runs after app-level middleware. The chat limiters are attached to the chat
route in Phase 16.

## 7. Commit points

1. `feat(api): copy redis sliding-window rate limiter with circuit breaker`
2. `feat(api): add visitor id cookie and global limiter`
3. `feat(api): limit staff login and refresh, define chat limits`
4. `feat(api): report redis in health check and close it on shutdown`

## 8. Verify

```bash
# Login lockout: 10 bad tries for the same IP+email, then 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:4000/auth/login \
    -H 'content-type: application/json' -d '{"email":"ana@firm.test","password":"wrong"}'
done; echo
# 401 401 401 401 401 401 401 401 401 401 429 429

curl -s -i -X POST localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@firm.test","password":"wrong"}' | grep -i -E "retry-after|x-ratelimit"
# Retry-After: ~1800, X-RateLimit-* headers

docker exec counseldesk-redis redis-cli --scan --pattern 'rl:*' | head
# rl:auth:login:ip:…:email:ana@firm.test, …:blocked, rl:global:guest:…, …

# visitorId cookie is issued
curl -s -i localhost:4000/health | grep -i set-cookie   # visitorId=…; HttpOnly; SameSite=Lax

# Health shows redis
curl -s localhost:4000/health   # …"redis":"up"

# Fallback: stop Redis; requests still work and are still limited (per process)
docker compose stop redis
curl -s localhost:4000/health   # 200, "redis":"down"
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:4000/auth/login -H 'content-type: application/json' -d '{"email":"x@y.z","password":"wrong"}'; done; echo
# 401s then 429 — the memory store took over after the breaker opened
docker compose start redis

# Reset limits while developing
docker exec counseldesk-redis redis-cli --scan --pattern 'rl:*' | xargs -r docker exec -i counseldesk-redis redis-cli del
```

## 9. Common mistakes

- **Mounting the limiter before `cookieParser` / `visitorIdMiddleware`.** Every request looks like a
  new visitor and the browser bucket is useless.
- **"Simplifying" the Lua script into separate commands.** Reintroduces the race the script exists to
  prevent.
- **Setting `TRUSTED_PROXY_CIDRS` to `0.0.0.0/0`.** Trusts forged `X-Forwarded-For` from anyone;
  an attacker rotates fake IPs and every IP limit disappears.
- **Leaving it empty in production behind Render's proxy.** Every visitor shares the proxy's IP and
  one bucket (the copied code logs a warning about this in e-commerce; add the same warning in
  `index.ts` if you like).
- **Using the same Redis with eviction for anything.** Limit windows and BullMQ jobs would be evicted
  under memory pressure; this instance is `noeviction` for that reason.
- **Forgetting the daily cap** and discovering a scraper spent the month's free quota in a night.

## 10. Interview prep

**Q: How does your rate limiter work?**
A: Sliding-window log in a Redis sorted set: each request is a member scored by timestamp; a Lua
script atomically prunes expired members, counts, and either rejects or records the request. Lua
makes it atomic across many API instances. There's a punitive variant with a lockout and a dual
variant that checks a per-browser and a per-IP bucket together.

**Q: What happens when Redis goes down?**
A: A circuit breaker opens after repeated failures and the limiter switches to an in-memory store, so
limits keep applying per instance instead of failing open or blocking everyone. It probes Redis again
after 30 seconds.

**Q: How did you choose limits for the chat endpoint?**
A: From cost, not server load: each message triggers several model calls. A per-browser short-window
limit well above human pace, a looser per-IP limit for shared networks, and a daily per-browser cap
so a slow script can't drain the free tier.

**Q: Why isn't the per-account login limit a lockout?**
A: Its key is just the email, which anyone can type. A lockout there would let anyone lock any staff
member out. It's a plain sliding window: it caps guesses but the real user gets back in as soon as
the window moves.

## 11. Resume-safe claim

"Reused an atomic Redis/Lua sliding-window rate limiter with circuit-breaker fallback, and designed
quota-protecting limits for a public LLM chat endpoint."

## 12. Definition of done

- [ ] Repeated bad logins reach 429 with `Retry-After`
- [ ] A `visitorId` cookie is set on first request
- [ ] `/health` reports Redis up/down; the API stays up with Redis stopped
- [ ] Limits still apply (in memory) with Redis stopped
- [ ] Chat limiters are defined (used in Phase 16)
- [ ] Shutdown closes Redis after Postgres
