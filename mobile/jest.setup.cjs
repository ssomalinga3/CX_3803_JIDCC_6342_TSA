jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  const mockFocusState = { focused: true };
  return {
    mockFocusState,
    router: {
      push: jest.fn(),
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
    },
    useFocusEffect: (callback) => {
      const focused = mockFocusState.focused;
      React.useEffect(() => {
        if (focused) return callback();
      }, [callback, focused]);
    },
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mockZoomTo = jest.fn();
  const mockEaseTo = jest.fn();
  const mockGetZoom = jest.fn().mockResolvedValue(16);
  const mockFitBounds = jest.fn();
  return {
    mockZoomTo,
    mockEaseTo,
    mockGetZoom,
    mockFitBounds,
    GeoJSONSource: ({ children, ...props }) => React.createElement(View, props, children),
    ImageSource: ({ children, ...props }) => React.createElement(View, props, children),
    Layer: (props) => React.createElement(View, props),
    Map: ({ ref, ...props }) => {
      React.useImperativeHandle(ref, () => ({ getZoom: mockGetZoom }));
      return React.createElement(View, props);
    },
    Camera: ({ ref }) => {
      React.useImperativeHandle(ref, () => ({
        zoomTo: mockZoomTo,
        easeTo: mockEaseTo,
        fitBounds: mockFitBounds,
      }));
      return null;
    },
  };
});
