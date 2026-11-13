-- Self-check for main.lua's day start and pending reading time, with KOReader's modules stubbed.
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
    "ui/uimanager", "logger", "charcount", "api" } do
    stub(name, { info = function() end })
end
stub("ui/widget/container/widgetcontainer", { extend = function(_, t) return t end })
stub("util", { tableDeepCopy = deepcopy })
stub("ffi/util", { template = function(s) return s end })
stub("gettext", function(s) return s end)
stub("rapidjson", { null = null })

local Chimi = dofile(plugin .. "/main.lua")

local function store()
    local data = {}
    return { readSetting = function(_, k, d) if data[k] == nil then data[k] = d end return data[k] end,
        saveSetting = function(_, k, v) data[k] = v end, flush = function() end, data = data }
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

-- pullDayStart reads the settings doc, keeps the last hour on errors.
c:pullDayStart({ doc = function() return 200, { data = { values = { startDayHoursForTracker = 5 } } } end })
assert(c:get("day_start") == 5)
c:pullDayStart({ doc = function() return 404, nil end })
assert(c:get("day_start") == 5)
c:pullDayStart({ doc = function() return 200, { data = { values = { startDayHoursForTracker = 30 } } } end })
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
print("ok")
