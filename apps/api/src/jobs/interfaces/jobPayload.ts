// Only the id: the processor reads the current lead from the database, so the job never carries
// personal data into Redis or Bull Board.
export interface NewLeadPayload {
  leadId: string;
}
