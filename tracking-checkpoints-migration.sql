-- Store the Easyship tracking checkpoint history on the order so the admin
-- invoice view can render the full delivery journey (stage bar + timeline +
-- map) without calling Easyship's paid Trackings API.
--
-- Populated by the `shipment.tracking.checkpoints.created` webhook
-- (app/api/webhooks/easyship/route.ts), which delivers the same checkpoints
-- shown on Easyship's own trackmyshipment.co page — message, location, time
-- and primary_status — for free on shipments created through Easyship.
--
-- Shape: jsonb array of
--   { "message": string, "occurred_at": string,
--     "location": string|null, "primary_status": string|null }

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tracking_checkpoints jsonb;
