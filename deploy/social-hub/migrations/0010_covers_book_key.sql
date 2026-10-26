-- GET /v1/cover?key= (the Discord status) looks covers up by book alone; idempotent.
CREATE INDEX IF NOT EXISTS covers_book_key ON covers (book_key);
