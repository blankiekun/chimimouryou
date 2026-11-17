-- Self-check for main.lua's day start, pending reading time, mirror, statistics summary and settings,
-- and api.lua's X-Expected-Account, with KOReader's modules stubbed.
-- Run from apps/koreader: luajit tools/stats-check.lua chimimouryou.koplugin (prints "ok").
local plugin = arg[1]
package.path = plugin .. "/?.lua;" .. package.path
local function stub(name, value) package.preload[name] = function() return value end end
local null = setmetatable({}, { __tostring = function() return "null" end })
local function deepcopy(t)
    if type(t) ~= "table" then return t end
    local o = {}
    for k, v in pairs(t) do o[k] = deepcopy(v) end
    return o
end
for _, name in ipairs{ "ui/widget/confirmbox", "datastorage", "device", "ui/event", "ui/widget/infomessage",
    "ui/widget/inputdialog", "luasettings", "ui/widget/multiinputdialog", "ui/network/manager",
    "ui/uimanager", "logger", "charcount", "api", "dispatcher", "ui/widget/textviewer", "libs/libkoreader-lfs" } do
    stub(name, { info = function() end, new = function() end, show = function() end })
end
stub("ui/widget/container/widgetcontainer", { extend = function(_, t) return t end })
stub("util", { tableDeepCopy = deepcopy })
stub("ffi/util", { template = function(s) return s end })
stub("gettext", function(s) return s end)
stub("rapidjson", { null = null })
local library_reset
stub("library", { reset = function() library_reset = true end })

local Chimi = dofile(plugin .. "/main.lua")

local function store()
    local data = {}
    return { readSetting = function(_, k, d) if data[k] == nil then data[k] = d end return data[k] end,
        saveSetting = function(_, k, v) data[k] = v end, delSetting = function(_, k) data[k] = nil end,
        flush = function() end, data = data }
end

local function new()
    local c = setmetatable({ store = store() }, { __index = Chimi })
    c:set("books", { ["7"] = true })
    return c
end

-- Bug 22: the day starts at the account's hour.
local real_time = os.time
local fake_now
os.time = function(t) if t == nil then return fake_now end return real_time(t) end
local c = new()
c.bookId = function() return 7, { title = "book" } end
local count = 0
c.currentCount = function() count = count + 10 return count end
c:set("day_start", 4)
fake_now = real_time{ year = 2026, month = 3, day = 1, hour = 1, min = 30 }
c:countPageTurn()
fake_now = fake_now + 60
c:countPageTurn()
assert(c:get("pending")["7"].days["2026-02-28"], "01:30 with a 4:00 start counts for the day before")
c:set("day_start", 0)
fake_now = fake_now + 60
c:countPageTurn()
assert(c:get("pending")["7"].days["2026-03-01"], "midnight start keeps the calendar date")

-- pullSettings reads the settings doc, keeps the last hour on errors.
c:pullSettings({ doc = function() return 200, { data = { values = { startDayHoursForTracker = 5 } } } end })
assert(c:get("day_start") == 5)
c:pullSettings({ doc = function() return 404, nil end })
assert(c:get("day_start") == 5)
c:pullSettings({ doc = function() return 200, { data = { values = { startDayHoursForTracker = 30 } } } end })
assert(c:get("day_start") == 0)
os.time = real_time

