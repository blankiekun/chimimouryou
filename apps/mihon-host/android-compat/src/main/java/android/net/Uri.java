/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package android.net;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** A parsed address over java.net.URI: what extensions read from links. */
public final class Uri {
    private final String text;
    private final URI uri;

    private Uri(String text) {
        this.text = text;
        URI parsed;
        try {
            parsed = new URI(text);
        } catch (Exception e) {
            parsed = null;
        }
        this.uri = parsed;
    }

    public static Uri parse(String text) { return new Uri(text); }

    public String getScheme() { return uri == null ? null : uri.getScheme(); }

    public String getHost() { return uri == null ? null : uri.getHost(); }

    public String getPath() { return uri == null ? null : uri.getPath(); }

    public String getQuery() { return uri == null ? null : uri.getQuery(); }

    public String getFragment() { return uri == null ? null : uri.getFragment(); }

    public java.util.List<String> getPathSegments() {
        String path = getPath();
        java.util.List<String> out = new java.util.ArrayList<>();
        if (path != null) for (String s : path.split("/")) if (!s.isEmpty()) out.add(s);
        return out;
    }

    public String getLastPathSegment() {
        java.util.List<String> segments = getPathSegments();
        return segments.isEmpty() ? null : segments.get(segments.size() - 1);
    }

    public String getQueryParameter(String key) {
        String query = uri == null ? null : uri.getRawQuery();
        if (query == null) return null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String name = URLDecoder.decode(eq < 0 ? pair : pair.substring(0, eq), StandardCharsets.UTF_8);
            if (name.equals(key)) return eq < 0 ? "" : URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
        }
        return null;
    }

    @Override
    public String toString() { return text; }

    @Override
    public boolean equals(Object o) { return o instanceof Uri && ((Uri) o).text.equals(text); }

    @Override
    public int hashCode() { return text.hashCode(); }
}
