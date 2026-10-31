-- SPDX-License-Identifier: GPL-3.0-or-later
-- chimimouryou KOReader plugin: the server's library (GET /api/v1/books), with each book's 1-10
-- difficulty level, search and download.

local ConfirmBox = require("ui/widget/confirmbox")
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

local function file_name(book)
    local name = tostring(book.title or book.id):gsub('[\\/:*?"<>|%c]', "_")
    return name .. "." .. tostring(book.format or "epub"):lower()
end

local function open_book(path)
    local ReaderUI = require("apps/reader/readerui")
    ReaderUI:showReader(path)
end

function Library.download(plugin, menu, book)
    local api = plugin:api()
    local path = download_dir(plugin) .. "/" .. file_name(book)
    local function done()
        -- The book's sidecar remembers which server book it is, so progress follows it when moved.
        local settings = DocSettings:open(path)
        settings:saveSetting("chimimouryou", { id = book.id, server = plugin:get("server"), title = book.title })
        settings:flush()
        local books = plugin:get("books", {})
        books[tostring(book.id)] = true
        plugin:set("books", books)
        UIManager:show(ConfirmBox:new{
            text = T(_("%1 is on this device. Open it now?"), book.title),
            ok_text = _("Open"),
            ok_callback = function()
                UIManager:close(menu)
                open_book(path)
            end,
        })
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

function Library.show(plugin)
    local api = plugin:api()
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
        for _, book in ipairs(state.books) do
            local level = book.calibreId and level_of[tostring(book.calibreId)]
            table.insert(items, {
                text = book.authors ~= "" and book.title .. " — " .. book.authors or book.title,
                mandatory = level and string.format("Lv %.1f", level) or nil,
                callback = function() Library.download(plugin, menu, book) end,
            })
        end
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
        -- After More…, open the page of the first new book (the search line is item 1).
        state.first_new = more and #state.books + 2 or 1
        for _, book in ipairs(body.books or {}) do
            -- Games aren't books KOReader can open.
            if not book.vn and not book.deleted and type(book.file) == "string" then
                table.insert(state.books, book)
            end
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
