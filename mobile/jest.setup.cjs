jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mockZoomTo = jest.fn();
  const mockEaseTo = jest.fn();
  const mockGetZoom = jest.fn().mockResolvedValue(16);
  return {
    mockZoomTo,
    mockEaseTo,
    mockGetZoom,
    GeoJSONSource: ({ children, ...props }) => React.createElement(View, props, children),
    Layer: (props) => React.createElement(View, props),
    Map: ({ ref, ...props }) => {
      React.useImperativeHandle(ref, () => ({ getZoom: mockGetZoom }));
      return React.createElement(View, props);
    },
    Camera: ({ ref }) => {
      React.useImperativeHandle(ref, () => ({
        zoomTo: mockZoomTo,
        easeTo: mockEaseTo,
        fitBounds: jest.fn(),
      }));
      return null;
    },
  };
});
