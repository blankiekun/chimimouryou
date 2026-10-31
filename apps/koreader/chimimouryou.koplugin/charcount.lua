-- SPDX-License-Identifier: GPL-3.0-or-later
-- chimimouryou KOReader plugin: character counts as the web reader makes them.
--
-- The web reader's positions (bookmarks' exploredCharCount, statistics) are counts of characters
-- from the start of the book, over the text nodes of every spine item in order
-- (apps/web/src/lib/components/book-reader/get-paragraph-nodes.ts: no <rt>, nothing under an element
-- with a hidden or aria-hidden attribute, a gaiji <img> is one character), each counted by
-- countTextCharacters (apps/web/src/lib/functions/get-character-count.ts). This module does the same
-- over the HTML crengine serializes for one DocFragment (one spine item), and maps counts to
-- KOReader xpointers and back. Pure Lua: tools/count-compare.sh runs it against the TS counter.

local M = {}

-- Code point ranges of get-character-count.ts's class
-- [0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}] with the i and u flags
-- (so a-z, ſ, K and ａ-ｚ too), listed by Node 24 (Unicode 17) testing every code point against it.
local RANGES = {
    0x30, 0x39, 0x41, 0x5A, 0x61, 0x7A, 0x17F, 0x17F, 0x212A, 0x212A, 0x25CB, 0x25CB, 0x25EF, 0x25EF,
    0x2E80, 0x2E99, 0x2E9B, 0x2EF3, 0x2F00, 0x2FD5, 0x3005, 0x3007, 0x303B, 0x303B, 0x3041, 0x3096,
    0x309D, 0x309E, 0x30A1, 0x30FA, 0x30FC, 0x30FC, 0x3400, 0x4DBF, 0x4E00, 0x9FFF, 0xFA0E, 0xFA0F,
    0xFA11, 0xFA11, 0xFA13, 0xFA14, 0xFA1F, 0xFA1F, 0xFA21, 0xFA21, 0xFA23, 0xFA24, 0xFA27, 0xFA29,
    0xFF10, 0xFF19, 0xFF21, 0xFF3A, 0xFF41, 0xFF5A, 0xFF66, 0xFF9D, 0x20000, 0x2A6DF, 0x2A700, 0x2B81D,
    0x2B820, 0x2CEAD, 0x2CEB0, 0x2EBE0, 0x2EBF0, 0x2EE5D, 0x30000, 0x3134A, 0x31350, 0x33479,
}
M.RANGES = RANGES

local function is_counted(cp)
    local lo, hi = 1, #RANGES / 2
    while lo <= hi do
        local mid = math.floor((lo + hi) / 2)
        if cp < RANGES[2 * mid - 1] then
            hi = mid - 1
        elseif cp > RANGES[2 * mid] then
            lo = mid + 1
        else
            return true
        end
    end
    return false
end
M.is_counted = is_counted

-- The code point at byte i of s and the byte after it (bad bytes count as one code point each).
local function next_cp(s, i)
    local c = s:byte(i)
    if c < 0x80 then return c, i + 1 end
    local n, cp
    if c >= 0xF0 then n, cp = 3, c % 0x08 elseif c >= 0xE0 then n, cp = 2, c % 0x10
    elseif c >= 0xC0 then n, cp = 1, c % 0x20 else return 0xFFFD, i + 1 end
    for k = 1, n do
        local b = s:byte(i + k)
        if not b or b < 0x80 or b > 0xBF then return 0xFFFD, i + 1 end
        cp = cp * 64 + b % 64
    end
    return cp, i + n + 1
end

--- Counted characters in a UTF-8 string (countTextCharacters).
function M.count_text(s)
    local n, i, len = 0, 1, #s
    while i <= len do
        local cp
        cp, i = next_cp(s, i)
        if is_counted(cp) then n = n + 1 end
    end
    return n
end

-- Counted characters in the first `cps` code points of s (xpointer offsets are code points).
local function count_prefix(s, cps)
    local n, i, len, k = 0, 1, #s, 0
    while i <= len and k < cps do
        local cp
        cp, i = next_cp(s, i)
        k = k + 1
        if is_counted(cp) then n = n + 1 end
    end
    return n
end

