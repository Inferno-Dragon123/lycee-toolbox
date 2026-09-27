-- Publications have their own owners; shared immutable snapshots never do.
CREATE TABLE toolbox_publications (
    id text PRIMARY KEY CHECK (id ~ '^p_[A-Za-z0-9_-]{22}$'),
    snapshot_id text NOT NULL REFERENCES toolbox_decks(id),
    owner_id text,
    author_name text NOT NULL,
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    source text NOT NULL CHECK (source IN ('community', 'official_tournament', 'official_user', 'official')),
    source_key text UNIQUE,
    source_url text,
    status text NOT NULL DEFAULT 'public' CHECK (status IN ('public', 'unlisted', 'deleted')),
    moderated boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    synced_at timestamptz,
    CHECK ((source = 'community' AND owner_id IS NOT NULL AND source_key IS NULL AND source_url IS NULL)
        OR (source <> 'community' AND owner_id IS NULL AND source_key IS NOT NULL AND source_url IS NOT NULL))
);
CREATE INDEX toolbox_publications_recent ON toolbox_publications (updated_at DESC, id) WHERE status = 'public' AND NOT moderated;
CREATE INDEX toolbox_publications_owner ON toolbox_publications (owner_id, updated_at DESC);
CREATE TABLE toolbox_publication_cards (
    publication_id text NOT NULL REFERENCES toolbox_publications(id) ON DELETE CASCADE,
    base_code text NOT NULL CHECK (base_code ~ '^LO-[0-9]{4}$'),
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 200),
    PRIMARY KEY (publication_id, base_code)
);
CREATE INDEX toolbox_publication_cards_lookup ON toolbox_publication_cards (base_code, publication_id);
CREATE TABLE toolbox_community_limits (
    subject text NOT NULL,
    bucket timestamptz NOT NULL,
    count integer NOT NULL,
    PRIMARY KEY (subject, bucket)
);
CREATE TABLE toolbox_sync_state (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
