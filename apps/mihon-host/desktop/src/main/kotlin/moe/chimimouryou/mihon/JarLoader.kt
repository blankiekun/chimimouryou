/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package moe.chimimouryou.mihon

import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import java.io.File
import java.net.URLClassLoader
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/** The manifest fields Mihon's ExtensionLoader reads: package, versionName and meta-data. */
data class Manifest(val packageName: String, val versionName: String, val meta: Map<String, String>)

/** keiyoushi's .jar builds carry a plain-text manifest; apks carry the binary (AXML) one. */
fun parseManifest(bytes: ByteArray): Manifest =
    if (bytes.size >= 2 && bytes[0].toInt() == 0x03 && bytes[1].toInt() == 0x00) parseBinaryManifest(bytes) else parseTextManifest(bytes)

private fun parseTextManifest(bytes: ByteArray): Manifest {
    val factory = DocumentBuilderFactory.newInstance().apply {
        // No DTDs or external entities: the jar is downloaded.
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        isExpandEntityReferences = false
    }
    val root = try {
        factory.newDocumentBuilder().parse(bytes.inputStream()).documentElement
    } catch (e: Exception) {
        throw HostError("Damaged manifest")
    }
    if (root.tagName != "manifest") throw HostError("Damaged manifest")
    val metaTags = root.getElementsByTagName("meta-data")
    val meta = (0 until metaTags.length).associate {
        val tag = metaTags.item(it) as Element
        tag.getAttribute("android:name") to tag.getAttribute("android:value")
    }
    return Manifest(root.getAttribute("package"), root.getAttribute("android:versionName"), meta)
}

/**
 * Reads a binary AndroidManifest.xml (AXML): the string pool, then each start tag's attributes.
 * Only what the loader needs; attribute names come from the pool ("name", "value", "package").
 */
private fun parseBinaryManifest(bytes: ByteArray): Manifest {
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    var strings = emptyList<String>()
    var pkg = ""
    var versionName = ""
    val meta = mutableMapOf<String, String>()
    var at = buf.getShort(2).toInt()
    while (at + 8 <= bytes.size) {
        val type = buf.getShort(at).toInt() and 0xffff
        val headerSize = buf.getShort(at + 2).toInt() and 0xffff
        val size = buf.getInt(at + 4)
        require(size >= 8 && at + size <= bytes.size) { "Damaged manifest" }
        when (type) {
            0x0001 -> strings = stringPool(buf, at)
            0x0102 -> {
                val tag = strings.getOrNull(buf.getInt(at + 20))
                val attrStart = buf.getShort(at + 24).toInt() and 0xffff
                val attrSize = buf.getShort(at + 26).toInt() and 0xffff
                val count = buf.getShort(at + 28).toInt() and 0xffff
                val attrs = mutableMapOf<String, String>()
                for (i in 0 until count) {
                    val a = at + 16 + attrStart + i * attrSize
                    val name = strings.getOrNull(buf.getInt(a + 4)) ?: continue
                    val raw = buf.getInt(a + 8)
                    val dataType = buf.get(a + 15).toInt() and 0xff
                    val data = buf.getInt(a + 16)
                    attrs[name] = when {
                        raw != -1 -> strings.getOrNull(raw) ?: ""
                        dataType == 0x03 -> strings.getOrNull(data) ?: ""
                        dataType == 0x12 -> (data != 0).toString()
                        else -> data.toString()
                    }
                }
                when (tag) {
                    "manifest" -> {
                        pkg = attrs["package"] ?: ""
                        versionName = attrs["versionName"] ?: ""
                    }
                    "meta-data" -> attrs["name"]?.let { meta[it] = attrs["value"] ?: "" }
                }
            }
        }
        at += if (type == 0x0001 || type == 0x0102 || type == 0x0103 || type == 0x0100 || type == 0x0101 || type == 0x0104 || type == 0x0180) size else maxOf(size, headerSize)
    }
    return Manifest(pkg, versionName, meta)
}

