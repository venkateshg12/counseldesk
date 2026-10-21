// Only the id: the processor reads the current lead from the database, so the job never carries
// personal data into Redis or Bull Board.
export interface NewLeadPayload {
  leadId: string;
}

// The reset link itself is never queued: the processor derives it from these two values and the
// user's current password hash, so a read of Redis or Bull Board yields no usable credential.
export interface PasswordResetPayload {
  userId: string;
  issuedAt: number;
}
