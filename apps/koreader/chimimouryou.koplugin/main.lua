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
local Dispatcher = require("dispatcher")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local TextViewer = require("ui/widget/textviewer")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
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
-- Progress from here on is a finished book (completedThreshold, library-filters.ts).
local FINISHED = 0.995

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
    -- The old `rev` vouched only for downloaded books' rows: start the mirror of every book from 0.
    self.store:delSetting("rev")
    self.push_task = function()
        self.push_scheduled = false
        if NetworkMgr:isOnline() then self:sync{ quiet = true } end
    end
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
end

function Chimi:onDispatcherRegisterActions()
    Dispatcher:registerAction("chimimouryou_stats", { category = "none", event = "ChimiStats",
        title = _("chimimouryou statistics"), reader = true, general = true })
end

function Chimi:onChimiStats()
    self:showStats()
    return true
end

function Chimi:get(key, default)
    return self.store:readSetting(key, default)
end

function Chimi:set(key, value)
    self.store:saveSetting(key, value)
    self.store:flush()
end

function Chimi:api()
    return Api.new(self:get("server"), self:get("token"), self:get("account_id"))
end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new{ text = text, timeout = timeout })
end

local function percent(count, total)
    return total > 0 and math.floor(count * 100 / total) or 0
end

--- "3 h 10 min", "25 min".
local function format_duration(seconds)
    local minutes = math.floor((seconds or 0) / 60)
    if minutes >= 60 then return T(_("%1 h %2 min"), math.floor(minutes / 60), minutes % 60) end
    return T(_("%1 min"), minutes)
end

--- Progress rows of books being read (0 < progress < finished), last saved first.
function Chimi:inProgress()
    local list = {}
    for key, row in pairs(self:get("progress", {})) do
        if row.progress > 0 and row.progress < FINISHED then table.insert(list, { key = key, row = row }) end
    end
    table.sort(list, function(a, b) return (a.row.modified or 0) > (b.row.modified or 0) end)
    return list
end

--- The downloaded book (books[id] entry) with the newest unfinished place, not the open one.
function Chimi:continueBook()
    local books, open = self:get("books", {}), tostring(self:bookId())
    for _, item in ipairs(self:inProgress()) do
        local entry = books[item.key]
        if type(entry) == "table" and item.key ~= open and lfs.attributes(entry.path, "mode") == "file" then
            return entry, item.row
        end
    end
end

function Chimi:unsentSeconds()
    local seconds = 0
    for _, book in pairs(self:get("pending", {})) do
        for _, add in pairs(book.days or {}) do seconds = seconds + (add.seconds or 0) end
    end
    return seconds
end

-- Reading folder

-- One sync (a book's or the Reading folder's) at a time.
local busy = false

--- Runs fn(...) unless another sync is running; an error inside still frees the next one.
local function exclusive(fn, ...)
    if busy then return end
    busy = true
    local ok, result, err = pcall(fn, ...)
    busy = false
    if not ok then
        logger.warn("chimimouryou: sync failed:", result)
        return nil, tostring(result)
    end
    return result, err
end

function Chimi:folderOn()
    return self:get("token") ~= nil and self:get("reading_folder", true)
end

