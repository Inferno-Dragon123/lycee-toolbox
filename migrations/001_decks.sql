CREATE TABLE toolbox_decks (
    id text PRIMARY KEY CHECK (id ~ '^d_[A-Za-z0-9_-]{22}$'),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    cards jsonb NOT NULL CHECK (jsonb_typeof(cards) = 'object' AND octet_length(cards::text) <= 16384),
    content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
