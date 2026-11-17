-- Self-check for main.lua's day start, pending reading time, mirror, statistics summary, settings, manga
-- pages and the no-dialog jump, library.lua's Reading folder,
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
    local c = setmetatable({ store = store(), ui = { document = { info = {} } } }, { __index = Chimi })
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

-- Manga (paged documents): the place is the 0-based page index, progress page / (pages - 1) (/m).
local event
require("ui/event").new = function(_, name, value) return { name = name, value = value } end
c = new()
c.ui = { document = { info = { has_pages = true }, getPageCount = function() return 11 end },
    paging = { current_page = 6 }, handleEvent = function(_, e) event = e end }
assert(c:currentCount() == 5)
assert(c:fraction(5) == 0.5 and c:fraction(10) == 1)
c:gotoCount(8)
assert(event.name == "GotoPage" and event.value == 9)
c:gotoCount(40)
assert(event.value == 11, "past the end: the last page")
c.bookId = function() return 12, { title = "manga" } end
local put, rows = nil, {}
local manga_api = { sync = function() return 200, { rev = 1, progress = rows } end, doc = function() return 404 end,
    put = function(_, path, _m, data, extra) put = { path = path, data = data, extra = extra } return 200, {} end }
c.api = function() return manga_api end
c:sync{ quiet = true }
assert(put.path == "books/12/progress" and put.data.exploredCharCount == 5 and put.extra.progress == 0.5)
assert(c:get("synced")["12"] == 5 and c:get("unsent")["12"] == nil)
-- Page turns count time only: /m's characters are the mokuro text's.
fake_now = 1000
os.time = function(t) if t == nil then return fake_now end return real_time(t) end
c.last_turn, c.last_count = 940, 4
c:countPageTurn()
local day = next(c:get("pending")["12"].days)
assert(c:get("pending")["12"].days[day].seconds == 60 and c:get("pending")["12"].days[day].characters == 0)
os.time = real_time

-- Another device's newer place: a Reading folder book at the place it last agreed lands there
-- without asking; a book outside the folder, or one read further here, still asks.
c:set("pending", {})
rows[1] = { book = 12, modified = 9e12, progress = 0.8, data = { exploredCharCount = 8 } }
local offered
c.offerJump = function() offered = true end
c:set("folder", { ["12"] = "/dl/Reading/m.cbz" })
c:sync{}
assert(not offered and event.value == 9, "landed on page 9 (index 8)")
assert(c:get("synced")["12"] == 8 and c:get("seen")["12"] == 9e12)
rows[1] = { book = 12, modified = 9e12 + 1, progress = 0.3, data = { exploredCharCount = 3 } }
c.ui.paging.current_page = 7 -- read on here since: index 6, not the 8 agreed
c:sync{}
assert(offered, "this device has a newer place of its own: asked")
c = new()
c:set("folder", { ["12"] = "p" })
assert(c:landsWithoutAsking("12", 0), "never synced, at the start")
assert(not c:landsWithoutAsking("12", 3), "never synced, read here")
c:set("synced", { ["12"] = 3 })
assert(c:landsWithoutAsking("12", 3) and not c:landsWithoutAsking("12", 4))
c:set("unsent", { ["12"] = { count = 3, progress = 0.3 } })
assert(not c:landsWithoutAsking("12", 3), "an unsent place asks")
assert(not c:landsWithoutAsking("13", 0), "not a folder book: asks")

-- Reading folder: downloads Continue reading and Home, deletes only its own files that left both,
-- and only after their place and time reached the server; never the open book.
local files, removed_files, purged = {}, {}, {}
for _, p in ipairs{ "/dl/Reading/Two.epub", "/dl/Reading/Three.epub", "/hand/Five.epub", "/dl/Reading/Six.epub",
    "/dl/Reading/Eight.epub", "/dl/Reading/Nine.epub" } do files[p] = true end
require("libs/libkoreader-lfs").attributes = function(p, what)
    if what == "modification" then return files[p] and 1 or nil end
    return files[p] and "file" or nil
