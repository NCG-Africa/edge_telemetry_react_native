/**
 * Simple test to verify EdgeTelemetry internal event routing
 * This demonstrates the new batch size configuration and internal event tracking
 */

import { EdgeTelemetry } from '../core/EdgeTelemetry';
import { startScreenTracking } from '../data/navigation/ScreenTracker';
import { interceptFetch } from '../data/network/FetchInterceptor';
import { trackError } from '../data/error/ErrorHandler';

/**
 * Test function to demonstrate the new functionality
 */
export async function testEdgeTelemetryInternalEvents() {
  console.log('🧪 Testing EdgeTelemetry Internal Event Routing...\n');

  try {
    // Test 1: Initialize with custom batch size
    console.log('1. Initializing EdgeTelemetry with custom batch size...');
    await EdgeTelemetry.init({
      appName: 'TestApp',
      exportUrl: 'https://httpbin.org/post', // Test endpoint
      debug: true,
      batchSize: 5 // Custom batch size
    });
    console.log('✅ EdgeTelemetry initialized successfully\n');

    // Test 2: Track custom user events (traditional format)
    console.log('2. Tracking custom user events...');
    EdgeTelemetry.trackEvent('user.button_click', {
      buttonId: 'test-button',
      page: 'test-page'
    });
    
    EdgeTelemetry.trackEvent('user.form_submit', {
      formId: 'contact-form',
      fields: ['name', 'email']
    });
    console.log('✅ Custom events tracked\n');

    // Test 3: Track internal screen events
    console.log('3. Tracking internal screen events...');
    EdgeTelemetry.trackEvent({
      type: 'screen.view',
      screen: 'HomeScreen',
      previousScreen: 'LoginScreen',
      timestamp: new Date().toISOString(),
      timeOnPreviousScreen: 5000,
      source: 'internal'
    });
    
    EdgeTelemetry.trackEvent({
      type: 'screen.view',
      screen: 'ProfileScreen',
      previousScreen: 'HomeScreen',
      timestamp: new Date().toISOString(),
      timeOnPreviousScreen: 3000,
      source: 'internal'
    });
    console.log('✅ Internal screen events tracked\n');

    // Test 4: Track internal network events
    console.log('4. Tracking internal network events...');
    EdgeTelemetry.trackEvent({
      type: 'network.request',
      url: 'https://api.example.com/users',
      method: 'GET',
      status: 200,
      statusText: 'OK',
      duration: 245,
      timestamp: new Date().toISOString(),
      source: 'internal'
    });
    
    EdgeTelemetry.trackEvent({
      type: 'network.request',
      url: 'https://api.example.com/posts',
      method: 'POST',
      status: 201,
      statusText: 'Created',
      duration: 380,
      timestamp: new Date().toISOString(),
      source: 'internal'
    });
    console.log('✅ Internal network events tracked\n');

    // Test 5: Track internal error events
    console.log('5. Tracking internal error events...');
    EdgeTelemetry.trackEvent({
      type: 'error.javascript',
      message: 'Cannot read property of undefined',
      filename: 'app.js',
      lineno: 42,
      colno: 15,
      stack: 'Error: Cannot read property of undefined\n    at app.js:42:15',
      timestamp: new Date().toISOString(),
      source: 'internal'
    });
    
    // Test manual error tracking
    trackError(new Error('Test manual error'), { context: 'test-function' });
    console.log('✅ Internal error events tracked\n');

    // Test 6: Verify batch export (should trigger after 5 events due to custom batch size)
    console.log('6. Adding one more event to trigger batch export...');
    EdgeTelemetry.trackEvent('user.test_complete', {
      testName: 'internal-events-test',
      eventsTracked: 8
    });
    console.log('✅ Batch export should have been triggered\n');

    console.log('🎉 All tests completed successfully!');
    console.log('Check the console logs above for "[EdgeTelemetry] Internal event captured" messages');
    console.log('and "JsonExporter: Exporting batch" messages to verify the implementation.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

/**
 * Test function to demonstrate fetch interception
 */
export async function testFetchInterception() {
  console.log('\n🌐 Testing Fetch Interception...\n');

  try {
    // Set up fetch interception
    interceptFetch();
    console.log('✅ Fetch interception enabled\n');

    // Make a test request (this will be intercepted and tracked)
    console.log('Making test HTTP request...');
    const response = await fetch('https://httpbin.org/get?test=true');
    console.log('✅ Request completed with status:', response.status);
    console.log('Check console for internal network.request event\n');

  } catch (error) {
    console.error('❌ Fetch interception test failed:', error);
  }
}

// Export test functions for manual execution
if (typeof window !== 'undefined') {
  (window as any).testEdgeTelemetryInternalEvents = testEdgeTelemetryInternalEvents;
  (window as any).testFetchInterception = testFetchInterception;
  
  console.log('🔧 Test functions available:');
  console.log('- testEdgeTelemetryInternalEvents()');
  console.log('- testFetchInterception()');
}
