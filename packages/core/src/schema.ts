// Idempotent schema, applied on every start. Append new versions at the end.
export const schemaSql = `
-- v0.1: assets + jobs
CREATE TABLE IF NOT EXISTS assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('upload', 'output')),
  storage_key text NOT NULL UNIQUE,
  mime        text NOT NULL,
  width       integer,
  height      integer,
  size_bytes  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool            text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}',
  input_asset_id  uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  output_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);
`;
