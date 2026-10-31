/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package moe.chimimouryou.mihon

import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.io.File

/**
 * What Mihon's database keeps per work and chapter (title, memo, chapter number…): extensions
 * read it back later (GigaViewer's chapter `memo`), while the app only passes urls. One JSON file
 * per source under `dir`, so it outlives a host restart; the newest answer for a url wins.
 */
class Remembered(private val dir: File) {
    private val bySource = HashMap<String, MutableMap<String, JsonObject>>()

    private fun of(source: String) = bySource.getOrPut(source) {
        runCatching { Json.parseToJsonElement(file(source).readText()).jsonObject.toMutableMap() }
            .getOrNull()?.mapValuesTo(mutableMapOf()) { it.value.jsonObject } ?: mutableMapOf()
    }

    private fun file(source: String) = File(dir, "$source.json")

    @Synchronized
    fun works(source: String, works: List<SManga>) = put(source, works.associate { "w:${it.url}" to it.toJson() })

    @Synchronized
    fun chapters(source: String, chapters: List<SChapter>) = put(source, chapters.associate { "c:${it.url}" to it.toJson() })

    @Synchronized
    fun work(source: String, url: String): SManga = SManga.create().also { manga ->
        manga.url = url
        manga.title = ""
        val saved = of(source)["w:$url"] ?: return@also
        saved.text("title")?.let { manga.title = it }
        manga.thumbnail_url = saved.text("thumbnail_url")
        manga.artist = saved.text("artist")
        manga.author = saved.text("author")
        manga.description = saved.text("description")
        manga.genre = saved.text("genre")
        saved["status"]?.jsonPrimitive?.int?.let { manga.status = it }
        saved["initialized"]?.jsonPrimitive?.boolean?.let { manga.initialized = it }
        saved["memo"]?.let { manga.memo = it.jsonObject }
    }

    @Synchronized
    fun chapter(source: String, url: String): SChapter = SChapter.create().also { chapter ->
        chapter.url = url
        chapter.name = ""
        val saved = of(source)["c:$url"] ?: return@also
        saved.text("name")?.let { chapter.name = it }
        saved["chapter_number"]?.jsonPrimitive?.float?.let { chapter.chapter_number = it }
        chapter.scanlator = saved.text("scanlator")
        saved["date_upload"]?.jsonPrimitive?.long?.let { chapter.date_upload = it }
        saved["memo"]?.let { chapter.memo = it.jsonObject }
    }

    private fun put(source: String, entries: Map<String, JsonObject>) {
        if (entries.isEmpty()) return
        val all = of(source)
        all.putAll(entries)
        dir.mkdirs()
        val next = File(dir, "$source.json.tmp")
        next.writeText(JsonObject(all).toString())
        next.renameTo(file(source))
    }
}

private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content

private fun SManga.toJson() = buildJsonObject {
    put("title", runCatching { title }.getOrNull())
    put("thumbnail_url", thumbnail_url)
    put("artist", artist)
    put("author", author)
    put("description", description)
    put("genre", genre)
    put("status", status)
    put("initialized", initialized)
    put("memo", memo)
}

private fun SChapter.toJson() = buildJsonObject {
    put("name", runCatching { name }.getOrNull())
    put("chapter_number", chapter_number)
    put("scanlator", scanlator)
    put("date_upload", date_upload)
    put("memo", memo)
}
