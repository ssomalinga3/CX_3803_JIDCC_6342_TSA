import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { FeatureDetailSheet } from '@/components/feature-detail-sheet';

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
