/**
 * AttributeConverter - Must mirror Flutter's _convertToStringMap exactly
 * Handles conversion of various attribute types to string maps for telemetry
 */
export class AttributeConverter {
  /**
   * Convert various attribute types to Record<string, string>
   * Mirrors Flutter's _convertToStringMap method exactly
   */
  static convertToStringMap(attributes: any): Record<string, string> {
    if (!attributes) {
      return {};
    }

    const result: Record<string, string> = {};

    try {
      // Handle Map<String, String> (already correct format)
      if (attributes instanceof Map) {
        for (const [key, value] of attributes.entries()) {
          result[String(key)] = String(value);
        }
        return result;
      }

      // Handle objects with toJson() method (common in Flutter/Dart)
      if (typeof attributes === 'object' && typeof attributes.toJson === 'function') {
        const jsonObj = attributes.toJson();
        return this.convertToStringMap(jsonObj);
      }

      // Handle plain objects (most common case in React Native)
      if (typeof attributes === 'object' && attributes !== null) {
        for (const [key, value] of Object.entries(attributes)) {
          if (value !== null && value !== undefined) {
            result[String(key)] = this.convertValueToString(value);
          }
        }
        return result;
      }

      // Handle primitive types by converting to single-entry map
      if (typeof attributes === 'string' || typeof attributes === 'number' || typeof attributes === 'boolean') {
        result['value'] = String(attributes);
        return result;
      }

    } catch (error) {
      console.warn('EdgeTelemetry: Error converting attributes to string map:', error);
      // Return empty map on conversion error to prevent crashes
      return {};
    }

    return result;
  }

  /**
   * Convert individual values to strings, handling various types
   * Matches Flutter's value conversion logic
   */
  private static convertValueToString(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Handle arrays by joining with commas
    if (Array.isArray(value)) {
      return value.map(item => String(item)).join(',');
    }

    // Handle nested objects by JSON stringifying
    if (typeof value === 'object') {
      try {
        // Check if object has toJson method
        if (typeof value.toJson === 'function') {
          return JSON.stringify(value.toJson());
        }
        return JSON.stringify(value);
      } catch (error) {
        // Fallback to string conversion if JSON.stringify fails
        return String(value);
      }
    }

    // Handle boolean values
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    // Default string conversion
    return String(value);
  }

  /**
   * Merge multiple attribute objects into a single string map
   * Later attributes override earlier ones (same as Flutter)
   */
  static mergeAttributes(...attributeObjects: any[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (const attributes of attributeObjects) {
      const converted = this.convertToStringMap(attributes);
      Object.assign(result, converted);
    }

    return result;
  }

  /**
   * Validate that all keys and values are strings and non-empty
   * Used for final validation before sending telemetry
   */
  static validateStringMap(attributes: Record<string, string>): Record<string, string> {
    const validated: Record<string, string> = {};

    for (const [key, value] of Object.entries(attributes)) {
      // Ensure key is non-empty string
      const validKey = String(key).trim();
      if (validKey.length === 0) {
        continue;
      }

      // Ensure value is string (allow empty strings)
      const validValue = String(value);
      validated[validKey] = validValue;
    }

    return validated;
  }

  /**
   * Sanitize attribute keys to ensure they're safe for JSON serialization
   * Removes or replaces problematic characters
   */
  static sanitizeKeys(attributes: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(attributes)) {
      // Replace problematic characters in keys
      const sanitizedKey = key
        .replace(/[^\w.-]/g, '_') // Replace non-word chars except dots and dashes
        .replace(/^[^a-zA-Z_]/, '_') // Ensure key starts with letter or underscore
        .toLowerCase(); // Normalize to lowercase

      if (sanitizedKey.length > 0) {
        sanitized[sanitizedKey] = value;
      }
    }

    return sanitized;
  }

  /**
   * Add standard telemetry attributes that should be present on all events
   * Matches Flutter SDK standard attributes
   */
  static addStandardAttributes(
    attributes: Record<string, string>,
    sessionId: string,
    userId?: string,
    timestamp?: Date
  ): Record<string, string> {
    const standardAttributes: Record<string, string> = {
      ...attributes,
      'telemetry.sdk.name': 'edge-telemetry-react-native',
      'telemetry.sdk.version': '2.0.0', // Should match package.json version
      'telemetry.session.id': sessionId,
      'telemetry.timestamp': (timestamp || new Date()).toISOString(),
    };

    if (userId) {
      standardAttributes['telemetry.user.id'] = userId;
    }

    return standardAttributes;
  }
}
