/**
 * UserProfile model - Must match Flutter SDK exactly
 * Represents user information and attributes
 */
export interface UserProfile {
  /** Unique user identifier */
  userId: string;
  
  /** User's email address (optional) */
  email?: string;
  
  /** User's display name (optional) */
  name?: string;
  
  /** Additional user attributes */
  attributes: Record<string, string>;
  
  /** Timestamp when profile was created/updated */
  updatedAt: Date;
}

/**
 * User identification and session context
 */
export interface UserContext {
  /** Current user ID */
  userId?: string;
  
  /** Current user profile */
  profile?: UserProfile;
  
  /** User session attributes */
  sessionAttributes: Record<string, string>;
}
