import { render, screen } from '@testing-library/react-native';

import DisclaimersScreen from '@/app/disclaimers';
import { disclaimers } from '@/data/disclaimers';

test('the Disclaimers screen renders every shared disclaimer', async () => {
  await render(<DisclaimersScreen />);

  expect(screen.getByText('Disclaimers')).toBeOnTheScreen();
  for (const disclaimer of disclaimers) {
    expect(screen.getByTestId(`disclaimer-${disclaimer.id}`)).toBeOnTheScreen();
    expect(screen.getByText(disclaimer.title)).toBeOnTheScreen();
    expect(screen.getByText(disclaimer.body)).toBeOnTheScreen();
  }
});
