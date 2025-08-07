import React, { useRef, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import type { NavigationContainerRef, NavigationContainerProps } from '@react-navigation/native';
import { EdgeTelemetry } from '../../EdgeTelemetry';

/**
 * NavigationContainerWrapper - React component wrapper for easier React Navigation integration
 * Automatically initializes navigation tracking when used
 */
interface NavigationContainerWrapperProps extends NavigationContainerProps {
  children: React.ReactNode;
  enableTracking?: boolean;
}

export const NavigationContainerWrapper: React.FC<NavigationContainerWrapperProps> = ({
  children,
  enableTracking = true,
  ...props
}) => {
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  useEffect(() => {
    if (enableTracking && navigationRef.current) {
      // Initialize navigation tracking with EdgeTelemetry
      const edgeTelemetry = EdgeTelemetry.getInstance();
      
      // Check if EdgeTelemetry has navigation tracking capability
      if (typeof (edgeTelemetry as any).initializeNavigationTracking === 'function') {
        (edgeTelemetry as any).initializeNavigationTracking(navigationRef.current);
      } else {
        console.warn('NavigationContainerWrapper: EdgeTelemetry navigation tracking not available. Make sure EdgeTelemetry is initialized with enableNavigationTracking: true');
      }
    }
  }, [enableTracking]);

  return (
    <NavigationContainer
      ref={navigationRef}
      {...props}
    >
      {children}
    </NavigationContainer>
  );
};

/**
 * Hook to get navigation tracking status
 */
export const useNavigationTracking = () => {
  const edgeTelemetry = EdgeTelemetry.getInstance();
  
  return {
    isTrackingEnabled: typeof (edgeTelemetry as any).getNavigationTrackingStatus === 'function' 
      ? (edgeTelemetry as any).getNavigationTrackingStatus()?.enabled || false
      : false,
    getCurrentScreen: typeof (edgeTelemetry as any).getCurrentScreen === 'function'
      ? () => (edgeTelemetry as any).getCurrentScreen()
      : () => null,
    getScreenDurationStats: typeof (edgeTelemetry as any).getScreenDurationStats === 'function'
      ? () => (edgeTelemetry as any).getScreenDurationStats()
      : () => ({}),
    trackManualNavigation: typeof (edgeTelemetry as any).trackManualNavigation === 'function'
      ? (options: any) => (edgeTelemetry as any).trackManualNavigation(options)
      : () => console.warn('Manual navigation tracking not available')
  };
};
