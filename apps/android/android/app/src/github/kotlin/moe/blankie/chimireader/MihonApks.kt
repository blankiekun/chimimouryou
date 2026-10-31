package moe.blankie.chimireader

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import dalvik.system.PathClassLoader
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import moe.chimimouryou.mihon.HostError
import okhttp3.OkHttpClient
import java.io.File
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.util.Collections
import java.util.Enumeration
import java.util.concurrent.ConcurrentHashMap

/**
 * Mihon extension apks kept as Mihon keeps private ones (its ExtensionLoader, Apache-2.0, see
 * NOTICE): `filesDir/exts/<sha256>.ext`, read-only (Android 14+ won't load writable dex), read by
 * PackageManager, classes loaded child-first. Install trusts an apk only when one of its signing
 * certificates has the repository's `signingKey` as SHA-256, and pins it by the apk's own SHA-256,
 * checked again before every load.
 */
internal object MihonApks {
    private const val FEATURE = "tachiyomi.extension"
    private val LIBS = setOf("1.4", "1.5", "1.6")
    private const val MAX_APK = 20L * 1024 * 1024
    private val PIN = Regex("^[0-9a-f]{64}$")

    @Suppress("DEPRECATION")
    private val FLAGS = PackageManager.GET_CONFIGURATIONS or PackageManager.GET_META_DATA or
        PackageManager.GET_SIGNATURES or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else 0)

    private val loaded = ConcurrentHashMap<String, List<Source>>()

    private fun dir(context: Context) = File(context.filesDir, "exts")

    private fun sha256(bytes: ByteArray) =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun info(context: Context, file: File): PackageInfo =
        context.packageManager.getPackageArchiveInfo(file.path, FLAGS)
            ?.takeIf { pkg -> pkg.reqFeatures.orEmpty().any { it.name == FEATURE } }
            ?.also { pkg ->
                // Android 13+ leaves these unset for an archive; the class loader needs them.
                pkg.applicationInfo?.apply {
                    if (sourceDir == null) sourceDir = file.path
                    if (publicSourceDir == null) publicSourceDir = file.path
                }
            }
            ?: throw HostError("Not a Mihon extension")

    /** SHA-256 (hex) of each signing certificate, as a repository's `signingKey` names one. */
    private fun signers(pkg: PackageInfo): List<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkg.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }
        } else {
            @Suppress("DEPRECATION")
            pkg.signatures
        }
        return signatures.orEmpty().map { sha256(it.toByteArray()) }
    }

    /** Downloads the apk (https, through the host's guarded client), checks its signer, pins it: its SHA-256. */
    fun install(context: Context, client: OkHttpClient, url: String, signingKey: String): String {
        if (!url.startsWith("https://")) throw HostError("Only https addresses")
        if (signingKey.isBlank()) throw HostError("The repository names no signing key, so its extensions can’t be trusted")
        val body = client.newCall(GET(url)).execute().use { response ->
            if (!response.isSuccessful) throw HostError("HTTP ${response.code}")
            val source = response.body.source()
            if (source.request(MAX_APK + 1)) throw HostError("Too big")
            source.buffer.readByteArray()
        }
        val pin = sha256(body)
        val dir = dir(context).apply { mkdirs() }
        val part = File(dir, "$pin.part")
        try {
            part.writeBytes(body)
            val pkg = info(context, part)
            if (signingKey.lowercase() !in signers(pkg)) {
                throw HostError("${pkg.packageName} isn’t signed with its repository’s key")
            }
            part.setReadOnly()
            if (!part.renameTo(File(dir, "$pin.ext"))) throw IOException("Could not keep the extension")
        } finally {
            part.delete()
        }
        return pin
    }

    /** The pinned apk's path, after checking it still matches its pin. */
    fun open(context: Context, pin: String): String {
        if (!PIN.matches(pin)) throw HostError("Not a pin")
        val file = File(dir(context), "$pin.ext")
        if (!file.isFile || sha256(file.readBytes()) != pin) {
            throw HostError("This extension’s stored code is damaged: tap Update in its repository")
        }
        return file.path
    }

    /** The apk's sources, as Mihon's ExtensionLoader makes them (once per file). */
    fun load(context: Context, path: String): List<Source> = loaded.getOrPut(path) {
        val file = File(path)
        if (file.canWrite()) file.setReadOnly()
        val pkg = info(context, file)
        val meta = pkg.applicationInfo?.metaData ?: throw HostError("Damaged extension")
        val lib = meta.getFloat("tachiyomix.extensionLib").takeUnless { it == 0f }?.toString()
            ?: pkg.versionName.orEmpty().substringBeforeLast('.')
        if (lib !in LIBS) throw HostError("Made for extensions-lib $lib; this host runs ${LIBS.joinToString()}")
        val names = meta.getString("tachiyomi.extension.class")?.split(';')?.map { it.trim() }?.filter { it.isNotEmpty() }
            ?: throw HostError("The extension names no source class")
        val loader = DelegateLastPathClassLoader(path, context.classLoader)
        names.flatMap { name ->
            val full = if (name.startsWith(".")) pkg.packageName + name else name
            when (val made = Class.forName(full, false, loader).getDeclaredConstructor().newInstance()) {
                is Source -> listOf(made)
                is SourceFactory -> made.createSources()
                else -> throw HostError("$full is not a source")
            }
        }
    }
}

/**
 * Mihon's DelegateLastClassLoaderCompat backport: the boot class loader first, then the apk, then
 * the app (Kotlin, OkHttp, source-api…). Mihon switches to the platform's DelegateLastClassLoader
 * from Android 17 so ART can map app images; this one runs on every version (minSdk 24).
 */
private class DelegateLastPathClassLoader(dexPath: String, parent: ClassLoader) : PathClassLoader(dexPath, null, parent) {
    private val boot: ClassLoader? = Any::class.java.classLoader

    override fun loadClass(name: String?, resolve: Boolean): Class<*> {
        findLoadedClass(name)?.let { return it }
        if (boot != null) {
            try {
                return boot.loadClass(name)
            } catch (_: ClassNotFoundException) {
            }
        }
        val own = try {
            return findClass(name)
        } catch (e: ClassNotFoundException) {
            e
        }
        return try {
            parent.loadClass(name)
        } catch (_: ClassNotFoundException) {
            throw own
        }
    }

    override fun getResource(name: String?): URL? =
        boot?.getResource(name) ?: findResource(name) ?: parent?.getResource(name)

    override fun getResources(name: String?): Enumeration<URL> = Collections.enumeration(
        buildList {
            boot?.getResources(name)?.let { addAll(it.toList()) }
            findResources(name)?.let { addAll(it.toList()) }
            parent?.getResources(name)?.let { addAll(it.toList()) }
        },
    )
}