private fun stringPool(buf: ByteBuffer, at: Int): List<String> {
    val count = buf.getInt(at + 8)
    val utf8 = buf.getInt(at + 16) and 0x100 != 0
    val start = at + buf.getInt(at + 20)
    return List(count) { i ->
        var p = start + buf.getInt(at + (buf.getShort(at + 2).toInt() and 0xffff) + i * 4)
        if (utf8) {
            // UTF-16 length (skipped), then the byte length, each one or two bytes.
            p += if (buf.get(p).toInt() and 0x80 != 0) 2 else 1
            var len = buf.get(p).toInt() and 0xff
            if (len and 0x80 != 0) {
                len = ((len and 0x7f) shl 8) or (buf.get(p + 1).toInt() and 0xff)
                p += 1
            }
            p += 1
            String(ByteArray(len) { buf.get(p + it) }, Charsets.UTF_8)
        } else {
            var len = buf.getShort(p).toInt() and 0xffff
            if (len and 0x8000 != 0) {
                len = ((len and 0x7fff) shl 16) or (buf.getShort(p + 2).toInt() and 0xffff)
                p += 2
            }
            p += 2
            String(CharArray(len) { buf.getChar(p + it * 2) })
        }
    }
}

/**
 * Child-first like Mihon's DelegateLastClassLoader, except the API extensions share with the
 * host (Kotlin, OkHttp, Android stand-ins, source-api…), which always comes from the host first.
 */
private class ExtensionClassLoader(jar: File, parent: ClassLoader) : URLClassLoader(arrayOf(jar.toURI().toURL()), parent) {
    override fun loadClass(name: String, resolve: Boolean): Class<*> = synchronized(getClassLoadingLock(name)) {
        findLoadedClass(name) ?: run {
            val shared = SHARED.any { name.startsWith(it) }
            if (shared) {
                runCatching { parent.loadClass(name) }.getOrNull() ?: findClass(name)
            } else {
                runCatching { findClass(name) }.getOrNull() ?: parent.loadClass(name)
            }
        }
    }

    companion object {
        val SHARED = listOf(
            "java.", "javax.", "kotlin.", "kotlinx.", "android.", "androidx.", "eu.kanade.tachiyomi.",
            "okhttp3.", "okio.", "org.jsoup.", "uy.kohesive.", "rx.",
        )
    }
}

private val LIBS = setOf("1.4", "1.5", "1.6")
private val loaded = ConcurrentHashMap<String, List<Source>>()

/** The sources of an extension jar, as Mihon's ExtensionLoader makes them (once per jar file). */
fun loadJar(path: String): List<Source> = loaded.getOrPut(path) {
    val jar = File(path)
    val manifest = ZipFile(jar).use { zip ->
        val entry = zip.getEntry("AndroidManifest.xml") ?: throw HostError("Not an extension jar")
        parseManifest(zip.getInputStream(entry).readBytes())
    }
    val lib = manifest.meta["tachiyomix.extensionLib"]?.takeUnless { it == "0" }
        ?: manifest.versionName.substringBeforeLast('.')
    if (lib !in LIBS) throw HostError("Made for extensions-lib $lib; this host runs ${LIBS.joinToString()}")
    val names = manifest.meta["tachiyomi.extension.class"]?.split(';')?.map { it.trim() }?.filter { it.isNotEmpty() }
        ?: throw HostError("The jar names no source class")
    val loader = ExtensionClassLoader(jar, Host::class.java.classLoader)
    names.flatMap { name ->
        val full = if (name.startsWith(".")) manifest.packageName + name else name
        when (val made = Class.forName(full, false, loader).getDeclaredConstructor().newInstance()) {
            is Source -> listOf(made)
            is SourceFactory -> made.createSources()
            else -> throw HostError("$full is not a source")
        }
    }
}
