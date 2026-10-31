-- SPDX-License-Identifier: GPL-3.0-or-later
--[[--
chimimouryou: a chimimouryou server's library, reading progress and reading time in KOReader.

Positions are the web reader's character counts (charcount.lua), so a place saved here opens at the
same character in the browser and back. Before jumping to a place another device saved the plugin
asks; it never overwrites a place saved after the one it last saw. Reading time and characters read
go to the server's statistics as this device's own additions to the day's row (see pushStatistics).
--]]--

local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local rapidjson = require("rapidjson")

local Api = require("api")
local charcount = require("charcount")

-- Bump when charcount.lua's results change: cached fragment counts are made again.
local COUNT_VERSION = 1
-- Seconds of one page turn counted at most (the rest is time away from the book).
local MAX_PAGE_SECONDS = 120
-- More characters than this between two page turns is a jump, not reading.
local MAX_PAGE_CHARACTERS = 3000
-- Seconds after a page turn before progress and reading time are sent (when online).
local PUSH_DELAY = 90

-- rapidjson's nulls can't be saved in LuaSettings: drop them.
local function without_nulls(value)
    if type(value) ~= "table" then
        if value == rapidjson.null then return nil end
        return value
    end
    local out = {}
    for k, v in pairs(value) do out[k] = without_nulls(v) end
    return out
end

local Chimi = WidgetContainer:extend{
    name = "chimimouryou",
    is_doc_only = false,
}

function Chimi:init()
    self.store = LuaSettings:open(DataStorage:getSettingsDir() .. "/chimimouryou.lua")
    self.push_task = function()
        self.push_scheduled = false
        if NetworkMgr:isOnline() then self:sync{ quiet = true } end
    end
    self.ui.menu:registerToMainMenu(self)
end

function Chimi:get(key, default)
    return self.store:readSetting(key, default)
end

function Chimi:set(key, value)
    self.store:saveSetting(key, value)
    self.store:flush()
end

function Chimi:api()
    return Api.new(self:get("server"), self:get("token"))
end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new{ text = text, timeout = timeout })
end

-- Menu

function Chimi:addToMainMenu(menu_items)
    menu_items.chimimouryou = {
        text = _("chimimouryou"),
        sorting_hint = "tools",
        sub_item_table_func = function() return self:menuItems() end,
    }
end

function Chimi:menuItems()
    local items = {
        {
            text_func = function()
                local server = self:get("server")
                return server and T(_("Server: %1"), server) or _("Set server address")
            end,
            keep_menu_open = true,
            callback = function(menu) self:askServer(menu) end,
        },
        {
            text_func = function()
                local user = self:get("username")
                return user and T(_("Sign out (%1)"), user) or _("Sign in")
            end,
            enabled_func = function() return self:get("server") ~= nil end,
            keep_menu_open = true,
            callback = function(menu)
                if self:get("token") then self:signOut(menu) else self:askSignIn(menu) end
            end,
            separator = true,
        },
        {
            text = _("Library"),
            enabled_func = function() return self:get("server") ~= nil end,
            callback = function()
                NetworkMgr:runWhenOnline(function() require("library").show(self) end)
            end,
        },
    }
    if self.ui.document then
        table.insert(items, {
            text = _("Sync this book now"),
            enabled_func = function() return self:bookId() ~= nil end,
            callback = function()
                NetworkMgr:runWhenOnline(function() self:sync{ interactive = true } end)
            end,
        })
    end
    table.insert(items, {
        text = _("Send reading time"),
        checked_func = function() return self:get("statistics", true) end,
        callback = function() self:set("statistics", not self:get("statistics", true)) end,
    })
    return items
end

