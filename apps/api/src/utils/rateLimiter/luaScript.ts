/**
 * Atomic Dual-Bucket Sliding Window Lua Script
 *
 * KEYS[1]: visitorKey (guest:<visitorId>)
 * KEYS[2]: ipKey (ip:<clientIp>)
 * ARGV[1]: now (Unix timestamp in milliseconds)
 * ARGV[2]: windowMs (Sliding window duration in milliseconds)
 * ARGV[3]: visitorLimit (Max allowed requests for visitor bucket)
 * ARGV[4]: ipLimit (Max allowed requests for aggregate IP bucket)
 * ARGV[5]: requestId (Unique collision-free request identifier)
 *
 * Returns:
 * [1] allowed (1 = allowed, 0 = rejected)
 * [2] visitorHits
 * [3] visitorRemaining
 * [4] ipHits
 * [5] ipRemaining
 * [6] resetTimeMs
 * [7] rejectedReason (0 = none, 1 = visitor, 2 = ip)
 */
export const DUAL_SLIDING_WINDOW_LUA = `
local visitorKey = KEYS[1]
local ipKey = KEYS[2]

local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local visitorLimit = tonumber(ARGV[3])
local ipLimit = tonumber(ARGV[4])
local requestId = ARGV[5]

if not now or not windowMs or not visitorLimit or not ipLimit or not requestId then
    return redis.error_reply("invalid dual rate limiter arguments")
end

local windowStart = now - windowMs

-- 1. Prune expired entries from both sliding windows
redis.call("ZREMRANGEBYSCORE", visitorKey, "-inf", windowStart)
redis.call("ZREMRANGEBYSCORE", ipKey, "-inf", windowStart)

-- 2. Count current requests
local visitorHits = redis.call("ZCARD", visitorKey)
local ipHits = redis.call("ZCARD", ipKey)

-- 3. Find oldest surviving request in each window
local visitorOldest = redis.call("ZRANGE", visitorKey, 0, 0, "WITHSCORES")
local ipOldest = redis.call("ZRANGE", ipKey, 0, 0, "WITHSCORES")

local visitorReset = now + windowMs
local ipReset = now + windowMs

if #visitorOldest > 0 then
    visitorReset = tonumber(visitorOldest[2]) + windowMs
end

if #ipOldest > 0 then
    ipReset = tonumber(ipOldest[2]) + windowMs
end

-- 4. Check visitor threshold
if visitorHits >= visitorLimit then
    local resetTimeMs = visitorReset
    if ipHits >= ipLimit and ipReset > resetTimeMs then
        resetTimeMs = ipReset
    end
    return {
        0,                                  -- allowed = 0
        visitorHits,                        -- visitorHits
        0,                                  -- visitorRemaining
        ipHits,                             -- ipHits
        math.max(0, ipLimit - ipHits),      -- ipRemaining
        resetTimeMs,                        -- resetTimeMs of limiting bucket
        1                                   -- rejectedReason = visitor
    }
end

-- 5. Check IP threshold
if ipHits >= ipLimit then
    local resetTimeMs = ipReset
    if visitorHits >= visitorLimit and visitorReset > resetTimeMs then
        resetTimeMs = visitorReset
    end
    return {
        0,                                  -- allowed = 0
        visitorHits,                        -- visitorHits
        math.max(0, visitorLimit - visitorHits),
        ipHits,                             -- ipHits
        0,                                  -- ipRemaining
        resetTimeMs,                        -- resetTimeMs of limiting bucket
        2                                   -- rejectedReason = IP
    }
end

-- 6. Both passed: Commit request to both sorted sets
local member = now .. ":" .. requestId

redis.call("ZADD", visitorKey, now, member)
redis.call("PEXPIRE", visitorKey, windowMs)

redis.call("ZADD", ipKey, now, member)
redis.call("PEXPIRE", ipKey, windowMs)

local newVisitorHits = visitorHits + 1
local newIpHits = ipHits + 1

if visitorHits == 0 then
    visitorReset = now + windowMs
end

-- On success, resetTimeMs reflects the primary visitor bucket's window recovery
return {
    1,                                      -- allowed = 1
    newVisitorHits,                         -- visitorHits
    math.max(0, visitorLimit - newVisitorHits),
    newIpHits,                              -- ipHits
    math.max(0, ipLimit - newIpHits),
    visitorReset,                           -- resetTimeMs
    0                                       -- rejectedReason = none
}
`;

