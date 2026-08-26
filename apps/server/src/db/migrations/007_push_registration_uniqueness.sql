DELETE FROM push_registrations
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM push_registrations GROUP BY registration_token
);

CREATE UNIQUE INDEX push_registrations_token_idx
  ON push_registrations(registration_token);

CREATE INDEX push_registrations_device_id_idx
  ON push_registrations(device_id);
