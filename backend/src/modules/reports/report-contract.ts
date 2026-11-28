/** Network-only types. This module must remain independent of Node, database and image runtimes. */
export type CustomReportMetadata = {
  client_submission_id: string;
  category_id: string;
  captured_at: string;
  location: { type: 'Point'; coordinates: [number, number] } | null;
  location_unavailable_reason?: 'permission_denied' | 'unavailable' | 'not_shared';
  delivery_mode: 'custom';
  custom_recipients: string[];
  note?: string;
};
