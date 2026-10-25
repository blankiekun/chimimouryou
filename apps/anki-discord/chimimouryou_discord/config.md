**port**: the port the companion listens on, on 127.0.0.1 only (default 41918). If you change it, change it in chimimouryou's Discord plugin settings too.

**extraOrigins**: the addresses of your own chimimouryou servers, which may set your Discord status, for example `["https://books.example.net"]`. The GitHub Pages site (`https://chimireader.github.io`) and the desktop app (`http://127.0.0.1:41917`) are always allowed. Write each one as the browser shows it in the address bar: scheme, host and port, no path.

Restart Anki (or switch profiles) after changing these.

**hub**: the social hub that pairing codes and the relay use (default `https://chimi-hub.blankiekun.workers.dev`). Change it only if you run your own hub; it must be `https://`. Automatic pairing from chimimouryou stores the hub it names.
