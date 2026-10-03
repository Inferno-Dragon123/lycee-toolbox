-- Derived search metadata is independent of immutable shared deck snapshots.
CREATE TABLE toolbox_publication_compositions (
    publication_id text PRIMARY KEY REFERENCES toolbox_publications(id) ON DELETE CASCADE,
    snapshot_id text NOT NULL REFERENCES toolbox_decks(id),
    deck_type text NOT NULL CHECK (deck_type IN ('single', 'mix', 'unknown')),
    series text[] NOT NULL DEFAULT '{}',
    attribute_counts jsonb NOT NULL CHECK (jsonb_typeof(attribute_counts) = 'object'),
    attributes_complete boolean NOT NULL DEFAULT true,
    origin text NOT NULL CHECK (origin IN ('catalog', 'official')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX toolbox_publication_compositions_type ON toolbox_publication_compositions (deck_type, publication_id);
CREATE INDEX toolbox_publication_compositions_series ON toolbox_publication_compositions USING gin (series);
