CREATE TABLE toolbox_profiles (
    user_id text PRIMARY KEY,
    nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 24),
    updated_at timestamptz NOT NULL DEFAULT now()
);
