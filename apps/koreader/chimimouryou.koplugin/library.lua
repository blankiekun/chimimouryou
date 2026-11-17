-- SPDX-License-Identifier: GPL-3.0-or-later
-- chimimouryou KOReader plugin: the server's library (GET /api/v1/books), with each book's 1-10
-- difficulty level, search and download, under the sections Continue reading, Home and On this device.

local DataStorage = require("datastorage")
local DocSettings = require("docsettings")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local Library = {}

-- difficulty-scale.json (version 3): [level, V98] anchors, both rising.
local ANCHORS = {
    {1.0, 19612}, {1.25, 20784}, {1.5, 21858}, {1.75, 22701}, {2.0, 23768}, {2.25, 24276}, {2.5, 25007},
    {2.75, 25777}, {3.0, 26568}, {3.25, 27420}, {3.5, 28376}, {3.75, 29378}, {4.0, 30452}, {4.25, 31375},
    {4.5, 32449}, {4.75, 33521}, {5.0, 34621}, {5.25, 35576}, {5.5, 37068}, {5.75, 38513}, {6.0, 39872},
    {6.25, 41497}, {6.5, 43376}, {6.75, 45524}, {7.0, 47689}, {7.25, 49896}, {7.5, 52051}, {7.75, 54789},
    {8.0, 57826}, {8.25, 62138}, {8.5, 70708}, {8.75, 79914}, {9.0, 98147}, {9.25, 114202}, {9.5, 131005},
    {9.75, 144604}, {10.0, 174267},
}