-- Code point offset in s just before its counted character number `nth` (1-based).
local function offset_of_counted(s, nth)
    local n, i, len, k = 0, 1, #s, 0
    while i <= len do
        local cp
        cp, i = next_cp(s, i)
        if is_counted(cp) then
            n = n + 1
            if n == nth then return k end
        end
        k = k + 1
    end
    return k
end

local function utf8_char(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then return string.char(0xC0 + math.floor(cp / 64), 0x80 + cp % 64) end
    if cp < 0x10000 then
        return string.char(0xE0 + math.floor(cp / 4096), 0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
    end
    return string.char(0xF0 + math.floor(cp / 262144), 0x80 + math.floor(cp / 4096) % 64,
        0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
end

local ENTITIES = { amp = "&", lt = "<", gt = ">", quot = '"', apos = "'", nbsp = "\194\160" }

local function decode(s)
    if not s:find("&", 1, true) then return s end
    return (s:gsub("&(#?[xX]?)(%w+);", function(kind, name)
        if kind == "" then return ENTITIES[name] end
        local cp = tonumber(name, (kind == "#x" or kind == "#X") and 16 or 10)
        return cp and utf8_char(cp)
    end))
end

-- crengine's boxing elements (rendering wrappers): xpointers skip them, as if their children were
-- their parent's.
local BOXING = { autoBoxing = true, floatBox = true, inlineBox = true, rubyBox = true, mathBox = true }
-- Elements whose text the web reader never sees: get-paragraph-nodes.ts skips <rt>,
-- sanitize-book-html.ts removes these with everything in them.
local DROPPED = {
    rt = true, script = true, iframe = true, frame = true, frameset = true, object = true, embed = true,
    applet = true, portal = true, base = true, meta = true, link = true, form = true, template = true,
    noscript = true, noembed = true, noframes = true, xmp = true, plaintext = true, animate = true,
    set = true,
}

local function attributes(tag)
    local attrs = {}
    for name, value in tag:gmatch('([^%s=/<>"]+)%s*=%s*"([^"]*)"') do
        attrs[name:lower()] = value
    end
    for name, value in tag:gmatch("([^%s=/<>']+)%s*=%s*'([^']*)'") do
        attrs[name:lower()] = attrs[name:lower()] or value
    end
    return attrs
end

-- Whether an element and everything in it is left out of the count.
local function skipped(name, tag)
    if DROPPED[name] then return true end
    if not tag:find("hidden", 1, true) and not tag:find("placeholder-br", 1, true) then return false end
    local attrs = attributes(tag)
    -- format-book-data-html.ts removes .placeholder-br elements.
    return attrs["hidden"] ~= nil or attrs["aria-hidden"] ~= nil
        or (" " .. (attrs.class or "") .. " "):find("%splaceholder%-br%s") ~= nil
end

--- Parses the HTML crengine gives for one DocFragment (getHTMLFromXPointer(xp, 0)) into an index:
--- `nodes` maps each node's xpointer path (below `base`, e.g. "/body/DocFragment[3]") to
--- `{start = characters before it, text = its text or nil, counted = whether its text counts}`, and
--- `segments` lists the counted text nodes and gaiji images in order. `total` is the fragment's count.
function M.index(html, base)
    -- Build a tree first: an xpointer step has an index only when the name has siblings.
    local root = { children = {} }
    local stack = { root }
    local pos, len = 1, #html
    while pos <= len do
        local lt = html:find("<", pos, true)
        local text_end = (lt or len + 1) - 1
        if text_end >= pos then
            local parent = stack[#stack]
            table.insert(parent.children, { text = decode(html:sub(pos, text_end)) })
        end
        if not lt then break end
        local gt = html:find(">", lt, true)
        if not gt then break end
        local tag = html:sub(lt, gt)
        pos = gt + 1
        if tag:sub(2, 2) == "/" then
            local name = tag:match("^</%s*([^%s>]+)")
            -- Pop to the matching element (crengine's HTML is well formed; this only guards).
            for k = #stack, 2, -1 do
                if stack[k].name == name then
                    for _ = #stack, k, -1 do table.remove(stack) end
                    break
                end
            end
        elseif tag:sub(2, 2) == "!" or tag:sub(2, 2) == "?" then -- luacheck: ignore 542
            -- comments, doctype, processing instructions: no text
        else
            local name = tag:match("^<%s*([^%s/>]+)")
            local parent = stack[#stack]
            local node
            if BOXING[name] then
                -- Children go to the parent, as crengine's xpointers see them.
                node = { name = name, children = parent.children, boxing = true }
            else
                node = { name = name, tag = tag, children = {} }
                table.insert(parent.children, node)
            end
            if tag:sub(-2) ~= "/>" then table.insert(stack, node) end
        end
    end

    local nodes, segments, count = {}, {}, 0
    local function walk(element, path, skip)
        local names, texts = {}, 0
        for _, child in ipairs(element.children) do
            if child.text then texts = texts + 1 else names[child.name] = (names[child.name] or 0) + 1 end
        end
        local seen, text_seen = {}, 0
        for _, child in ipairs(element.children) do
            local child_path
            if child.text then
                text_seen = text_seen + 1
                child_path = path .. "/text()" .. (texts > 1 and "[" .. text_seen .. "]" or "")
                local counted = not skip
                local n = counted and M.count_text(child.text) or 0
                nodes[child_path] = { start = count, text = child.text, counted = counted }
                if n > 0 then
                    table.insert(segments, { path = child_path, start = count, count = n, text = child.text })
                end
                count = count + n
            else
                seen[child.name] = (seen[child.name] or 0) + 1
                child_path = path .. "/" .. child.name
                    .. (names[child.name] > 1 and "[" .. seen[child.name] .. "]" or "")
                local name = child.name:lower()
                local child_skip = skip or skipped(name, child.tag)
                nodes[child_path] = { start = count }
                local class = not child_skip and name == "img" and attributes(child.tag).class
                if class and class:find("gaiji", 1, true) then
                    -- A gaiji image is one character (is-node-gaiji.ts: any class containing "gaiji").
                    table.insert(segments, { path = child_path, start = count, count = 1, gaiji = true })
                    count = count + 1
                end
                walk(child, child_path, child_skip)
            end
        end
    end
    -- The HTML is the DocFragment element itself: its children are below `base`.
    local fragment = root.children[1]
    for _, child in ipairs(root.children) do
        if child.name then fragment = child break end
    end
    if fragment and fragment.name then walk(fragment, base, false) end
    return { nodes = nodes, segments = segments, total = count, base = base }
end

--- Characters before an xpointer inside the fragment `index` covers, or nil when the path isn't in it.
function M.count_at(index, xp)
    local path, offset = xp:match("^(.-)%.(%d+)$")
    if not path then path, offset = xp, "0" end
    -- An unknown step (crengine's DOM changed under us): the nearest known ancestor.
    while path ~= "" and not index.nodes[path] do
        path = path:match("^(.*)/[^/]*$") or ""
        offset = "0"
    end
    local node = index.nodes[path]
    if not node then return nil end
    if node.text and node.counted then return node.start + count_prefix(node.text, tonumber(offset)) end
    return node.start
end

--- The xpointer just before counted character number `count + 1` of the fragment, or nil when the
--- fragment has `count` characters or fewer.
function M.xpointer_for(index, count)
    local segments = index.segments
    local lo, hi = 1, #segments
    while lo <= hi do
        local mid = math.floor((lo + hi) / 2)
        local s = segments[mid]
        if count < s.start then
            hi = mid - 1
        elseif count >= s.start + s.count then
            lo = mid + 1
        else
            if s.gaiji then return s.path .. ".0" end
            return s.path .. "." .. offset_of_counted(s.text, count - s.start + 1)
        end
    end
    return nil
end

--- DocFragment number of an xpointer (1 when the book has a single fragment: no index).
function M.fragment_of(xp)
    if not xp then return nil end
    local n = xp:match("^/body/DocFragment%[(%d+)%]")
    if n then return tonumber(n) end
    if xp:match("^/body/DocFragment[/.]") then return 1 end
    return nil
end

--- The path of DocFragment n in a book with `total` fragments.
function M.fragment_path(n, total)
    return total > 1 and "/body/DocFragment[" .. n .. "]" or "/body/DocFragment"
end

return M
