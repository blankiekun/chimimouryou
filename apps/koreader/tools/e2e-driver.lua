-- SPDX-License-Identifier: GPL-3.0-or-later
-- KOReader user patch (e2e.sh installs it as patches/2-chimimouryou-e2e.lua): drives the plugin in a
-- real KOReader session and screenshots each step into E2E_OUT. Steps: sign-in over http (refused
-- here), library with levels, search, download, open, the offer to jump to the server's place, page
-- turns, sync. Lines starting with "E2E" are what e2e.sh checks.
local Event = require("ui/event")
local UIManager = require("ui/uimanager")

local out, server, title = os.getenv("E2E_OUT"), os.getenv("E2E_SERVER"), os.getenv("E2E_TITLE")
local function log(...) print("E2E", ...) end
local function shot(name)
    UIManager:forceRePaint()
    os.execute(string.format("import -window root %q", out .. "/" .. name .. ".png"))
end
local function top() return UIManager:getTopmostVisibleWidget() end
local function plugin()
    local ReaderUI = require("apps/reader/readerui")
    local ui = ReaderUI.instance or require("apps/filemanager/filemanager").instance
    return ui and ui.chimimouryou, ui
end

local steps = {
    function()
        local p = plugin()
        log("plugin", p ~= nil)
        p:set("server", server)
        if os.getenv("E2E_TOKEN") then p:set("token", os.getenv("E2E_TOKEN")) end
        p:askSignIn()
    end,
    function()
        shot("01-sign-in")
        log("sign-in", top().text)
        UIManager:close(top())
        require("library").show(plugin())
        return 4
    end,
    function()
        shot("02-library")
        local menu = top()
        log("library", #menu.item_table, menu.item_table[2] and menu.item_table[2].mandatory)
        menu.item_table[1].callback()
    end,
    function()
        local dialog = top()
        dialog:setInputText(title)
        dialog.buttons[1][2].callback()
        return 3
    end,
    function()
        shot("03-search")
        local menu = top()
        for _, item in ipairs(menu.item_table) do
            if item.text:find(title, 1, true) == 1 then
                log("found", item.text, item.mandatory)
                item.callback()
                return 4
            end
        end
        log("found", "nothing")
    end,
    function()
        shot("04-downloaded")
        local box = top()
        log("downloaded", box.text)
        box.ok_callback()
        UIManager:close(box)
        return 8
    end,
    function()
        shot("05-offer")
        local box = top()
        log("offer", box.text)
        if box.ok_callback then
            box.ok_callback()
            UIManager:close(box)
        end
        return 3
    end,
    function()
        shot("06-after-jump")
        local p = plugin()
        log("count-after-jump", p:currentCount(), p:counts().total)
    end,
}
-- Page turns, a few seconds apart so reading time accrues.
for _ = 1, 5 do
    table.insert(steps, function()
        local _p, ui = plugin()
        ui:handleEvent(Event:new("GotoViewRel", 1))
        return 3
    end)
end
table.insert(steps, function()
    local p = plugin()
    log("count-before-sync", p:currentCount())
    p:sync{ interactive = true }
    return 2
end)
table.insert(steps, function()
    shot("07-synced")
    log("synced", top().text)
    log("pending", next(plugin():get("pending", {})) == nil and "none" or "left")
    UIManager:quit()
end)

local function run(i)
    local ok, wait = pcall(steps[i])
    if not ok then
        log("error", i, wait)
        UIManager:quit()
        return
    end
    if steps[i + 1] then UIManager:scheduleIn(wait or 2, function() run(i + 1) end) end
end
UIManager:scheduleIn(4, function() run(1) end)
