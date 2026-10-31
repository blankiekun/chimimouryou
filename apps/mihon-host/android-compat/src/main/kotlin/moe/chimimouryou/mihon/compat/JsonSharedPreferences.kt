/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package moe.chimimouryou.mihon.compat

import android.content.SharedPreferences
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File

/**
 * An extension's preferences in one JSON file, values tagged with their type
 * (`{"key": {"t": "int", "v": 3}}`) so getInt and getLong read back what was put.
 */
class JsonSharedPreferences(private val file: File) : SharedPreferences {
    private val values: MutableMap<String, Any> = load()
    private val listeners = mutableSetOf<SharedPreferences.OnSharedPreferenceChangeListener>()

    private fun load(): MutableMap<String, Any> {
        val out = mutableMapOf<String, Any>()
        val root = runCatching { Json.parseToJsonElement(file.readText()) as JsonObject }.getOrNull()
            ?: return out
        for ((key, entry) in root) {
            val tagged = entry as? JsonObject ?: continue
            val type = tagged["t"]?.jsonPrimitive?.content
            val v = tagged["v"] ?: continue
            out[key] = when (type) {
                "set" -> (v as JsonArray).map { it.jsonPrimitive.content }.toSet()
                "bool" -> v.jsonPrimitive.booleanOrNull ?: continue
                "int" -> v.jsonPrimitive.longOrNull?.toInt() ?: continue
                "long" -> v.jsonPrimitive.longOrNull ?: continue
                "float" -> v.jsonPrimitive.content.toFloatOrNull() ?: continue
                else -> v.jsonPrimitive.content
            }
        }
        return out
    }

    @Synchronized
    private fun save() {
        val root = JsonObject(
            values.mapValues { (_, v) ->
                val (t, json: JsonElement) = when (v) {
                    is Set<*> -> "set" to JsonArray(v.map { JsonPrimitive(it.toString()) })
                    is Boolean -> "bool" to JsonPrimitive(v)
                    is Int -> "int" to JsonPrimitive(v)
                    is Long -> "long" to JsonPrimitive(v)
                    is Float -> "float" to JsonPrimitive(v)
                    else -> "string" to JsonPrimitive(v.toString())
                }
                JsonObject(mapOf("t" to JsonPrimitive(t), "v" to json))
            },
        )
        file.parentFile.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(root.toString())
        tmp.renameTo(file)
    }

    private inline fun <reified T> get(key: String, default: T): T = synchronized(this) { values[key] as? T ?: default }

    override fun getAll(): Map<String, *> = synchronized(this) { values.toMap() }
    override fun getString(key: String, defValue: String?): String? = synchronized(this) { values[key] as? String ?: defValue }

    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? =
        synchronized(this) { values[key] as? Set<String> ?: defValues }
    override fun getInt(key: String, defValue: Int): Int = get(key, defValue)
    override fun getLong(key: String, defValue: Long): Long = get(key, defValue)
    override fun getFloat(key: String, defValue: Float): Float = get(key, defValue)
    override fun getBoolean(key: String, defValue: Boolean): Boolean = get(key, defValue)
    override fun contains(key: String): Boolean = synchronized(this) { key in values }
    override fun edit(): SharedPreferences.Editor = Editor()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        synchronized(this) { listeners += listener }
    }

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        synchronized(this) { listeners -= listener }
    }

    private inner class Editor : SharedPreferences.Editor {
        private val puts = mutableMapOf<String, Any?>()
        private var clear = false

        override fun putString(key: String, value: String?) = apply { puts[key] = value }
        override fun putStringSet(key: String, values: Set<String>?) = apply { puts[key] = values?.toSet() }
        override fun putInt(key: String, value: Int) = apply { puts[key] = value }
        override fun putLong(key: String, value: Long) = apply { puts[key] = value }
        override fun putFloat(key: String, value: Float) = apply { puts[key] = value }
        override fun putBoolean(key: String, value: Boolean) = apply { puts[key] = value }
        override fun remove(key: String) = apply { puts[key] = null }
        override fun clear() = apply { clear = true }

        override fun commit(): Boolean {
            val changed: List<String>
            val notify: List<SharedPreferences.OnSharedPreferenceChangeListener>
            synchronized(this@JsonSharedPreferences) {
                if (clear) values.clear()
                for ((k, v) in puts) if (v == null) values.remove(k) else values[k] = v
                changed = puts.keys.toList()
                notify = listeners.toList()
                save()
            }
            for (key in changed) notify.forEach { it.onSharedPreferenceChanged(this@JsonSharedPreferences, key) }
            return true
        }

        override fun apply() {
            commit()
        }
    }
}
