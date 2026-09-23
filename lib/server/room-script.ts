export const roomScript = `
local operation = ARGV[1]
local now = tonumber(ARGV[2])
local input = cjson.decode(ARGV[3])
local day = 86400000
local roomTtl = 604800
local function failure(code)
  return cjson.encode({error = code})
end
if operation == 'create' then
  if redis.call('EXISTS', KEYS[1]) == 1 then return failure('ROOM_EXISTS') end
  redis.call('HSET', KEYS[1], 'created_at', now, 'paid_until', 0, 'sequence', 0)
  redis.call('EXPIRE', KEYS[1], roomTtl)
  return cjson.encode({room_id = input.room_id, message_retention_hours = 24, participant_limit = 3})
end
if redis.call('EXISTS', KEYS[1]) == 0 then return failure('ROOM_NOT_FOUND') end
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
for _, token in ipairs(expired) do
  redis.call('HDEL', KEYS[3], token)
  redis.call('ZREM', KEYS[4], token)
end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now - day)
local paidUntil = tonumber(redis.call('HGET', KEYS[1], 'paid_until'))
local paid = paidUntil > now
local ttl = math.max(roomTtl, math.ceil((paidUntil - now) / 1000) + roomTtl)
for _, key in ipairs(KEYS) do redis.call('EXPIRE', key, ttl) end
local function canSend(token)
  local rank = redis.call('ZRANK', KEYS[4], token)
  return rank and (paid or rank < 3)
end
if operation == 'info' then
  return cjson.encode({room_id = input.room_id, created_at = tonumber(redis.call('HGET', KEYS[1], 'created_at')), paid_until = paidUntil, participant_limit = paid and cjson.null or 3, active_participants = redis.call('ZCARD', KEYS[2]), message_retention_hours = 24})
end
if operation == 'join' then
  local existing = redis.call('HGET', KEYS[3], input.token_hash)
  if existing then
    redis.call('ZADD', KEYS[2], now + 90000, input.token_hash)
    local participant = cjson.decode(existing)
    participant.can_send = canSend(input.token_hash)
    return cjson.encode(participant)
  end
  if input.resume then return failure('SESSION_EXPIRED') end
  if not paid and redis.call('ZCARD', KEYS[2]) >= 3 then return failure('ROOM_FULL') end
  local sequence = redis.call('HINCRBY', KEYS[1], 'sequence', 1)
  local participant = {participant_id = input.participant_id, name = input.name, joined_at = now}
  redis.call('HSET', KEYS[3], input.token_hash, cjson.encode(participant))
  redis.call('ZADD', KEYS[2], now + 90000, input.token_hash)
  redis.call('ZADD', KEYS[4], sequence, input.token_hash)
  for index = 2, 4 do redis.call('EXPIRE', KEYS[index], ttl) end
  participant.can_send = true
  return cjson.encode(participant)
end
if operation == 'read' then
  local after = input.after or '0-0'
  local afterTime, afterSequence = string.match(after, '^(%d+)%-(%d+)$')
  afterTime = tonumber(afterTime)
  afterSequence = tonumber(afterSequence)
  local ids = redis.call('ZRANGEBYSCORE', KEYS[5], math.max(now - day + 1, afterTime), '+inf')
  local messages = {}
  local cursor = after
  local hasMore = false
  for _, id in ipairs(ids) do
    local timestamp, sequence = string.match(id, '^(%d+)%-(%d+)$')
    if tonumber(timestamp) > afterTime or (tonumber(timestamp) == afterTime and tonumber(sequence) > afterSequence) then
      local payload = redis.call('GET', KEYS[1] .. ':message:' .. id)
      if payload then
        if #messages >= input.limit then hasMore = true; break end
        table.insert(messages, cjson.decode(payload))
        cursor = id
      end
    end
  end
  local historyGap = after ~= '0-0' and afterTime <= now - day
  if historyGap and #messages == 0 then cursor = string.format('%.0f-0', now) end
  return cjson.encode({messages = messages, next_cursor = cursor, has_more = hasMore, history_gap = historyGap})
end
local rawParticipant = redis.call('HGET', KEYS[3], input.token_hash)
if not rawParticipant then return failure('SESSION_EXPIRED') end
if operation == 'leave' then
  redis.call('HDEL', KEYS[3], input.token_hash)
  redis.call('ZREM', KEYS[2], input.token_hash)
  redis.call('ZREM', KEYS[4], input.token_hash)
  return cjson.encode({left = true})
end
redis.call('ZADD', KEYS[2], now + 90000, input.token_hash)
if operation == 'heartbeat' then
  return cjson.encode({lease_expires_at = now + 90000, can_send = canSend(input.token_hash)})
end
if operation == 'send' then
  local dedupeKey = KEYS[1] .. ':dedupe:' .. input.token_hash .. ':' .. input.idempotency_hash
  local previous = redis.call('GET', dedupeKey)
  if previous then
    previous = cjson.decode(previous)
    if previous.fingerprint ~= input.fingerprint then return failure('IDEMPOTENCY_CONFLICT') end
    if previous.message.expires_at > now then return cjson.encode(previous.message) end
  end
  if not canSend(input.token_hash) then return failure('ROOM_FULL') end
  if redis.call('ZCARD', KEYS[5]) >= 1000 then return failure('ROOM_STORAGE_FULL') end
  for _, rate in ipairs({{KEYS[1] .. ':rate', 300}, {KEYS[1] .. ':rate:' .. input.token_hash, 60}}) do
    local count = redis.call('INCR', rate[1])
    if count == 1 then redis.call('EXPIRE', rate[1], 60) end
    if count > rate[2] then return failure('RATE_LIMITED') end
  end
  local sequence = redis.call('HINCRBY', KEYS[1], 'sequence', 1)
  now = math.max(now, tonumber(redis.call('HGET', KEYS[1], 'last_message_at') or 0))
  redis.call('HSET', KEYS[1], 'last_message_at', now)
  local id = string.format('%.0f-%012d', now, sequence)
  local participant = cjson.decode(rawParticipant)
  local message = {id = id, participant_id = participant.participant_id, name = participant.name, text = input.text, data_json = input.data_json, created_at = now, expires_at = now + day}
  local encoded = cjson.encode(message)
  redis.call('SET', KEYS[1] .. ':message:' .. id, encoded, 'PX', day)
  redis.call('SET', dedupeKey, cjson.encode({fingerprint = input.fingerprint, message = message}), 'PX', day)
  redis.call('ZADD', KEYS[5], now, id)
  redis.call('EXPIRE', KEYS[5], ttl)
  return encoded
end
return failure('BAD_OPERATION')
`;
