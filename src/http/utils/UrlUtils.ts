/**
 * URL utilities for HTTP monitoring
 * Provides URL parsing, sanitization, and validation
 */
export class UrlUtils {
  private static readonly SENSITIVE_PARAMS = [
    'password', 'token', 'key', 'secret', 'auth', 'authorization',
    'api_key', 'apikey', 'access_token', 'refresh_token', 'session',
    'sessionid', 'csrf', 'csrf_token', 'signature', 'sig'
  ];
  
  private static readonly SENSITIVE_HEADERS = [
    'authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token',
    'x-csrf-token', 'x-session-id', 'authentication', 'proxy-authorization'
  ];
  
  /**
   * Sanitize URL by removing or redacting sensitive query parameters
   */
  static sanitizeUrl(url: string, maxLength: number = 2048): string {
    try {
      const urlObj = new URL(url);
      
      // Remove sensitive query parameters
      this.SENSITIVE_PARAMS.forEach(param => {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '[REDACTED]');
        }
      });
      
      let sanitizedUrl = urlObj.toString();
      
      // Truncate if too long
      if (sanitizedUrl.length > maxLength) {
        sanitizedUrl = sanitizedUrl.substring(0, maxLength - 3) + '...';
      }
      
      return sanitizedUrl;
    } catch {
      // Invalid URL, return truncated original
      return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
    }
  }
  
  /**
   * Extract domain from URL
   */
  static extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'unknown';
    }
  }
  
  /**
   * Extract path from URL (without query parameters)
   */
  static extractPath(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch {
      return url;
    }
  }
  
  /**
   * Check if URL should be ignored based on configuration
   */
  static shouldIgnoreUrl(url: string, ignoredUrls: string[], ignoredDomains: string[]): boolean {
    const domain = this.extractDomain(url);
    
    // Check ignored domains
    if (ignoredDomains.some(ignoredDomain => domain.includes(ignoredDomain))) {
      return true;
    }
    
    // Check ignored URL patterns
    return ignoredUrls.some(ignoredUrl => {
      if (ignoredUrl.includes('*')) {
        // Simple wildcard matching
        const pattern = ignoredUrl.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(url);
      } else {
        return url.includes(ignoredUrl);
      }
    });
  }
  
  /**
   * Sanitize HTTP headers by removing or redacting sensitive ones
   */
  static sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      
      if (this.SENSITIVE_HEADERS.includes(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Validate if string is a valid URL
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Extract URL from various input types (RequestInfo | URL)
   */
  static extractUrlFromInput(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
      return input;
    } else if (input instanceof URL) {
      return input.toString();
    } else if (input instanceof Request) {
      return input.url;
    } else {
      return String(input);
    }
  }
  
  /**
   * Get protocol from URL (http/https)
   */
  static getProtocol(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol.replace(':', '');
    } catch {
      return 'unknown';
    }
  }
  
  /**
   * Check if URL is HTTPS
   */
  static isSecure(url: string): boolean {
    return this.getProtocol(url) === 'https';
  }
  
  /**
   * Get port from URL
   */
  static getPort(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');
    } catch {
      return 'unknown';
    }
  }
}
