-- Disposable isolated benchmark database only; matches upstream schema owners.
CREATE ROLE zcash_user LOGIN PASSWORD 'fixture' NOSUPERUSER NOCREATEDB NOCREATEROLE;