--- coreScore (functions/analysis/core.ts): V98 on the 1-10 scale, log-linear between the anchors.
function Library.level(v98)
    local top = ANCHORS[#ANCHORS][1]
    if type(v98) ~= "number" or v98 <= 0 then return top end
    local x = math.log(v98)
    if x <= math.log(ANCHORS[1][2]) then return ANCHORS[1][1] end
    for i = 2, #ANCHORS do
        local s0, v0, s1, v1 = ANCHORS[i - 1][1], ANCHORS[i - 1][2], ANCHORS[i][1], ANCHORS[i][2]
        if x <= math.log(v1) then
            local score = s0 + (s1 - s0) * (x - math.log(v0)) / (math.log(v1) - math.log(v0))
            return math.floor(score * 100 + 0.5) / 100
        end
    end
    return top
end

-- Calibre id → level, from the difficulty service's results (keyed by Calibre id, like the web
-- library's book-details.ts; read once per KOReader session).
local levels

local function load_levels(api)
    if levels then return levels end
    local code, body = api:difficulty()
    levels = {}
    if code == 200 and body and type(body.books) == "table" then
        for id, estimate in pairs(body.books) do
            local core = type(estimate) == "table" and estimate.core
            -- levelOf: only estimates with the fast core's numbers have a level.
            if type(core) == "table" and type(core.tokens) == "number" and core.tokens > 0 then
                levels[tostring(id)] = Library.level(core.v98)
            end
        end
    end
    return levels
end

local function download_dir(plugin)
    local dir = plugin:get("download_dir")
        or (G_reader_settings:readSetting("home_dir") or DataStorage:getDataDir()) .. "/chimimouryou"
    if not lfs.attributes(dir, "mode") then util.makePath(dir) end
    return dir
end

local MAX_NAME_BYTES = 200

local function file_name(book)
    local name = tostring(book.title or book.id)
    -- File systems allow 255 bytes, about 85 Japanese characters. The id keeps two cut titles apart.
    if #name > MAX_NAME_BYTES then
        local cut = MAX_NAME_BYTES
        while cut > 0 and name:byte(cut + 1) >= 0x80 and name:byte(cut + 1) < 0xC0 do cut = cut - 1 end
        name = name:sub(1, cut) .. " " .. tostring(book.id)
    end
    name = name:gsub('[\\/:*?"<>|%c]', "_")
    return name .. "." .. tostring(book.format or "epub"):lower()
end

local function open_book(path)
    local ReaderUI = require("apps/reader/readerui")
    ReaderUI:showReader(path)
end

--- What the plugin keeps of a downloaded book (books[id]): enough to list and open it offline.
local function downloaded_entry(book, path)
    local entry = { path = path }
    for _, key in ipairs{ "id", "title", "authors", "calibreId", "format", "file", "characters" } do
        -- Strings and numbers only: LuaSettings can't save rapidjson's null.
        local value = book[key]
        if type(value) == "string" or type(value) == "number" then entry[key] = value end
    end
    return entry
end

local function is_file(path)
    return type(path) == "string" and lfs.attributes(path, "mode") == "file"
end

--- Opens the book when it is on this device, else downloads it and opens it.
function Library.download(plugin, menu, book)
    local api = plugin:api()
    local entry = plugin:get("books", {})[tostring(book.id)]
    local path = type(entry) == "table" and is_file(entry.path) and entry.path
        or download_dir(plugin) .. "/" .. file_name(book)
    local function done()
        -- The book's sidecar remembers which server book it is, so progress follows it when moved.
        local settings = DocSettings:open(path)
        settings:saveSetting("chimimouryou", { id = book.id, server = plugin:get("server"), title = book.title })
        settings:flush()
        local books = plugin:get("books", {})
        books[tostring(book.id)] = downloaded_entry(book, path)
        plugin:set("books", books)
        UIManager:close(menu)
        open_book(path)
    end
    if lfs.attributes(path, "mode") == "file" then
        done()
        return
    end
    local info = InfoMessage:new{ text = T(_("Downloading %1…"), book.title) }
    UIManager:show(info)
    UIManager:forceRePaint()
    local ok, err = api:download(book.file, path)
    UIManager:close(info)
    if ok then done() else UIManager:show(InfoMessage:new{ text = T(_("Download failed: %1"), err) }) end
end

-- Server books by id and by unique title (false: asked for, not there), for this KOReader session.
local by_id, by_title = {}, {}

-- Games aren't books KOReader can open.
local function openable(book)
    return not book.vn and not book.deleted and type(book.file) == "string"
end

--- Fills by_id/by_title for the ids and titles not asked for yet (GET /api/v1/books?ids=&titles=).
local function fetch_books(api, ids, titles)
    local want_ids, want_titles = {}, {}
    for _, id in ipairs(ids) do if by_id[id] == nil then table.insert(want_ids, id) end end
    for _, title in ipairs(titles) do if by_title[title] == nil then table.insert(want_titles, title) end end
    local i, j = 1, 1
    while i <= #want_ids or j <= #want_titles do
        local chunk_ids, chunk_titles = {}, {}
        while i <= #want_ids and #chunk_ids < 100 do
            table.insert(chunk_ids, want_ids[i])
            i = i + 1
        end
        while j <= #want_titles and #chunk_titles < 20 do
            table.insert(chunk_titles, want_titles[j])
            j = j + 1
        end
        local code, body = api:books_by(chunk_ids, chunk_titles)
        if code ~= 200 or not body then return end -- asked again next time
        local asked_ids, asked_titles = {}, {}
        for _, id in ipairs(chunk_ids) do asked_ids[id] = true end
        for _, title in ipairs(chunk_titles) do asked_titles[title] = true end
        -- An older server ignores ids/titles and sends the newest books: keep only the ones asked for.
        for _, book in ipairs(body.books or {}) do
            local key = tostring(book.id)
            if (asked_ids[key] or asked_titles[book.title]) and openable(book) then
                by_id[key], by_title[book.title] = book, book
            end
        end
        for id in pairs(asked_ids) do if by_id[id] == nil then by_id[id] = false end end
        for title in pairs(asked_titles) do if by_title[title] == nil then by_title[title] = false end end
    end
end

--- The sections above the server's list: Continue reading (as the web's Home shelf), the Home books
--- (last added first) and the other books on this device (last read or downloaded first).
function Library.sections(plugin, api)
    local books, progress = plugin:get("books", {}), plugin:get("progress", {})
    local home = plugin:get("home", {})
    local titles, removed = home.titles or {}, home.removed or {}
    local reading = plugin:inProgress()
    local ids = {}
    for _, item in ipairs(reading) do
        if type(books[item.key]) ~= "table" then table.insert(ids, item.key) end
    end
    -- Downloaded before books kept their metadata.
    for key, entry in pairs(books) do if entry == true then table.insert(ids, key) end end
    local downloaded_title = {}
    for _, entry in pairs(books) do if type(entry) == "table" then downloaded_title[entry.title] = entry end end
    local home_titles = {}
    for _, title in ipairs(titles) do if not downloaded_title[title] then table.insert(home_titles, title) end end
    fetch_books(api, ids, home_titles)

    local upgraded = false
    for key, entry in pairs(books) do
        local book = by_id[key]
        if entry == true and book then
            local path = download_dir(plugin) .. "/" .. file_name(book)
            if is_file(path) then
                books[key] = downloaded_entry(book, path)
                downloaded_title[book.title] = books[key]
                upgraded = true
            end
        end
    end
    if upgraded then plugin:set("books", books) end

    local function book_of(key)
        if type(books[key]) == "table" then return books[key] end
        return by_id[key] or nil
    end
    local listed = {}
    local continue, home_books, device = {}, {}, {}
    for _, item in ipairs(reading) do
        local book = book_of(item.key)
        if book and openable(book) and (item.row.modified or 0) > (removed[book.title] or 0) then
            table.insert(continue, book)
            listed[item.key] = true
            if #continue == 12 then break end
        end
    end
    for i = #titles, 1, -1 do
        local title = titles[i]
        local book = downloaded_title[title] or by_title[title]
        if book and not ((removed[title] or 0) > 0) and not listed[tostring(book.id)] then
            table.insert(home_books, book)
            listed[tostring(book.id)] = true
        end
    end
    for key, entry in pairs(books) do
        if type(entry) == "table" and not listed[key] and is_file(entry.path) then
            local row = progress[key]
            local time = row and row.modified or (lfs.attributes(entry.path, "modification") or 0) * 1000
            table.insert(device, { book = entry, time = time })
        end
    end
    table.sort(device, function(a, b) return a.time > b.time end)
    for i, item in ipairs(device) do device[i] = item.book end
    local sections = {}
    for _, section in ipairs{ { _("Continue reading"), continue }, { _("Home"), home_books },
        { _("On this device"), device } } do
        if #section[2] > 0 then table.insert(sections, { title = section[1], books = section[2] }) end
    end
    return sections
