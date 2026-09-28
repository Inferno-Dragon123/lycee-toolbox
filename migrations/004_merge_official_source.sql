-- Preserve publication IDs, links, content and timestamps while merging the old category.
UPDATE toolbox_publications SET source = 'official_user' WHERE source = 'official';