/**
 * Atomic Punitive Single-Bucket Sliding Window Lua Script
 * Used for authentication defense (login, register, forgot-password).
 *
 * KEYS[1]: key (e.g. rl:auth:login:ip:<ip>:email:<email>)
 * KEYS[2]: lockKey (e.g. rl:auth:login:ip:<ip>:email:<email>:blocked)
 * ARGV[1]: now (Unix timestamp in milliseconds)
 * ARGV[2]: windowMs (Sliding window duration in milliseconds)
 * ARGV[3]: limit (Max allowed requests)
 * ARGV[4]: lockoutMs (Duration in ms to block when threshold is exceeded)
 * ARGV[5]: requestId (Unique request identifier)
 *
 * Returns:
 * [1] allowed (1 = allowed, 0 = rejected)
 * [2] isLocked (1 = true, 0 = false)
 * [3] totalHits
 * [4] remaining
 * [5] resetTimeMs
 */
export const PUNITIVE_SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local lockKey = KEYS[2]

local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local lockoutMs = tonumber(ARGV[4])
local requestId = ARGV[5]

if not now or not windowMs or not limit or not lockoutMs or not requestId then
    return redis.error_reply("invalid punitive rate limiter arguments")
end

-- 1. Check if active lockout exists
local lockTtl = redis.call("PTTL", lockKey)
if lockTtl >= 0 then
    return {
        0,              -- allowed = 0
        1,              -- isLocked = 1
        limit,          -- hits
        0,              -- remaining
        now + lockTtl   -- resetTimeMs
    }
elseif lockTtl == -1 then
    -- Key exists with no TTL: treat as permanent/indefinite lock
    return {
        0,              -- allowed = 0
        1,              -- isLocked = 1
        limit,          -- hits
        0,              -- remaining
        0               -- resetTimeMs (0 signifies indefinite)
    }
end

local windowStart = now - windowMs

-- 2. Prune expired entries
redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

-- 3. Count current requests
local hits = redis.call("ZCARD", key)

-- 4. Find oldest request for accurate sliding-window reset
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local resetTimeMs = now + windowMs
if #oldest > 0 then
    resetTimeMs = tonumber(oldest[2]) + windowMs
end

-- 5. Threshold exceeded: atomically create lock key
if hits >= limit then
    redis.call("SET", lockKey, "1", "PX", lockoutMs)
    redis.call("DEL", key) -- reset window counter so count starts fresh after lock expires
    return {
        0,                  -- allowed = 0
        1,                  -- isLocked = 1
        hits,               -- hits
        0,                  -- remaining
        now + lockoutMs     -- resetTimeMs
    }
end

-- 6. Allowed: commit request member
local member = now .. ":" .. requestId
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, windowMs)

local newHits = hits + 1
if hits == 0 then
    resetTimeMs = now + windowMs
end

return {
    1,                              -- allowed = 1
    0,                              -- isLocked = 0
    newHits,                        -- hits
    math.max(0, limit - newHits),   -- remaining
    resetTimeMs                     -- resetTimeMs
}
`;

/**
 * Standard Non-Punitive Single-Bucket Sliding Window Lua Script
 * Used for catalog browsing, protected user APIs, checkout, and promo codes.
 *
 * KEYS[1]: key
 * ARGV[1]: now
 * ARGV[2]: windowMs
 * ARGV[3]: limit
 * ARGV[4]: requestId
 *
 * Returns:
 * [1] allowed (1 = allowed, 0 = rejected)
 * [2] totalHits
 * [3] remaining
 * [4] resetTimeMs
 */
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]

local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local requestId = ARGV[4]

if not now or not windowMs or not limit or not requestId then
    return redis.error_reply("invalid sliding window rate limiter arguments")
end

local windowStart = now - windowMs

-- 1. Prune expired entries
redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

-- 2. Count current requests inside window
local hits = redis.call("ZCARD", key)

-- 3. Calculate true reset time based on oldest surviving request
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local resetTimeMs = now + windowMs
if #oldest > 0 then
    resetTimeMs = tonumber(oldest[2]) + windowMs
end

-- 4. Check threshold
if hits >= limit then
    return {
        0,                          -- allowed = 0
        hits,                       -- hits
        0,                          -- remaining
        resetTimeMs                 -- resetTimeMs
    }
end

-- 5. Commit request member
local member = now .. ":" .. requestId
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, windowMs)

local newHits = hits + 1
if hits == 0 then
    resetTimeMs = now + windowMs
end

return {
    1,                              -- allowed = 1
    newHits,                        -- hits
    math.max(0, limit - newHits),   -- remaining
    resetTimeMs                     -- resetTimeMs
}
`;