end

function Library.show(plugin)
    -- Best effort: offline or signed out the sections show what this device knows.
    plugin:pull(plugin:api())
    local api = plugin:api() -- without the token when the pull found it dead
    plugin:pullSettings(api)
    local sections = Library.sections(plugin, api)
    local menu
    local state = { q = nil, books = {}, next = nil }

    local function render()
        local items = {
            {
                text = state.q and T(_("Search: %1"), state.q) or _("Search…"),
                callback = function() Library.search(plugin, state, menu) end,
            },
        }
        local level_of = load_levels(api)
        local progress = plugin:get("progress", {})
        local function add(book)
            local level = book.calibreId and level_of[tostring(book.calibreId)]
            local text = level and string.format("Lv %.1f", level) or nil
            local row = progress[tostring(book.id)]
            local done = row and row.progress >= 0.995 -- FINISHED (main.lua)
            if row then
                local place = done and _("Done") or math.floor(row.progress * 100) .. "%"
                text = text and place .. " · " .. text or place
            end
            table.insert(items, {
                text = book.authors and book.authors ~= "" and book.title .. " — " .. book.authors or book.title,
                mandatory = text,
                dim = done or nil,
                callback = function() Library.download(plugin, menu, book) end,
                hold_callback = function() plugin:showStats(book.id, book) end,
            })
        end
        if not state.q then
            for _, section in ipairs(sections) do
                table.insert(items, { text = section.title, bold = true, separator = true })
                for _, book in ipairs(section.books) do add(book) end
            end
            if #sections > 0 then table.insert(items, { text = _("All books"), bold = true, separator = true }) end
        end
        state.offset = #items
        for _, book in ipairs(state.books) do add(book) end
        if state.next then
            table.insert(items, { text = _("More…"), callback = function() state.load(true) end })
        end
        menu:switchItemTable(_("chimimouryou library"), items, state.first_new or 1)
    end

    function state.load(more)
        local code, body, err = api:books(state.q, more and state.next or nil)
        if code ~= 200 or not body then
            UIManager:show(InfoMessage:new{ text = T(_("Could not read the library: %1"), err or "?") })
            return
        end
        if not more then state.books = {} end
        -- After More…, open the page of the first new book (after the search line and the sections).
        state.first_new = more and (state.offset or 1) + #state.books + 1 or 1
        for _, book in ipairs(body.books or {}) do
            if openable(book) then table.insert(state.books, book) end
        end
        state.next = type(body.next) == "string" and body.next or nil
        render()
    end

    menu = Menu:new{
        title = _("chimimouryou library"),
        item_table = {},
        covers_fullscreen = true,
        is_borderless = true,
        is_popout = false,
    }
    menu.close_callback = function() UIManager:close(menu) end
    -- Hold a book: its statistics.
    menu.onMenuHold = function(_, item)
        if item.hold_callback then item.hold_callback() end
        return true
    end
    UIManager:show(menu)
    state.load(false)
end

function Library.search(plugin, state, menu) -- luacheck: ignore plugin menu
    local dialog
    dialog = InputDialog:new{
        title = _("Search the library"),
        input = state.q or "",
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = _("Search"),
                is_enter_default = true,
                callback = function()
                    local q = util.trim(dialog:getInputText())
                    UIManager:close(dialog)
                    state.q = q ~= "" and q or nil
                    state.load(false)
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

return Library