end
package.loaded["util"].makePath = function() end
package.loaded["ui/uimanager"].forceRePaint = function() end
package.loaded["ui/uimanager"].close = function() end
stub("docsettings", { open = function(_, p) return { saveSetting = function() end, flush = function() end,
    purge = function() purged[#purged + 1] = p end } end })
stub("readhistory", { fileDeleted = function() end })
stub("ui/widget/menu", {})
local Library = dofile(plugin .. "/library.lua")
c = new()
local function entry(id, title, path) return { id = id, title = title, file = title .. ".epub", path = path } end
c:set("download_dir", "/dl")
c:set("books", { ["2"] = entry(2, "Two", "/dl/Reading/Two.epub"), ["3"] = entry(3, "Three", "/dl/Reading/Three.epub"),
    ["5"] = entry(5, "Five", "/hand/Five.epub"), ["6"] = entry(6, "Six", "/dl/Reading/Six.epub"),
    ["8"] = entry(8, "Eight", "/dl/Reading/Eight.epub"), ["9"] = entry(9, "Nine", "/dl/Reading/Nine.epub") })
c:set("folder", { ["2"] = "/dl/Reading/Two.epub", ["3"] = "/dl/Reading/Three.epub", ["6"] = "/dl/Reading/Six.epub",
    ["8"] = "/dl/Reading/Eight.epub", ["9"] = "/dl/Reading/Nine.epub" })
c:set("pending", { ["2"] = { title = "Two", days = { ["2026-03-01"] = { seconds = 30, characters = 10 } } } })
c:set("unsent", { ["8"] = { count = 10, progress = 0.1 } })
local puts_to = {}
local folder_api = {
    sync = function() return 200, { rev = 1, progress = {
        { book = 1, modified = 100, progress = 0.5, data = { exploredCharCount = 50 } }, -- reading, not here
        { book = 2, modified = 100, progress = 1, data = { exploredCharCount = 99 } }, -- finished
        { book = 3, modified = 50, progress = 0.3, data = { exploredCharCount = 3 } }, -- removed from Home after
        { book = 8, modified = 200, progress = 0.2, data = { exploredCharCount = 20 } }, -- newer than seen
    } } end,
    doc = function() return 200, { data = { values = { homeBookTitles = { "Four", "Six" },
        homeRemovedTitles = { Three = 60, Eight = 300 } } } } end,
    books_by = function() return 200, { books = {
        { id = 1, title = "One", file = "One.zip", format = "ZIP" },
        { id = 4, title = "Four", file = "Four.epub", format = "EPUB" } } } end,
    download = function(_, _f, dest) files[dest] = true return true end,
    put = function(_, path) puts_to[#puts_to + 1] = path return 200, {} end,
}
c.api = function() return folder_api end
local real_remove = os.remove
os.remove = function(p) files[p] = nil removed_files[#removed_files + 1] = p end
local result = Library.syncFolder(c, "/dl/Reading/Nine.epub")
os.remove = real_remove
assert(result.got == 2 and result.removed == 2 and result.kept == 2,
    result.got .. " " .. result.removed .. " " .. result.kept)
assert(files["/dl/Reading/One.cbz"] and files["/dl/Reading/Four.epub"], "manga ZIP saved as .cbz")
assert(c:get("folder")["1"] == "/dl/Reading/One.cbz" and c:get("books")["4"].path == "/dl/Reading/Four.epub")
assert(not files["/dl/Reading/Two.epub"] and not files["/dl/Reading/Three.epub"] and #purged == 2)
assert(c:get("books")["2"] == nil and c:get("folder")["3"] == nil)
assert(puts_to[1] == "books/2/statistics/2026-03-01", "the finished book's time went first")
assert(files["/dl/Reading/Eight.epub"] and c:get("folder")["8"], "a place newer than seen keeps the file")
assert(files["/dl/Reading/Nine.epub"], "the open book stays")
assert(files["/dl/Reading/Six.epub"] and files["/hand/Five.epub"] and c:get("books")["5"], "Home and hand-downloaded stay")
-- An unsent place the server refuses keeps the file; sent, it goes.
c:set("progress", {})
folder_api.put = function() return 500, nil, "HTTP 500" end
assert(not c:flushBook(folder_api, "8") and c:get("unsent")["8"])
folder_api.put = function() return 200, {} end
assert(c:flushBook(folder_api, "8") and c:get("unsent")["8"] == nil and c:get("synced")["8"] == 10)
-- Settings unreadable: nothing is downloaded or deleted.
folder_api.doc = function() return 500 end
assert(Library.syncFolder(c, nil) == nil)

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
