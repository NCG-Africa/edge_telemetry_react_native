import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TelemetrySession, SessionMetrics } from '../core/models/TelemetrySession';
import { UserIdManager } from './UserIdManager';

/**
 * SessionManager - Manages telemetry sessions
 * Must match Flutter SDK session handling exactly
 */
export class SessionManager {
  private static readonly SESSION_KEY = 'edge_telemetry_current_session';
  private static readonly SESSION_METRICS_KEY = 'edge_telemetry_session_metrics';
  private static instance: SessionManager;
  
  private currentSession?: TelemetrySession;
  private sessionMetrics: SessionMetrics = {
    eventCount: 0,
    screenCount: 0,
    errorCount: 0,
    networkRequestCount: 0,
  };
  
  private userIdManager: UserIdManager;

  private constructor() {
    this.userIdManager = UserIdManager.getInstance();
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Start a new telemetry session
   * Generates session ID and collects initial context
   */
  async startSession(deviceAttributes: Record<string, string>, appAttributes: Record<string, string>): Promise<string> {
    const sessionId = this.generateSessionId();
    const userId = await this.userIdManager.getUserId();
    
    this.currentSession = {
      sessionId,
      startTime: new Date(),
      userId,
      deviceAttributes,
      appAttributes,
    };

    // Reset session metrics
    this.sessionMetrics = {
      eventCount: 0,
      screenCount: 0,
      errorCount: 0,
      networkRequestCount: 0,
    };

    // Persist session to storage
    try {
      await AsyncStorage.setItem(SessionManager.SESSION_KEY, JSON.stringify(this.currentSession));
      await AsyncStorage.setItem(SessionManager.SESSION_METRICS_KEY, JSON.stringify(this.sessionMetrics));
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to persist session to storage:', error);
    }

    return sessionId;
  }

  /**
   * End the current session
   */
  async endSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.endTime = new Date();
    
    // Calculate session duration
    if (this.currentSession.startTime) {
      this.sessionMetrics.duration = this.currentSession.endTime.getTime() - this.currentSession.startTime.getTime();
    }

    try {
      await AsyncStorage.setItem(SessionManager.SESSION_KEY, JSON.stringify(this.currentSession));
      await AsyncStorage.setItem(SessionManager.SESSION_METRICS_KEY, JSON.stringify(this.sessionMetrics));
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to persist session end to storage:', error);
    }
  }

  /**
   * Get the current session
   */
  getCurrentSession(): TelemetrySession | undefined {
    return this.currentSession;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | undefined {
    return this.currentSession?.sessionId;
  }

  /**
   * Record an event in the current session
   */
  recordEvent(): void {
    this.sessionMetrics.eventCount++;
    this.persistMetrics();
  }

  /**
   * Record a metric in the current session
   */
  recordMetric(): void {
    this.sessionMetrics.eventCount++; // Metrics count as events
    this.persistMetrics();
  }

  /**
   * Record a screen view in the current session
   */
  recordScreen(_screenName: string): void {
    this.sessionMetrics.screenCount++;
    this.sessionMetrics.eventCount++; // Screen views count as events
    this.persistMetrics();
  }

  /**
   * Record an error in the current session
   */
  recordError(): void {
    this.sessionMetrics.errorCount++;
    this.sessionMetrics.eventCount++; // Errors count as events
    this.persistMetrics();
  }

  /**
   * Record a network request in the current session
   */
  recordNetworkRequest(): void {
    this.sessionMetrics.networkRequestCount++;
    this.sessionMetrics.eventCount++; // Network requests count as events
    this.persistMetrics();
  }

  /**
   * Get session attributes for events
   */
  getSessionAttributes(): Record<string, string> {
    if (!this.currentSession) {
      return {};
    }

    const attributes: Record<string, string> = {
      'session.id': this.currentSession.sessionId,
      'session.start_time': this.currentSession.startTime.toISOString(),
    };

    if (this.currentSession.userId) {
      attributes['user.id'] = this.currentSession.userId;
    }

    if (this.currentSession.endTime) {
      attributes['session.end_time'] = this.currentSession.endTime.toISOString();
      attributes['session.duration'] = String(this.sessionMetrics.duration || 0);
    }

    return attributes;
  }

  /**
   * Get current session info for public API
   */
  getCurrentSessionInfo(): Record<string, any> {
    if (!this.currentSession) {
      return {};
    }

    return {
      sessionId: this.currentSession.sessionId,
      startTime: this.currentSession.startTime.toISOString(),
      endTime: this.currentSession.endTime?.toISOString(),
      userId: this.currentSession.userId,
      metrics: { ...this.sessionMetrics },
      deviceAttributes: { ...this.currentSession.deviceAttributes },
      appAttributes: { ...this.currentSession.appAttributes },
    };
  }

  /**
   * Load session from storage (for app restart scenarios)
   */
  async loadSession(): Promise<void> {
    try {
      const sessionData = await AsyncStorage.getItem(SessionManager.SESSION_KEY);
      const metricsData = await AsyncStorage.getItem(SessionManager.SESSION_METRICS_KEY);
      
      if (sessionData) {
        const session = JSON.parse(sessionData);
        // Convert date strings back to Date objects
        session.startTime = new Date(session.startTime);
        if (session.endTime) {
          session.endTime = new Date(session.endTime);
        }
        this.currentSession = session;
      }
      
      if (metricsData) {
        this.sessionMetrics = JSON.parse(metricsData);
      }
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to load session from storage:', error);
    }
  }

  /**
   * Generate a session ID matching Flutter format
   * Format: session_<timestamp>_<random>
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = this.generateRandomString(8);
    
    return `session_${timestamp}_${random}`;
  }

  /**
   * Generate random alphanumeric string
   */
  private generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }

  /**
   * Persist session metrics to storage
   */
  private async persistMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(SessionManager.SESSION_METRICS_KEY, JSON.stringify(this.sessionMetrics));
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to persist session metrics:', error);
    }
  }

  /**
   * Clear session data (for testing or reset)
   */
  async clearSession(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.removeItem(SessionManager.SESSION_KEY),
        AsyncStorage.removeItem(SessionManager.SESSION_METRICS_KEY)
      ]);
      this.currentSession = undefined;
      this.sessionMetrics = {
        eventCount: 0,
        screenCount: 0,
        errorCount: 0,
        networkRequestCount: 0,
      };
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to clear session:', error);
    }
  }
}
