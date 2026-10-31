-- SPDX-License-Identifier: GPL-3.0-or-later
-- chimimouryou KOReader plugin: the server's HTTP API (server/api/service.py, server/account/service.py).
-- The token goes only to https:// addresses and never into logs or messages (redact()).

local http = require("socket.http")
local ltn12 = require("ltn12")
local rapidjson = require("rapidjson")
local socket = require("socket")
local socketutil = require("socketutil")
local _ = require("gettext")

local Api = {}
Api.__index = Api

--- base: the server's address ("https://books.example"), token: a session token or nil.
function Api.new(base, token)
    return setmetatable({ base = (base or ""):gsub("/+$", ""), token = token }, Api)
end

function Api:secure()
    return self.base:match("^https://") ~= nil
end

--- The text with the token cut out, for anything shown or logged.
function Api:redact(text)
    text = tostring(text or "")
    if self.token and self.token ~= "" then
        text = text:gsub(self.token:gsub("%W", "%%%0"), "…")
    end
    return text
end

local function encode_path(path)
    return (path:gsub("[^%w%-%._~/]", function(c) return string.format("%%%02X", c:byte()) end))
end
Api.encode_path = encode_path

local function query(params)
    local parts = {}
    for key, value in pairs(params) do
        if value ~= nil and value ~= "" then
            table.insert(parts, key .. "=" .. encode_path(tostring(value)):gsub("/", "%%2F"))
        end
    end
    table.sort(parts)
    return #parts > 0 and "?" .. table.concat(parts, "&") or ""
end

--- One request. Returns status, decoded JSON body (or nil), error text (nil on 2xx).
--- `sink` (a ltn12 sink) takes the body instead, for downloads.
function Api:request(method, path, body, sink, timeouts)
    local headers = { ["Accept"] = "application/json", ["Accept-Encoding"] = "identity" }
    -- Tokens only over HTTPS: the server ignores them over HTTP anyway, and they'd travel in clear.
    if self.token and self:secure() then headers["Authorization"] = "Bearer " .. self.token end
    local source
    if body then
        local data = rapidjson.encode(body)
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = tostring(#data)
        source = ltn12.source.string(data)
    end
    local chunks = {}
    socketutil:set_timeout(unpack(timeouts or { socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT }))
    local ok, code, response_headers = pcall(function()
        return socket.skip(1, http.request{
            url = self.base .. path,
            method = method,
            headers = headers,
            source = source,
            sink = sink or socketutil.table_sink(chunks),
            -- A redirect could hand the token to another host.
            redirect = false,
        })
    end)
    socketutil:reset_timeout()
    if not ok then return nil, nil, self:redact(code) end
    if type(code) ~= "number" then
        return nil, nil, self:redact(code or _("No answer from the server"))
    end
    local decoded
    if not sink and #chunks > 0 then
        local parsed = rapidjson.decode(table.concat(chunks))
        if type(parsed) == "table" then decoded = parsed end
    end
    if code >= 200 and code < 300 then return code, decoded end
    local message = decoded and type(decoded.error) == "string" and decoded.error
    if not message then
        if code == 401 then message = _("Sign in to the server first")
        elseif code >= 300 and code < 400 then
            message = _("The server redirected the request: check the address (https://, no path)")
        else message = "HTTP " .. code end
    end
    return code, decoded, self:redact(message), response_headers
end

function Api:sign_in(username, password, label)
    return self:request("POST", "/account/api/token",
        { username = username, password = password, client = "KOReader", label = label })
end

function Api:sign_out()
    return self:request("POST", "/account/api/token/revoke", {})
end

function Api:version()
    return self:request("GET", "/api/v1/version")
end

function Api:books(q, cursor)
    return self:request("GET", "/api/v1/books" .. query{ q = q, cursor = cursor, limit = 50 })
end

function Api:sync(since)
    return self:request("GET", "/api/v1/sync" .. query{ since = since or 0 })
end

function Api:put(path, modified, data, extra)
    local body = { modified = modified, data = data }
    for key, value in pairs(extra or {}) do body[key] = value end
    return self:request("PUT", "/api/v1/" .. path, body)
end

function Api:difficulty()
    return self:request("GET", "/calibre/difficulty.json")
end

--- Downloads a catalog book's `file` to `dest`; returns true or false and the error.
function Api:download(file, dest)
    local handle, err = io.open(dest, "wb")
    if not handle then return false, err end
    local code, _body, message = self:request("GET", "/calibre/library/" .. encode_path(file), nil,
        socketutil.file_sink(handle), { socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT })
    if code ~= 200 then
        os.remove(dest)
        return false, message or ("HTTP " .. tostring(code))
    end
    return true
end

return Api
