/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package moe.chimimouryou.mihon

import android.app.Application
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.protobuf.ProtoBuf
import okhttp3.Response
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.addSingleton
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** A request the host refuses (unknown source, bad op): its message goes back as the error. */
class HostError(message: String) : Exception(message)

/**
 * The protocol both hosts answer, one JSON object per request (`op` + fields) and one result:
 * `load {jar}` → sources; `popular|latest {source, page}`, `search {source, page, query}` →
 * `{list: [{name, link, imageUrl}], hasNextPage}`; `detail {source, url}` → details and chapters
 * (newest first, as Mihon lists them); `pages {source, url}` and `image {source, url}` → image
 * files `{path, type}` under `tmp`, which the caller reads and deletes. Shapes follow
 * extension-runtime.ts (ExtensionList, ExtensionDetail), statuses mapped to Mangayomi's.
 */
class Host(
    app: Application,
    private val network: NetworkHelper,
    private val tmp: File,
    private val loadJar: (path: String) -> List<Source>,
) {
    private val sources = ConcurrentHashMap<String, Source>()

    init {
        Injekt.addSingleton(app)
        Injekt.addSingleton<android.content.Context>(app)
        Injekt.addSingleton(network)
        Injekt.addSingleton(Json { ignoreUnknownKeys = true; explicitNulls = false })
        Injekt.addSingleton(ProtoBuf)
        tmp.mkdirs()
    }

    private fun source(params: JsonObject): CatalogueSource {
        val id = params.text("source")
        return sources[id] as? CatalogueSource ?: throw HostError("Source $id isn't loaded")
    }

    suspend fun handle(op: String, params: JsonObject): JsonElement = when (op) {
        "ping" -> buildJsonObject { put("ok", true) }
        "load" -> load(params.text("jar"))
        "popular" -> list(source(params).getPopularManga(params.page()))
        "latest" -> list(source(params).getLatestUpdates(params.page()))
        "search" -> {
            val source = source(params)
            list(source.getSearchManga(params.page(), params.text("query"), source.getFilterList()))
        }
        "detail" -> detail(source(params), params.text("url"))
        "pages" -> pages(source(params), params.text("url"))
        "image" -> image(source(params), params.text("url"))
        else -> throw HostError("Unknown op $op")
    }

    private fun load(jar: String) = buildJsonObject {
        val loaded = loadJar(jar)
        put(
            "sources",
            buildJsonArray {
                for (source in loaded) {
                    // 64-bit ids as decimal strings: JavaScript numbers lose them past 2^53.
                    val id = source.id.toString()
                    sources[id] = source
                    add(
                        buildJsonObject {
                            put("id", id)
                            put("name", source.name)
                            put("lang", source.lang)
                            put("baseUrl", (source as? HttpSource)?.baseUrl ?: "")
                            put("supportsLatest", (source as? CatalogueSource)?.supportsLatest ?: false)
                        },
                    )
                }
            },
        )
    }

    private fun list(page: MangasPage) = buildJsonObject {
        put(
            "list",
            buildJsonArray {
                for (manga in page.mangas) {
                    add(
                        buildJsonObject {
                            put("name", manga.title)
                            put("link", manga.url)
                            put("imageUrl", manga.thumbnail_url ?: "")
                        },
                    )
                }
            },
        )
        put("hasNextPage", page.hasNextPage)
    }

    private suspend fun detail(source: CatalogueSource, url: String): JsonElement {
        val asked = SManga.create().apply { this.url = url }
        val update = source.getMangaUpdate(asked, emptyList(), fetchDetails = true, fetchChapters = true)
        val manga = update.manga
        return buildJsonObject {
            put("name", manga.title.ifEmpty { url })
            put("imageUrl", manga.thumbnail_url ?: "")
            put("description", manga.description ?: "")
            put("author", manga.author ?: "")
            put("artist", manga.artist ?: "")
            put("status", STATUS[manga.status] ?: 5)
            put("genre", buildJsonArray { manga.getGenres().orEmpty().forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
            put(
                "chapters",
                buildJsonArray {
                    for (chapter in update.chapters) {
                        add(
                            buildJsonObject {
                                put("name", chapter.name)
                                put("url", chapter.url)
                                put("dateUpload", if (chapter.date_upload > 0) chapter.date_upload.toString() else "")
                                put("scanlator", chapter.scanlator ?: "")
                            },
                        )
                    }
                },
            )
        }
    }

    private suspend fun pages(source: CatalogueSource, url: String): JsonElement {
        val http = source as? HttpSource ?: throw HostError("${source.name} has no pages to fetch")
        val pages = http.getPageList(SChapter.create().apply { this.url = url })
        // shortcut: one page at a time; extensions pace themselves with their rate limiters.
        return buildJsonObject {
            put(
                "files",
                buildJsonArray {
                    for (page in pages) {
                        if (page.imageUrl.isNullOrEmpty()) page.imageUrl = http.getImageUrl(page)
                        add(save(http.getImage(page)))
                    }
                },
            )
        }
    }

    private suspend fun image(source: CatalogueSource, url: String): JsonElement {
        val http = source as? HttpSource ?: throw HostError("${source.name} has no images")
        return save(http.client.newCall(GET(url, http.headers)).awaitSuccess())
    }

    /** The answer's body as a file the caller takes over; only images count. */
    private fun save(response: Response) = response.use {
        val type = it.body.contentType()?.toString() ?: ""
        val file = File.createTempFile("img", ".bin", tmp)
        file.outputStream().use { out -> it.body.byteStream().copyTo(out) }
        buildJsonObject {
            put("path", file.path)
            put("type", type)
        }
    }

    companion object {
        /** Mihon's SManga statuses → Mangayomi's (0 ongoing, 1 completed, 2 hiatus, 3 cancelled, 4 publishing finished, 5 unknown). */
        private val STATUS = mapOf(
            SManga.ONGOING to 0,
            SManga.COMPLETED to 1,
            SManga.ON_HIATUS to 2,
            SManga.CANCELLED to 3,
            SManga.PUBLISHING_FINISHED to 4,
            SManga.LICENSED to 1,
            SManga.UNKNOWN to 5,
        )
    }
}

private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.content ?: throw HostError("Missing $key")

private fun JsonObject.page() = this["page"]?.jsonPrimitive?.int ?: 1
