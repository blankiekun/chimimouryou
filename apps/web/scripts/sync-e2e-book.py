import sys, zipfile
out, title = sys.argv[1], sys.argv[2]
body = ''.join(f'<p>吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。{i}番目の段落です。</p>' for i in range(600))
with zipfile.ZipFile(out, 'w') as z:
    z.writestr('mimetype', 'application/epub+zip', zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr('OEBPS/content.opf', f'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>{title}</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>')
    z.writestr('OEBPS/c.xhtml', f'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title></head><body>{body}</body></html>')