--- Brings the Reading folder in step with Home (library.lua's syncFolder). interactive: say so
--- when nothing changed or it failed; otherwise only changes are shown.
function Chimi:syncFolder(interactive)
    if not self:folderOn() or not NetworkMgr:isOnline() then return end
    local doc = self.ui.document
    local result, err = exclusive(require("library").syncFolder, self, doc and doc.file)
    if not result then
        if interactive then notify(T(_("Reading folder: %1"), err or _("another sync is running")), 4) end
        return
    end
    if result.got + result.removed + result.kept > 0 then
        local text = T(_("Reading folder: %1 downloaded, %2 removed."), result.got, result.removed)
        if result.kept > 0 then
            -- Open, or its place couldn't be sent: deleted on a later sync.
            text = text .. "\n" .. T(_("%1 left Home but stays for now."), result.kept)
        end
        notify(text, 4)
    elseif interactive then
        notify(_("Reading folder: already in step with Home."), 3)
    end
end

function Chimi:openFolder()
    local dir = require("library").folderDir(self)
    if self.ui.document then self.ui:onClose() end
    local FileManager = require("apps/filemanager/filemanager")
    if FileManager.instance then FileManager.instance:reinit(dir) else FileManager:showFiles(dir) end
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
                -- After the server signed this device out the username stays, the token doesn't.
                return self:get("token") and T(_("Sign out (%1)"), self:get("username") or "?") or _("Sign in")
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
        {
            text = _("Reading statistics"),
            callback = function() self:showStats() end,
        },
    }
    local entry, row = self:continueBook()
    if entry then
        -- Opens the file as it is: no network needed.
        table.insert(items, 1, {
            text = T(_("Continue: %1 (%2%)"), entry.title, math.floor(row.progress * 100)),
            callback = function() require("apps/reader/readerui"):showReader(entry.path) end,
            separator = true,
        })
    end
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
        text = _("Reading folder (your Home books, synced on Wi-Fi)"),
        enabled_func = function() return self:get("token") ~= nil end,
        checked_func = function() return self:folderOn() end,
        callback = function() self:set("reading_folder", not self:get("reading_folder", true)) end,
    })
    table.insert(items, {
        text = _("Sync reading folder now"),
        enabled_func = function() return self:folderOn() end,
        callback = function()
            if NetworkMgr:isOnline() then self:syncFolder(true) else notify(_("Turn on Wi-Fi first."), 3) end
        end,
    })
    table.insert(items, {
        text = _("Open reading folder"),
        enabled_func = function() return self:get("server") ~= nil end,
        callback = function() self:openFolder() end,
        separator = true,
    })
    table.insert(items, {
        text_func = function()
            local seconds = self:unsentSeconds()
            return seconds >= 60 and T(_("Send reading time (%1 unsent)"), format_duration(seconds))
                or _("Send reading time")
        end,
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
--- keep_pending: the same account signs in again, so time read meanwhile is still sent.
function Chimi:forget(keep_pending)
    -- `folder` goes too unless kept: its files are then never deleted (they may hold another account's place).
    for _, key in ipairs{ "token", "account_id", "username", "rev_all", "progress", "stats", "seen", "home",
        "pending", "synced", "unsent", "folder" } do
        local keep = key == "pending" or key == "username" or key == "unsent" or key == "folder"
        if not (keep_pending and keep) then self.store:delSetting(key) end
    end
    self.store:flush()
    require("library").reset()
end

--- After a 401 the username stays and the token is gone: until the next sign-in, pulls and pushes
--- would be the shared account's (a trusted network lets them through).
function Chimi:signedOut()
    return self:get("username") ~= nil and not self:get("token")
end

--- A 401 while signed in: the token was revoked or expired. The mirror goes too (pulls after this
--- would be the shared account's), the username and unsent time stay for the next sign-in.
function Chimi:lostToken(code)
    if code ~= 401 or not self:get("token") then return false end
    self:forget(true)
    notify(_("The server signed this device out. Sign in again."))
    return true
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
    -- Another account: its rows and unsent time aren't this one's. Same account: keep the unsent time.
    self:forget(username == self:get("username"))
    self.store:saveSetting("token", body.token)
    local account = type(body.user) == "table" and body.user.id
    if type(account) == "string" or type(account) == "number" then
        self.store:saveSetting("account_id", tostring(account))
    end
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
    if not doc or not self.ui.doc_settings then return nil end
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

--- Manga (CBZ) and other page-based documents: the place is the 0-based page index, as /m saves it
--- (mangaBookmark, manga.ts), instead of a character count.
function Chimi:paged()
    return self.ui.document.info.has_pages
end

--- The progress fraction of a place: count / characters, or page / (pages - 1) as /m has it.
function Chimi:fraction(count)
    if self:paged() then
        local pages = self.ui.document:getPageCount()
        return pages > 1 and math.min(count / (pages - 1), 1) or 0
    end
    local total = self:counts().total
    return total > 0 and count / total or 0
end

--- Characters before the current page's first character, as the web reader counts them.
function Chimi:currentCount()
    if self:paged() then
        local page = self.ui.paging and self.ui.paging.current_page
        return page and page - 1
    end
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
    if self:paged() then
        local page = math.max(1, math.min(count + 1, self.ui.document:getPageCount()))
        self.ui:handleEvent(Event:new("GotoPage", page))
        return
    end
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

--- Reads the account's rows changed since the last call into the local mirror: progress and
--- statistics of every book, so the statistics, Continue reading and a book downloaded after it was
--- read in the browser have them. Rows keep their whole `data` (pushStatistics PUTs it back).
--- shortcut: the whole mirror lives in chimimouryou.lua and is rewritten on every set(); move stats
--- to its own LuaSettings file if it passes ~1 MB.
--- Returns true, or false and the error.
function Chimi:pull(api)
    if self:signedOut() then return false, _("signed out") end
    local code, body, err = api:sync(self:get("rev_all", 0))
    self:lostToken(code)
    if code ~= 200 or not body then return false, err end
    local progress, stats = self:get("progress", {}), self:get("stats", {})
    for _, row in ipairs(body.progress or {}) do
        local key = tostring(row.book)
        local data = type(row.data) == "table" and row.data or {}
        progress[key] = { modified = row.modified, count = tonumber(data.exploredCharCount) or 0,
            progress = tonumber(row.progress) or 0 }
    end
    for _, row in ipairs(body.statistics or {}) do
        local key = tostring(row.book)
        if type(row.dateKey) == "string" then
            stats[key] = stats[key] or {}
            stats[key][row.dateKey] = { modified = row.modified,
                data = row.deleted ~= true and without_nulls(row.data) or nil }
        end
    end
    self.store:saveSetting("progress", progress)
    self.store:saveSetting("stats", stats)
    self:set("rev_all", body.rev or self:get("rev_all", 0))
    return true
end

--- The account's settings the plugin uses, kept for offline reading: the start of the day (the
--- web's Settings → Statistics hour) and the library's Home books (homeBookTitles, and
--- homeRemovedTitles: title → time removed, negative when added back).
--- Without a settings doc (or on an older server) the last known values stay, midnight at first.
--- Returns true when the server answered (a 404 too: no settings doc), false on errors.
function Chimi:pullSettings(api)
    if self:signedOut() then return false end
    local code, body = api:doc("settings")
    if code == 404 then return true end
    if code ~= 200 or type(body) ~= "table" or type(body.data) ~= "table" then return false end
    local values = type(body.data.values) == "table" and body.data.values or {}
    local hours = tonumber(values.startDayHoursForTracker) or 0
    if hours < 0 or hours > 23 or hours % 1 ~= 0 then hours = 0 end
    if hours ~= self:get("day_start", 0) then self.store:saveSetting("day_start", hours) end
    local home = { titles = {}, removed = {} }
    for _, title in ipairs(type(values.homeBookTitles) == "table" and values.homeBookTitles or {}) do
        if type(title) == "string" then table.insert(home.titles, title) end
    end
    for title, time in pairs(type(values.homeRemovedTitles) == "table" and values.homeRemovedTitles or {}) do
        if type(title) == "string" and type(time) == "number" then home.removed[title] = time end
    end
    self:set("home", home)
    return true
end

local function now_ms()
    return math.floor(os.time() * 1000)
end

--- Goes to the place `row` (a mirrored progress row) saved.
function Chimi:jumpTo(id, row)
    self:seen(id, row.modified)
    self:agreed(tostring(id), row.count)
    -- The jump isn't reading: the next page turn counts from the new place.
    self.last_pushed, self.last_count = row.count, row.count
    self:gotoCount(row.count)
end

--- Asks whether to go to the place `row` (a mirrored progress row) saved.
function Chimi:offerJump(id, row)
    local place = self:paged() and T(_("page %1"), row.count + 1) or T(_("character %1"), row.count)
    UIManager:show(ConfirmBox:new{
        text = T(_("Another device saved your place in this book on %1: %2% (%3). Go there?"),
            os.date("%Y-%m-%d %H:%M", math.floor(row.modified / 1000)),
            math.floor(self:fraction(row.count) * 100), place),
        ok_text = _("Go there"),
        -- Staying marks it seen, so this device's next save replaces it: the reader chose so.
        cancel_text = _("Stay here"),
        ok_callback = function() self:jumpTo(id, row) end,
        cancel_callback = function() self:seen(id, row.modified) end,
    })
end

function Chimi:seen(id, modified)
    local seen = self:get("seen", {})
    seen[tostring(id)] = modified
    self:set("seen", seen)
end

--- This device and the server agree on the book's place `count` (`synced`): nothing unsent.
function Chimi:agreed(key, count)
    local synced, unsent = self:get("synced", {}), self:get("unsent", {})
    synced[key], unsent[key] = count, nil
    self.store:saveSetting("unsent", unsent)
    self:set("synced", synced)
end

--- Keeps the open book's place as unsent (`unsent`) unless the server has it already, so a closed
--- book's place can still be sent (flushBook) before the Reading folder deletes it.
function Chimi:keepPlace()
    local id = self:bookId()
    local here = id and self:currentCount()
    if not here then return end
    local key = tostring(id)
    local unsent = self:get("unsent", {})
    if here == self:get("synced", {})[key] then
        unsent[key] = nil
    else
        unsent[key] = { count = here, progress = self:fraction(here) }
    end
    self.store:saveSetting("unsent", unsent)
end

--- A Reading folder book whose place on this device is the one it last agreed with the server
--- (or, never synced, its start): a newer place from another device opens without asking.
function Chimi:landsWithoutAsking(key, here)
    if not self:get("folder", {})[key] or self:get("unsent", {})[key] then return false end
    local synced = self:get("synced", {})[key]
    if synced == nil then return (here or 0) == 0 end
    return here == synced
end

--- PUTs a place over the mirrored `row`; on success the mirror, `seen` and `synced` follow.
function Chimi:putPlace(api, key, count, fraction, row)
    -- A clock behind the row's would get a 409 on every save.
    local modified = math.max(now_ms(), (row and row.modified or 0) + 1)
    local code, body, err = api:put("books/" .. key .. "/progress", modified,
        { exploredCharCount = count, progress = fraction, lastBookmarkModified = modified },
        { progress = fraction })
    if code == 200 then
        self:seen(key, modified)
        local progress = self:get("progress", {})
        progress[key] = { modified = modified, count = count, progress = fraction }
        self:set("progress", progress)
        self:agreed(key, count)
    end
    return code, body, err
end

--- Before the Reading folder deletes a closed book: sends its unsent place (pushStatistics has
--- sent the time just before). True when nothing of the book is left unsent; false keeps the file.
function Chimi:flushBook(api, key)
    local unsent = self:get("unsent", {})[key]
    if unsent then
        local row = self:get("progress", {})[key]
        if row and row.count == unsent.count then
            self:agreed(key, row.count)
        elseif row and row.modified > (self:get("seen", {})[key] or 0) then
            -- Another device saved a place after this one last looked: open the book to choose.
            return false
        elseif self:putPlace(api, key, unsent.count, unsent.progress, row) ~= 200 then
            return false
        end
    end
    return self:get("pending", {})[key] == nil
end

function Chimi:sync(opts)
    exclusive(self.syncBook, self, opts)
end

--- Pulls, then offers the server's place if another device saved one since this device last looked,
--- else sends this device's place (if it moved) and its reading time.
--- opts.interactive: say what happened; opts.quiet: never prompt (closing, suspending).
function Chimi:syncBook(opts)
    local id = self:bookId()
    if not id then return end
    local api = self:api()
    local ok, err = self:pull(api)
    if not ok then
        if opts.interactive then notify(T(_("Sync failed: %1"), err or "?"), 4) end
        return
    end
    -- On open and when asked, not on every push: the setting rarely changes.
    if not opts.quiet then self:pullSettings(api) end
    local key = tostring(id)
    local row = self:get("progress", {})[key]
    local here = self:currentCount()
    if row and row.modified > (self:get("seen", {})[key] or 0) and row.count ~= here then
        -- Someone saved a place after the one this device last saw: never overwrite it unasked.
        if not opts.quiet then
            if self:landsWithoutAsking(key, here) then self:jumpTo(id, row) else self:offerJump(id, row) end
        end
        self:pushStatistics(api)
        return
    end
    if row then self:seen(id, row.modified) end
    local pushed, refused = false, false
    if here and here ~= self.last_pushed and not (row and row.count == here) then
        local code, body, put_err = self:putPlace(api, key, here, self:fraction(here), row)
        if code == 200 then
            self.last_pushed = here
            pushed = true
        elseif code == 409 and body and body.row then
            -- The server's row is newer (another clock ahead of ours): offer it next time.
            logger.info("chimimouryou: the server has a newer place")
            refused = true
        elseif opts.interactive then
            notify(T(_("Could not save your place: %1"), put_err or "?"), 4)
            return
        end
    elseif row and row.count == here then
        self:agreed(key, here)
        self.last_pushed = here
    end
    local stats_err = self:pushStatistics(api)
    if opts.interactive then
        local text = refused and _("Your place wasn't saved: the server has a newer one. Sync again to see it.")
            or pushed and _("Your place was saved on the server.") or nil
        if stats_err then
            text = (text and text .. "\n" or "") .. T(_("Your reading time wasn't sent: %1"), stats_err)
        end
        notify(text or _("Already in step with the server."), stats_err and 5 or 3)
    end
end

-- Statistics

-- getDateKey (statistic-util.ts): before the start hour it is still the day before.
local function day_key(t, start_hour)
    local d = os.date("*t", t)
    if d.hour < (start_hour or 0) then
        -- Noon of the day before, normalised by os.time: clear of DST changes.
        return os.date("%Y-%m-%d", os.time{ year = d.year, month = d.month, day = d.day - 1, hour = 12 })
    end
    return os.date("%Y-%m-%d", t)
end

--- Counts this page turn's reading time and characters into the open book's pending additions.
function Chimi:countPageTurn()
    local id, book = self:bookId()
    if not id or not self:get("statistics", true) then return end
    local now, count = os.time(), self:currentCount()
    if self.last_turn and count then
        local seconds = math.min(now - self.last_turn, MAX_PAGE_SECONDS)
        -- Manga: /m counts the characters of the pages' mokuro text, which isn't on the device.
        local characters = self.last_count and not self:paged() and count - self.last_count or 0
        if characters < 0 or characters > MAX_PAGE_CHARACTERS then characters = 0 end
        if seconds > 0 or characters > 0 then
            local pending = self:get("pending", {})
            local key = tostring(id)
            pending[key] = pending[key] or { title = book.title, days = {} }
            local days = pending[key].days
            local date = day_key(now, self:get("day_start", 0))
            local day = days[date] or { seconds = 0, characters = 0 }
            day.seconds = day.seconds + math.max(seconds, 0)
            day.characters = day.characters + characters
            days[date] = day
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
--- Returns the first refusal's error (a refusal other than 409), or nil.
function Chimi:pushStatistics(api)
    local first_err
    local pending = self:get("pending", {})
    local stats = self:get("stats", {})
    for key, book in pairs(pending) do
        for day, add in pairs(book.days) do
            -- A PUT whose answer was lost: the pulled row carrying its exact `modified` means the
            -- server took it, so only what was read since is still to add.
            -- shortcut: a row another device wrote on top before this pull hides whether ours landed
            -- (added again then); an idempotency id on the server would settle it if that shows up.
            local sent, row = add.sent, (stats[key] or {})[day]
            if sent and row and row.modified == sent.modified then
                add.seconds, add.characters = add.seconds - sent.seconds, add.characters - sent.characters
            end
            add.sent = nil
            if add.seconds <= 0 and add.characters == 0 then
                book.days[day] = nil
                self:set("pending", pending)
            end
            for _ = 1, book.days[day] and 2 or 0 do
                row = (stats[key] or {})[day]
                local stat = util.tableDeepCopy(row and row.data or {})
                stat.title, stat.dateKey = book.title, day
                local modified = math.max(now_ms(), (row and row.modified or 0) + 1)
                add_to_statistic(stat, add.seconds, add.characters, modified)
                -- On disk before the PUT, so a lost answer (or a crash) can't count it twice.
                add.sent = { modified = modified, seconds = add.seconds, characters = add.characters }
                self:set("pending", pending)
                local code, body, put_err = api:put("books/" .. key .. "/statistics/" .. day, modified, stat)
                if code == 200 then
                    stats[key] = stats[key] or {}
                    stats[key][day] = { modified = modified, data = stat }
                    book.days[day] = nil
                    -- At once: an accepted day still pending on disk would be added again next time.
                    self:set("pending", pending)
                    break
                elseif code == 409 and body and type(body.row) == "table" then
                    add.sent = nil -- refused, so nothing of it landed
                    stats[key] = stats[key] or {}
                    stats[key][day] = { modified = body.row.modified, data = without_nulls(body.row.data) }
                else
                    -- A refusal that stays (422: this clock is ahead, 507: the server's disk is full).
                    if code and code ~= 409 then first_err = first_err or put_err end
                    break
                end
            end
        end
        if next(book.days) == nil then pending[key] = nil end
    end
    self.store:saveSetting("stats", stats)
    self:set("pending", pending)
    return first_err
end

local function day_number(date)
    local y, m, d = tostring(date):match("^(%d+)-(%d+)-(%d+)$")
    if not y then return nil end
    return math.floor(os.time{ year = tonumber(y), month = tonumber(m), day = tonumber(d), hour = 12 } / 86400 + 0.5)
end

--- Reading time and characters from the mirrored statistics plus the unsent time, with the web's
--- rules (learner-stats.ts): characters count without time, a day with either counts as read, speed
--- uses only rows with time. book_key (optional): also that book's numbers.
function Chimi:summary(book_key)
    -- book → date → { t, c }: the server's row with this device's unsent addition on top.
    local cells = {}
    local function cell(key, date)
        cells[key] = cells[key] or {}
        cells[key][date] = cells[key][date] or { t = 0, c = 0 }
        return cells[key][date]
    end
    local stats = self:get("stats", {})
    for key, rows in pairs(stats) do
        for date, row in pairs(rows) do
            if type(row.data) == "table" then -- nil: a deleted row
                local sum = cell(key, date)
                sum.t = sum.t + math.max(0, tonumber(row.data.readingTime) or 0)
                sum.c = sum.c + math.max(0, tonumber(row.data.charactersRead) or 0)
            end
        end
    end
    for key, book in pairs(self:get("pending", {})) do
        for date, add in pairs(book.days or {}) do
            local seconds, characters = add.seconds or 0, add.characters or 0
            -- Sent and taken (the row carries its `modified`): already in the row.
            local row = (stats[key] or {})[date]
            if add.sent and row and row.modified == add.sent.modified then
                seconds, characters = seconds - add.sent.seconds, characters - add.sent.characters
            end
            local sum = cell(key, date)
            sum.t, sum.c = sum.t + math.max(0, seconds), sum.c + math.max(0, characters)
        end
    end
    local today = day_number(day_key(os.time(), self:get("day_start", 0)))
    local out = { today = { t = 0, c = 0 }, week = { t = 0, c = 0 }, total = { t = 0, c = 0, speed = 0 },
        book = { t = 0, c = 0, speed = 0, days = 0 }, streak = 0 }
    local read, timed, book_timed = {}, 0, 0
    for key, dates in pairs(cells) do
        for date, sum in pairs(dates) do
            local n = day_number(date)
            if n and (sum.t > 0 or sum.c > 0) then
                read[n] = true
                out.total.t, out.total.c = out.total.t + sum.t, out.total.c + sum.c
                if sum.t > 0 then timed = timed + sum.c end
                if n == today then out.today.t, out.today.c = out.today.t + sum.t, out.today.c + sum.c end
                if n > today - 7 and n <= today then
                    out.week.t, out.week.c = out.week.t + sum.t, out.week.c + sum.c
                end
                if key == book_key then
                    local b = out.book
                    b.t, b.c, b.days = b.t + sum.t, b.c + sum.c, b.days + 1
                    if sum.t > 0 then book_timed = book_timed + sum.c end
                    if not b.first or date < b.first then b.first = date end
                    if not b.last or date > b.last then b.last = date end
                end
            end
        end
    end
    local function speed(characters, seconds)
        return seconds > 0 and math.floor(3600 * characters / seconds + 0.5) or 0
    end
    out.total.speed, out.book.speed = speed(timed, out.total.t), speed(book_timed, out.book.t)
    local n = read[today] and today or today - 1
    while read[n] do
        out.streak = out.streak + 1
        n = n - 1
    end
    return out
end

--- The statistics dialog: the account's, and a book's (id: the open book by default; book: a
--- catalog book, for one that isn't open).
function Chimi:showStats(id, book)
    local open_id, open_book = self:bookId()
    id = id or open_id
    local key = id and tostring(id)
    local s = self:summary(key)
    local function amount(sum)
        return T(_("%1 · %2 characters"), format_duration(sum.t), sum.c)
    end
    local lines = {}
    if s.total.t == 0 and s.total.c == 0 then
        table.insert(lines, _("No reading time yet."))
    else
        table.insert(lines, T(_("Today: %1"), amount(s.today)))
        table.insert(lines, T(_("Last 7 days: %1"), amount(s.week)))
        table.insert(lines, T(_("Streak: %1 days"), s.streak))
        table.insert(lines, T(_("Total: %1"), amount(s.total)))
        table.insert(lines, T(_("Speed: %1 characters/hour"), s.total.speed))
    end
    if key then
        local count, total, pages
        if open_id and key == tostring(open_id) then
            count = self:currentCount()
            if self:paged() then pages = self.ui.document:getPageCount() else total = self:counts().total end
        else
            local row = self:get("progress", {})[key]
            count, pages = row and row.count, book and tonumber(book.pages)
            if not pages then total = book and tonumber(book.characters) end
        end
        local b = s.book
        table.insert(lines, "")
        table.insert(lines, (book and book.title) or (open_book and open_book.title) or _("This book"))
        if b.days > 0 then
            table.insert(lines, T(_("Read: %1"), amount(b)))
            table.insert(lines, T(_("Speed: %1 characters/hour"), b.speed))
            table.insert(lines, T(_("Days read: %1 (%2 to %3)"), b.days, b.first, b.last))
        end
        if count and pages then
            table.insert(lines, T(_("Place: page %1 of %2"), count + 1, pages))
        elseif count and total then
            table.insert(lines, T(_("Place: character %1 of %2 (%3%)"), count, total, percent(count, total)))
            local left = math.max(0, total - count)
            table.insert(lines, T(_("Characters left: %1"), left))
            -- Under 10 minutes of this book is too little to go by: the account's speed then.
            local speed = b.t >= 600 and b.speed or s.total.speed
            if speed > 0 then
                table.insert(lines, T(_("Time left: about %1"), format_duration(left * 3600 / speed)))
            end
        elseif count then
            table.insert(lines, T(_("Place: character %1"), count))
        end
    end
    UIManager:show(TextViewer:new{ title = _("Reading statistics"), text = table.concat(lines, "\n") })
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
    self:keepPlace()
    self.store:flush() -- offline, nothing else writes the pending time to disk
    self.last_turn = nil
    if NetworkMgr:isOnline() then self:sync{ quiet = true } end
end

function Chimi:onResume()
    if self:bookId() then self.last_turn = os.time() end
end

function Chimi:onCloseDocument()
    if not self:bookId() then return end
    self:countPageTurn()
    self:keepPlace()
    self.store:flush() -- offline, nothing else writes the pending time to disk
    if NetworkMgr:isOnline() then self:sync{ quiet = true } end
    self.fragment_counts, self.index_cache, self.last_turn, self.last_count = nil, nil, nil, nil
end

-- Wi-Fi came on: the Reading folder follows Home (never turns Wi-Fi on itself).
function Chimi:onNetworkConnected()
    UIManager:nextTick(function() self:syncFolder() end)
end

function Chimi:onCloseWidget()
    UIManager:unschedule(self.push_task)
end

return Chimi