-- Bug 23: a PUT committed but its answer lost is not added again.
local puts = {}
local answer
local api = { put = function(_, path, modified, data)
    puts[#puts + 1] = { modified = modified, data = deepcopy(data) }
    return answer(modified, data)
end }
c = new()
c:set("stats", { ["7"] = { ["2026-03-01"] = { modified = 1000, data = { readingTime = 100, charactersRead = 50 } } } })
c:set("pending", { ["7"] = { title = "book", days = { ["2026-03-01"] = { seconds = 60, characters = 30 } } } })
local server
answer = function(modified, data) server = { modified = modified, data = deepcopy(data) } return nil end -- lost
c:pushStatistics(api)
assert(server.data.readingTime == 160)
assert(c:get("pending")["7"].days["2026-03-01"].sent, "the sent amount is remembered")
-- Read 20 s more, then the next pull brings the committed row.
c:get("pending")["7"].days["2026-03-01"].seconds = 80
c:get("stats")["7"]["2026-03-01"] = { modified = server.modified, data = server.data }
answer = function(modified, data) server = { modified = modified, data = deepcopy(data) } return 200, {} end
c:pushStatistics(api)
assert(server.data.readingTime == 180, "only the 20 s read since are added: " .. server.data.readingTime)
assert(server.data.charactersRead == 80)
assert(c:get("pending")["7"] == nil)

-- Lost answer, nothing read since: the day just leaves pending.
c:set("pending", { ["7"] = { title = "book", days = { ["2026-03-01"] = { seconds = 10, characters = 0 } } } })
answer = function(modified, data) server = { modified = modified, data = deepcopy(data) } return nil end
c:pushStatistics(api)
c:get("stats")["7"]["2026-03-01"] = { modified = server.modified, data = server.data }
local before = #puts
c:pushStatistics(api)
assert(#puts == before and c:get("pending")["7"] == nil)

-- A PUT that never landed (row unchanged) is sent whole again.
c:set("pending", { ["7"] = { title = "book", days = { ["2026-03-01"] = { seconds = 10, characters = 0 } } } })
local base = server.data.readingTime
answer = function() return nil end
c:pushStatistics(api)
answer = function(modified, data) server = { modified = modified, data = deepcopy(data) } return 200, {} end
c:pushStatistics(api)
assert(server.data.readingTime == base + 10)

-- pullSettings keeps the Home titles (strings) and removals (numbers), and keeps them on a 404.
c = new()
c:pullSettings({ doc = function() return 200, { data = { values = {
    homeBookTitles = { "a", 3, "b" }, homeRemovedTitles = { a = 5, b = "x" } } } } end })
assert(#c:get("home").titles == 2 and c:get("home").titles[2] == "b")
assert(c:get("home").removed.a == 5 and c:get("home").removed.b == nil)
c:pullSettings({ doc = function() return 404, nil end })
assert(c:get("home").titles[1] == "a")

-- The mirror keeps every book's rows (book 9 isn't downloaded), from rev_all 0 (the old rev is ignored).
c = new()
c:set("rev", 3)
local since
local sync_api = { sync = function(_, s)
    since = s
    return 200, { rev = 5,
        progress = { { book = 9, modified = 2000, progress = 0.5, data = { exploredCharCount = 300 } } },
        statistics = { { book = 9, dateKey = "2026-03-01", modified = 2000,
            data = { readingTime = 60, charactersRead = 10, completedBook = true } } } }
end, doc = function() return 404 end, put = function(_, path) puts[#puts + 1] = { path = path } return 200, {} end }
assert(c:pull(sync_api))
assert(since == 0 and c:get("rev_all") == 5)
assert(c:get("progress")["9"].count == 300)
assert(c:get("stats")["9"]["2026-03-01"].data.completedBook == true, "whole row data is kept")

-- Downloaded after reading it in the browser: the first sync offers that place, sends no PUT over it.
c.bookId = function() return 9, { title = "nine" } end
c.currentCount = function() return 0 end
c.counts = function() return { total = 1000 } end
c.api = function() return sync_api end
local offered
c.offerJump = function() offered = true end
before = #puts
c:sync{}
assert(offered and #puts == before, "no progress PUT over the browser's place")

-- A 401 while signed in: the token and mirror go, the username and unsent time stay.
c = new()
c:set("token", "t")
c:set("account_id", "u1")
c:set("username", "me")
c:set("pending", { ["7"] = { title = "book", days = {} } })
c:set("progress", { ["7"] = { modified = 1, count = 1, progress = 0.1 } })
assert(not c:pull({ sync = function() return 401 end }))
assert(c:get("token") == nil and c:get("account_id") == nil and c:get("progress") == nil)
assert(c:get("username") == "me" and c:get("pending")["7"])
assert(library_reset, "the library's session cache goes too")
-- Until the next sign-in nothing is pulled (or pushed) as the shared account.
assert(not c:pull({ sync = function() error("pulled without a token") end }))

-- summary: today, the last 7 days, streaks, deleted rows, unsent time, characters without time.
fake_now = real_time{ year = 2026, month = 3, day = 10, hour = 12 }
os.time = function(t) if t == nil then return fake_now end return real_time(t) end
c = new()
c:set("stats", {
    ["7"] = {
        ["2026-03-10"] = { modified = 1, data = { readingTime = 600, charactersRead = 1000 } },
        ["2026-03-09"] = { modified = 1, data = { readingTime = 0, charactersRead = 500 } },
        ["2026-03-08"] = { modified = 1 }, -- deleted
        ["2026-03-07"] = { modified = 1, data = { readingTime = 300, charactersRead = 200 } },
        ["2026-03-01"] = { modified = 1, data = { readingTime = 100, charactersRead = 100 } },
    },
    ["9"] = { ["2026-03-09"] = { modified = 1, data = { readingTime = 1200, charactersRead = 2400 } } },
})
c:set("pending", { ["7"] = { title = "book", days = { ["2026-03-10"] = { seconds = 60, characters = 100 } } } })
local s = c:summary("7")
assert(s.today.t == 660 and s.today.c == 1100)
assert(s.week.t == 2160 and s.week.c == 4200, s.week.t .. " " .. s.week.c)
assert(s.streak == 2, "03-08 was deleted: " .. s.streak)
assert(s.total.t == 2260 and s.total.c == 4300)
assert(s.total.speed == 6053, "speed uses timed rows only: " .. s.total.speed)
assert(s.book.t == 1060 and s.book.c == 1900 and s.book.days == 4 and s.book.speed == 4755)
assert(s.book.first == "2026-03-01" and s.book.last == "2026-03-10")
-- A sent and taken addition is in the row already.
c:get("pending")["7"].days["2026-03-10"].sent = { modified = 1, seconds = 60, characters = 100 }
assert(c:summary().today.t == 600)
-- A run ending yesterday still counts; a gap ends it.
c:set("pending", {})
c:get("stats")["7"]["2026-03-10"] = nil
assert(c:summary().streak == 1)
c:get("stats")["7"]["2026-03-08"] = { modified = 1, data = { readingTime = 5, charactersRead = 0 } }
assert(c:summary().streak == 3)
c = new()
assert(c:summary().streak == 0 and c:summary().total.t == 0)
os.time = real_time

-- api.lua: X-Expected-Account goes with the token only (and the token only over https).
local headers
package.loaded["socket.http"] = { request = function(req) headers = req.headers return 1, 200, {} end }
package.loaded["socket"] = { skip = function(n, ...) return select(n + 1, ...) end }
package.loaded["socketutil"] = { set_timeout = function() end, reset_timeout = function() end,
    table_sink = function() return function() return 1 end end }
package.loaded["ltn12"] = { source = { string = function() end } }
local Api = dofile(plugin .. "/api.lua")
Api.new("https://x", "tok", "u1"):request("GET", "/a")
assert(headers["X-Expected-Account"] == "u1" and headers["Authorization"])
Api.new("https://x", nil, "u1"):request("GET", "/a")
assert(headers["X-Expected-Account"] == nil)
Api.new("http://x", "tok", "u1"):request("GET", "/a")
assert(headers["X-Expected-Account"] == nil and headers["Authorization"] == nil)
print("ok")
