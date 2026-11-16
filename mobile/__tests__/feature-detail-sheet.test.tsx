import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeatureDetailSheet } from '@/components/feature-detail-sheet';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: jest.fn() }));

beforeEach(() => {
  jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 59, bottom: 34, left: 0, right: 0 });
});
afterEach(() => jest.restoreAllMocks());

test.each(['android', 'ios'] as const)(
  '%s keeps the header reachable as the top safe area changes',
  async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const insets = jest.mocked(useSafeAreaInsets);
    const close = jest.fn();
    const sheet = () => (
      <FeatureDetailSheet
        details={{ title: 'Spring', description: 'Historic spring.', fields: [] }}
        onClose={close}
      />
    );
    insets.mockReturnValue({ top: 52, bottom: 24, left: 0, right: 0 });
    const view = await render(sheet());
    expect(screen.getByRole('header', { name: 'Feature details' }).parent).toHaveStyle({
      paddingTop: platform === 'android' ? 72 : 20,
    });
    insets.mockReturnValue({ top: 0, bottom: 24, left: 0, right: 0 });
    await view.rerender(sheet());
    expect(screen.getByRole('header', { name: 'Feature details' }).parent).toHaveStyle({
      paddingTop: 20,
    });
    await userEvent.setup().press(screen.getByRole('button', { name: 'Close feature details' }));
    await fireEvent(screen.getByTestId('feature-detail-sheet'), 'requestClose');
    expect(close).toHaveBeenCalledTimes(2);
  },
);

test('displays readable source text and supports Done and native dismissal', async () => {
  const close = jest.fn();
  await render(
    <FeatureDetailSheet
      details={{
        title: 'Spring',
        description: 'Historic stone spring house.',
        fields: [{ label: 'Type', value: 'landmark' }],
      }}
      onClose={close}
    />,
  );
  expect(screen.getByRole('header', { name: 'Spring' })).toBeOnTheScreen();
  expect(screen.getByText('Historic stone spring house.')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Close feature details' }));
  expect(close).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByTestId('feature-detail-sheet'), 'requestClose');
  expect(close).toHaveBeenCalledTimes(2);
});