function Chimi:askServer(menu)
    local dialog
    dialog = InputDialog:new{
        title = _("chimimouryou server address"),
        input = self:get("server") or "https://",
        description = _("The address you open the server at in a browser, e.g. https://books.example.org"),
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = _("Save"),
                is_enter_default = true,
                callback = function()
                    local server = util.trim(dialog:getInputText()):gsub("/+$", "")
                    if not server:match("^https?://[^/]+$") then
                        notify(_("Enter the address as https://host (no path)."), 4)
                        return
                    end
                    UIManager:close(dialog)
                    if server ~= self:get("server") then
                        -- Another server: its books, rows and tokens aren't this one's.
                        self:forget()
                        self:set("server", server)
                    end
                    if menu then menu:updateItems() end
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

--- Drops the account and everything mirrored from the server (not the downloaded books).
function Chimi:forget()
    for _, key in ipairs{ "token", "username", "rev", "progress", "stats", "seen", "pending" } do
        self.store:delSetting(key)
    end
    self.store:flush()
end

function Chimi:askSignIn(menu)
    local api = self:api()
    if not api:secure() then
        -- Tokens need HTTPS; over plain HTTP only a server's trusted networks are served signed out.
        notify(_("Signing in needs the server's https:// address. Over http:// the library and sync work only where the server trusts your network, without an account."))
        return
    end
    local dialog
    dialog = MultiInputDialog:new{
        title = _("Sign in to chimimouryou"),
        fields = {
            { text = self:get("username") or "", hint = _("Username") },
            { hint = _("Password"), text_type = "password" },
        },
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = _("Sign in"),
                callback = function()
                    local username, password = unpack(dialog:getFields())
                    UIManager:close(dialog)
                    NetworkMgr:runWhenOnline(function() self:signIn(util.trim(username), password, menu) end)
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Chimi:signIn(username, password, menu)
    local api = self:api()
    local code, body, err = api:sign_in(username, password, Device.model or "KOReader")
    if code ~= 200 or not body or type(body.token) ~= "string" then
        notify(T(_("Could not sign in: %1"), err or "?"))
        return
    end
    self:forget()
    self.store:saveSetting("token", body.token)
    self:set("username", username)
    notify(T(_("Signed in as %1."), username), 3)
    if menu then menu:updateItems() end
end

function Chimi:signOut(menu)
    UIManager:show(ConfirmBox:new{
        text = _("Sign out of the server on this device?"),
        ok_text = _("Sign out"),
        ok_callback = function()
            -- Best effort: the token is forgotten here either way (it also shows under Devices on the server).
            if NetworkMgr:isOnline() then self:api():sign_out() end
            self:forget()
            if menu then menu:updateItems() end
        end,
    })
end

-- The open book

--- The server's id of the open book (written by the library when it downloaded it), or nil.
function Chimi:bookId()
    local doc = self.ui.document
    if not doc or doc.info.has_pages or not self.ui.doc_settings then return nil end
    local book = self.ui.doc_settings:readSetting("chimimouryou")
    if book and book.server == self:get("server") then return book.id, book end
    return nil
end

--- Per-fragment character counts of the open book (cached in its sidecar) and their sum.
function Chimi:counts()
    if self.fragment_counts then return self.fragment_counts end
    local doc = self.ui.document
    local cached = self.ui.doc_settings:readSetting("chimimouryou_counts")
    if cached and cached.version == COUNT_VERSION then
        self.fragment_counts = cached
        return cached
    end
    local n = 0
    while doc:isXPointerInDocument("/body/DocFragment[" .. (n + 1) .. "]") do n = n + 1 end
    if n == 0 and doc:isXPointerInDocument("/body/DocFragment") then n = 1 end
    local counts = { version = COUNT_VERSION, fragments = {}, total = 0 }
    for i = 1, n do
        local base = charcount.fragment_path(i, n)
        local total = charcount.index(doc:getHTMLFromXPointer(base, 0) or "", base).total
        counts.fragments[i] = total
        counts.total = counts.total + total
    end
    self.ui.doc_settings:saveSetting("chimimouryou_counts", counts)
    self.fragment_counts = counts
    return counts
end

function Chimi:fragmentIndex(n)
    if self.index_cache and self.index_cache.n == n then return self.index_cache.index end
    local base = charcount.fragment_path(n, #self:counts().fragments)
    local index = charcount.index(self.ui.document:getHTMLFromXPointer(base, 0) or "", base)
    self.index_cache = { n = n, index = index }
    return index
end

--- Characters before the current page's first character, as the web reader counts them.
function Chimi:currentCount()
    local xp = self.ui.rolling and self.ui.rolling:getLastProgress()
    local n = charcount.fragment_of(xp)
    local counts = self:counts()
    if not n or not counts.fragments[n] then return nil end
    local before = 0
    for i = 1, n - 1 do before = before + counts.fragments[i] end
    local local_count = charcount.count_at(self:fragmentIndex(n), xp)
    return local_count and before + local_count
end

function Chimi:gotoCount(count)
    local counts = self:counts()
    local before = 0
    for n, total in ipairs(counts.fragments) do
        if count < before + total then
            local xp = charcount.xpointer_for(self:fragmentIndex(n), count - before)
            if xp then self.ui:handleEvent(Event:new("GotoXPointer", xp)) end
            return
        end
        before = before + total
    end
    self.ui:handleEvent(Event:new("GotoPercent", 100))
end

-- Sync

--- Reads the account's rows changed since the last call into the local mirror (progress and
--- statistics of books the library downloaded). Returns true, or false and the error.
function Chimi:pull(api)
    local code, body, err = api:sync(self:get("rev", 0))
    if code ~= 200 or not body then return false, err end
    local progress, stats, books = self:get("progress", {}), self:get("stats", {}), self:get("books", {})
    for _, row in ipairs(body.progress or {}) do
        local key = tostring(row.book)
        if books[key] then
            local data = type(row.data) == "table" and row.data or {}
            progress[key] = { modified = row.modified, count = tonumber(data.exploredCharCount) or 0,
                progress = tonumber(row.progress) or 0 }
        end
    end
    for _, row in ipairs(body.statistics or {}) do
        local key = tostring(row.book)
        if books[key] and type(row.dateKey) == "string" then
            stats[key] = stats[key] or {}
            stats[key][row.dateKey] = { modified = row.modified,
                data = row.deleted ~= true and without_nulls(row.data) or nil }
        end
    end
    self.store:saveSetting("progress", progress)
    self.store:saveSetting("stats", stats)
    self:set("rev", body.rev or self:get("rev", 0))
    return true
end

local function now_ms()
    return math.floor(os.time() * 1000)
end

local function percent(count, total)
    return total > 0 and math.floor(count * 100 / total) or 0
end

--- Asks whether to go to the place `row` (a mirrored progress row) saved.
function Chimi:offerJump(id, row)
    local total = self:counts().total
    UIManager:show(ConfirmBox:new{
        text = T(_("Another device saved your place in this book on %1: %2% (character %3). Go there?"),
            os.date("%Y-%m-%d %H:%M", math.floor(row.modified / 1000)), percent(row.count, total), row.count),
        ok_text = _("Go there"),
        -- Staying marks it seen, so this device's next save replaces it: the reader chose so.
        cancel_text = _("Stay here"),
        ok_callback = function()
            self:seen(id, row.modified)
            self.last_pushed = row.count
            self:gotoCount(row.count)
        end,
        cancel_callback = function() self:seen(id, row.modified) end,
    })
end

function Chimi:seen(id, modified)
    local seen = self:get("seen", {})
    seen[tostring(id)] = modified
    self:set("seen", seen)
end

--- Pulls, then offers the server's place if another device saved one since this device last looked,
--- else sends this device's place (if it moved) and its reading time.
--- opts.interactive: say what happened; opts.quiet: never prompt (closing, suspending).
function Chimi:sync(opts)
    local id = self:bookId()
    if not id then return end
    local api = self:api()
    local ok, err = self:pull(api)
    if not ok then
        if opts.interactive then notify(T(_("Sync failed: %1"), err or "?"), 4) end
        return
    end
    local key = tostring(id)
    local row = self:get("progress", {})[key]
    local here = self:currentCount()
    if row and row.modified > (self:get("seen", {})[key] or 0) and row.count ~= here then
        -- Someone saved a place after the one this device last saw: never overwrite it unasked.
        if not opts.quiet then self:offerJump(id, row) end
        self:pushStatistics(api)
        return
    end
    if row then self:seen(id, row.modified) end
    local pushed = false
    if here and here ~= self.last_pushed and not (row and row.count == here) then
        local total = self:counts().total
        local modified = now_ms()
        local fraction = total > 0 and here / total or 0
        local code, body, put_err = api:put("books/" .. id .. "/progress", modified,
            { exploredCharCount = here, progress = fraction, lastBookmarkModified = modified },
            { progress = fraction })
        if code == 200 then
            self:seen(id, modified)
            local progress = self:get("progress", {})
            progress[key] = { modified = modified, count = here, progress = fraction }
            self:set("progress", progress)
            self.last_pushed = here
            pushed = true
        elseif code == 409 and body and body.row then
            -- The server's row is newer (another clock ahead of ours): offer it next time.
            logger.info("chimimouryou: the server has a newer place")
        elseif opts.interactive then
            notify(T(_("Could not save your place: %1"), put_err or "?"), 4)
            return
        end
    elseif row and row.count == here then
        self.last_pushed = here
    end
    self:pushStatistics(api)
    if opts.interactive then
        notify(pushed and _("Your place was saved on the server.") or _("Already in step with the server."), 3)
    end
end

-- Statistics

local function day_key(t)
    return os.date("%Y-%m-%d", t)
end

--- Counts this page turn's reading time and characters into the open book's pending additions.
function Chimi:countPageTurn()
    local id, book = self:bookId()
    if not id or not self:get("statistics", true) then return end
    local now, count = os.time(), self:currentCount()
    if self.last_turn and count then
        local seconds = math.min(now - self.last_turn, MAX_PAGE_SECONDS)
        local characters = self.last_count and count - self.last_count or 0
        if characters < 0 or characters > MAX_PAGE_CHARACTERS then characters = 0 end
        if seconds > 0 or characters > 0 then
            local pending = self:get("pending", {})
            local key = tostring(id)
            pending[key] = pending[key] or { title = book.title, days = {} }
            local days = pending[key].days
            local day = days[day_key(now)] or { seconds = 0, characters = 0 }
            day.seconds = day.seconds + math.max(seconds, 0)
            day.characters = day.characters + characters
            days[day_key(now)] = day
            self.store:saveSetting("pending", pending)
        end
    end
    self.last_turn, self.last_count = now, count
end

-- updateStatistic (book-reading-tracker.ts): adds time and characters to a day's row, speeds after.
local function add_to_statistic(stat, seconds, characters, modified)
    stat.readingTime = math.max(0, (stat.readingTime or 0) + seconds)
    stat.charactersRead = math.max(0, (stat.charactersRead or 0) + characters)
    stat.lastReadingSpeed = stat.readingTime > 0 and math.ceil(3600 * stat.charactersRead / stat.readingTime) or 0
    stat.minReadingSpeed = (stat.minReadingSpeed or 0) > 0 and math.min(stat.minReadingSpeed, stat.lastReadingSpeed)
        or stat.lastReadingSpeed
    stat.maxReadingSpeed = math.max(stat.maxReadingSpeed or 0, stat.lastReadingSpeed)
    stat.lastStatisticModified = modified
    if characters ~= 0 then
        stat.altMinReadingSpeed = (stat.altMinReadingSpeed or 0) > 0
            and math.min(stat.altMinReadingSpeed, stat.lastReadingSpeed) or stat.lastReadingSpeed
    end
    return stat
end

--- Sends the pending reading time: each day's addition goes onto the server's current row for that
--- day (just pulled) with a newer `modified`, and is dropped once the server took it. So time is
--- counted once: KOReader's own statistics are never read, and a day the browser also read keeps
--- both (each device adds to the latest row; a 409 means another device wrote first, so it is added
--- again onto that row). A browser tab open on the same book that day can still replace the row
--- with its own copy (newest row wins), as between two browsers.
function Chimi:pushStatistics(api)
    local pending = self:get("pending", {})
    local stats = self:get("stats", {})
    for key, book in pairs(pending) do
        for day, add in pairs(book.days) do
            for _ = 1, 2 do
                local row = (stats[key] or {})[day]
                local stat = util.tableDeepCopy(row and row.data or {})
                stat.title, stat.dateKey = book.title, day
                local modified = math.max(now_ms(), (row and row.modified or 0) + 1)
                add_to_statistic(stat, add.seconds, add.characters, modified)
                local code, body = api:put("books/" .. key .. "/statistics/" .. day, modified, stat)
                if code == 200 then
                    stats[key] = stats[key] or {}
                    stats[key][day] = { modified = modified, data = stat }
                    book.days[day] = nil
                    break
                elseif code == 409 and body and type(body.row) == "table" then
                    stats[key] = stats[key] or {}
                    stats[key][day] = { modified = body.row.modified, data = without_nulls(body.row.data) }
                else
                    break
                end
            end
        end
        if next(book.days) == nil then pending[key] = nil end
    end
    self.store:saveSetting("stats", stats)
    self:set("pending", pending)
end

-- Events

function Chimi:onReaderReady()
    if not self:bookId() then return end
    self.last_turn, self.last_count = os.time(), nil
    UIManager:scheduleIn(1, function()
        self.last_count = self:currentCount()
        if NetworkMgr:isOnline() then self:sync{} end
    end)
end

function Chimi:onPageUpdate()
    if not self:bookId() then return end
    self:countPageTurn()
    if not self.push_scheduled then
        self.push_scheduled = true
        UIManager:scheduleIn(PUSH_DELAY, self.push_task)
    end
end

function Chimi:onSuspend()
    if not self:bookId() then return end
    self:countPageTurn()
    self.last_turn = nil
    if NetworkMgr:isOnline() then self:sync{ quiet = true } end
end

function Chimi:onResume()
    if self:bookId() then self.last_turn = os.time() end
end

function Chimi:onCloseDocument()
    if not self:bookId() then return end
    self:countPageTurn()
    if NetworkMgr:isOnline() then self:sync{ quiet = true } end
    self.fragment_counts, self.index_cache, self.last_turn, self.last_count = nil, nil, nil, nil
end

function Chimi:onCloseWidget()
    UIManager:unschedule(self.push_task)
end

return Chimi
