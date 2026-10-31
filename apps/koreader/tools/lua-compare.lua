-- SPDX-License-Identifier: GPL-3.0-or-later
-- KOReader's side of count-compare.sh, run by KOReader's own luajit from its folder:
--   ./luajit lua-compare.lua <plugin dir> <ts-count.json> <book.epub>...
-- Opens each book with crengine as KOReader does, counts every DocFragment with charcount.lua and
-- checks it against the web reader's counts (ts-count.json, from ts-count.run.mts):
--   * each spine item's total and the book's total;
--   * at each sample count: the counted characters there, the xpointer for the count (crengine must
--     find that character there) and the count back from that xpointer;
--   * every page's xpointer from crengine maps to a node charcount.lua knows (no fallback).
-- Prints one line per book and exits 1 on any difference.
local plugin_dir, ts_file = arg[1], arg[2]
package.path = plugin_dir .. "/?.lua;" .. package.path
require("setupkoenv")
G_defaults = require("luadefaults"):open()
local DataStorage = require("datastorage")
G_reader_settings = require("luasettings"):open(DataStorage:getDataDir() .. "/settings.reader.lua")
local Device = require("device")
require("document/canvascontext"):init(Device)
local DocumentRegistry = require("document/documentregistry")
local json = require("json")
local charcount = require("charcount")

local f = assert(io.open(ts_file))
local ts = json.decode(f:read("*a"))
f:close()

-- The counted characters from `at` on, `span` of them, as the TS side lists them.
local function counted_from(index, at, span)
    local out = {}
    for _, s in ipairs(index.segments) do
        if s.start + s.count > at then
            if s.gaiji then
                table.insert(out, "\238\128\128") -- U+E000, text-positions.ts's gaiji placeholder
            else
                local n = s.start
                for ch in s.text:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
                    local cp = charcount.count_text(ch)
                    if cp > 0 then
                        if n >= at then table.insert(out, ch) end
                        n = n + 1
                    end
                    if #out >= span then break end
                end
            end
        end
        if #out >= span then break end
    end
    return table.concat(out)
end

local failed = false
for k = 3, #arg do
    local file = arg[k]
    local name = file:match("[^/]+$")
    local expected = ts[name]
    local problems = {}
    local function problem(fmt, ...) table.insert(problems, string.format(fmt, ...)) end
    if not expected then
        problem("not in %s", ts_file)
    else
        local doc = DocumentRegistry:openDocument(file)
        doc:loadDocument()
        doc:render()
        local fragments = 0
        while doc:isXPointerInDocument("/body/DocFragment[" .. (fragments + 1) .. "]") do
            fragments = fragments + 1
        end
        if fragments == 0 and doc:isXPointerInDocument("/body/DocFragment") then fragments = 1 end
        if fragments ~= #expected.sections then
            problem("%d DocFragments, %d spine sections", fragments, #expected.sections)
        end
        local indexes, total, samples = {}, 0, 0
        for i = 1, fragments do
            local base = charcount.fragment_path(i, fragments)
            local index = charcount.index(doc:getHTMLFromXPointer(base, 0) or "", base)
            indexes[i] = index
            total = total + index.total
            local section = expected.sections[i]
            if section and section.count ~= index.total then
                problem("fragment %d (%s): %d, web %d", i, section.id, index.total, section.count)
            elseif section then
                for _, sample in ipairs(section.samples) do
                    samples = samples + 1
                    local text = counted_from(index, sample.at, 6)
                    if text ~= sample.text then
                        problem("fragment %d at %d: %q, web %q", i, sample.at, text, sample.text)
                    end
                    local xp = charcount.xpointer_for(index, sample.at)
                    local back = xp and charcount.count_at(index, xp)
                    if back ~= sample.at then
                        problem("fragment %d at %d: xpointer %s counts back to %s", i, sample.at, tostring(xp), tostring(back))
                    elseif not xp:find("/img") then
                        local path, offset = xp:match("^(.-)%.(%d+)$")
                        local char = doc:getTextFromXPointers(xp, path .. "." .. (tonumber(offset) + 1))
                        local want = sample.text:match("^[%z\1-\127\194-\244][\128-\191]*")
                        if char ~= want then
                            problem("fragment %d at %d: crengine has %q at %s, web %q", i, sample.at, tostring(char), xp, want)
                        end
                    end
                end
            end
        end
        if total ~= expected.characters then problem("book: %d, web %d", total, expected.characters) end
        -- Page starts are where KOReader saves its place: each must be a node charcount.lua indexed.
        local pages, missed = doc:getPageCount(), 0
        for p = 1, pages do
            local xp = doc:getPageXPointer(p)
            local frag = charcount.fragment_of(xp)
            local index = frag and indexes[frag]
            local path = xp and xp:match("^(.-)%.%d+$") or xp
            if not (index and index.nodes[path]) then
                missed = missed + 1
                if missed <= 3 then problem("page %d: %s not indexed", p, tostring(xp)) end
            end
        end
        if missed > 3 then problem("%d pages not indexed", missed) end
        print(string.format("%s %s: %d characters, %d fragments, %d samples, %d pages",
            #problems == 0 and "OK  " or "FAIL", name, total, fragments, samples, pages))
        doc:close()
    end
    for _, p in ipairs(problems) do print("     " .. p) end
    failed = failed or #problems > 0
end
os.exit(failed and 1 or 0)
