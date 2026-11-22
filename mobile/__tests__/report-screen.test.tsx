import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useState } from 'react';
import { ReportScreen } from '@/components/report-screen';
import { BottomTabInset } from '@/constants/theme';
import { ReportDraftProvider, useReportDraft } from '@/hooks/report-draft-context';
import {
  captureReportLocation,
  createGuestReportIdentity,
  pickReportPhoto,
  readGuestReportSecret,
  removeReportPhoto,
} from '@/data/report-device';
import { loadReportOptions, ReportFailure, submitReport } from '@/data/reporting';

jest.mock('@/data/report-device', () => ({
  captureReportLocation: jest.fn(),
  createGuestReportIdentity: jest.fn(),
  pickReportPhoto: jest.fn(),
  readGuestReportSecret: jest.fn(),
  removeReportPhoto: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/data/reporting', () => ({
  ...jest.requireActual('@/data/reporting'),
  loadReportOptions: jest.fn(),
  submitReport: jest.fn(),
}));
const id = '616d1c6c-3780-4eb2-a45d-1d6781990a90';
const photo = {
  uri: 'file:///cache/report.jpg',
  width: 100,
  height: 200,
  size: 1000,
  type: 'image/jpeg',
  capturedAt: '2026-11-18T12:00:00Z',
} as const;
const category = {
  category_id: 'dev-environmental',
  name: 'Environmental observation (development)',
  pillar: 'Environmental',
};
const options = { development: true, delivery_modes: ['custom'], categories: [category] } as const;
const accepted = {
  client_submission_id: id,
  observation_id: '616d1c6c-3780-4eb2-a45d-1d6781990a91',
  status: 'accepted',
  accepted_at: '2026-11-18T12:01:00Z',
} as const;
let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(loadReportOptions)
    .mockResolvedValue({ ...options, categories: [category], delivery_modes: ['custom'] });
  jest.mocked(createGuestReportIdentity).mockResolvedValue({ id, secret: '1'.repeat(64) });
  jest.mocked(readGuestReportSecret).mockResolvedValue('1'.repeat(64));
  jest.mocked(pickReportPhoto).mockResolvedValue(photo);
  jest
    .mocked(captureReportLocation)
    .mockResolvedValue({ location: null, locationReason: 'permission_denied' });
  jest.mocked(submitReport).mockReset().mockResolvedValue(accepted);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());
const press = async (label: string) => fireEvent.press(screen.getByRole('button', { name: label }));
function DoubleTapProbe() {
  const draft = useReportDraft();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Simulate double submit"
      onPress={() => {
        void draft.send();
        void draft.send();
      }}
    >
      <Text>Simulate double submit</Text>
    </Pressable>
  );
}
async function start(doubleTap = false) {
  await render(
    <ReportDraftProvider>
      <ReportScreen />
      {doubleTap && <DoubleTapProbe />}
    </ReportDraftProvider>,
  );
  await press(`Choose ${category.name}`);
}
async function addPhoto() {
  await press('Add photo');
  const buttons = alert.mock.calls.at(-1)![2];
  await act(async () => {
    await buttons.find((b: { text: string }) => b.text === 'Choose photo').onPress();
  });
}
async function recipient(email = 'person@example.test') {
  await fireEvent.changeText(screen.getByLabelText('Recipient email'), email);
  await press('Add recipient');
}
async function toReview(doubleTap = false) {
  await start(doubleTap);
  await addPhoto();
  await fireEvent.changeText(screen.getByLabelText('Optional commentary'), 'Observation note');
  await press('Choose recipients');
  await recipient();
  await press('Review report');
  expect(await screen.findByRole('button', { name: 'Submit report' })).toBeOnTheScreen();
}
test('retains the draft when the report tab leaves and reopens without requesting device permissions', async () => {
  function TabsProbe() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch report tab"
          onPress={() => setVisible((v) => !v)}
        >
          <Text>Switch tab</Text>
        </Pressable>
        {visible && <ReportScreen />}
      </>
    );
  }
  await render(
    <ReportDraftProvider>
      <TabsProbe />
    </ReportDraftProvider>,
  );
  expect(pickReportPhoto).not.toHaveBeenCalled();
  expect(captureReportLocation).not.toHaveBeenCalled();
  await press(`Choose ${category.name}`);
  await addPhoto();
  await fireEvent.changeText(screen.getByLabelText('Optional commentary'), 'Keep this draft');
  await press('Choose recipients');
  await recipient();
  await press('Switch report tab');
  await press('Switch report tab');
  expect(screen.getByText('person@example.test')).toBeOnTheScreen();
  await press('Back to Details');
  expect(screen.getByLabelText('Optional commentary')).toHaveDisplayValue('Keep this draft');
  expect(screen.getByLabelText('Remove photo 1')).toBeOnTheScreen();
  expect(pickReportPhoto).toHaveBeenCalledTimes(1);
  expect(captureReportLocation).not.toHaveBeenCalled();
});

test('requires photos and explicit review, shows only custom destinations and preserves denied-location details', async () => {
  await start();
  expect(screen.getByRole('button', { name: 'Choose recipients' })).toBeDisabled();
  await addPhoto();
  await fireEvent.changeText(screen.getByLabelText('Optional commentary'), 'Keep this note');
  await press('Include my location');
  expect(
    await screen.findByText('Location permission denied · no coordinates included'),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Optional commentary')).toHaveDisplayValue('Keep this note');
  await press('Choose recipients');
  await recipient('bad-address');
  expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen();
  await recipient('One@EXAMPLE.test');
  await recipient('other@example.test');
  await press('Remove other@example.test');
  await press('Review report');
  await screen.findByRole('button', { name: 'Submit report' });
  expect(submitReport).not.toHaveBeenCalled();
  expect(screen.getByText('One@example.test')).toBeOnTheScreen();
  expect(screen.queryByText('other@example.test')).not.toBeOnTheScreen();
  await press('Submit report');
  expect(await screen.findByText('Your report was accepted')).toBeOnTheScreen();
  expect(submitReport).toHaveBeenCalledTimes(1);
  const report = jest.mocked(submitReport).mock.calls[0][1];
  expect(report.metadata).toMatchObject({
    delivery_mode: 'custom',
    location: null,
    location_unavailable_reason: 'permission_denied',
    note: 'Keep this note',
    custom_recipients: ['One@example.test'],
  });
  expect(screen.getByText(/no email has been sent yet/)).toBeOnTheScreen();
});
test.each(['not_shared', 'permission_denied', 'unavailable'] as const)(
  'submits a successful location fix after location was %s',
  async (reason) => {
    const location = { type: 'Point', coordinates: [-84.4792, 33.7176] } as const;
    jest.mocked(captureReportLocation).mockResolvedValue({
      location: { ...location, coordinates: [...location.coordinates] },
    });
    await start();
    await addPhoto();
    if (reason !== 'not_shared') {
      jest.mocked(captureReportLocation).mockResolvedValueOnce({
        location: null,
        locationReason: reason,
      });
      await press('Include my location');
      expect(await screen.findByText(/no coordinates included/)).toBeOnTheScreen();
    }
    await press('Include my location');
    expect(await screen.findByText('33.71760, -84.47920')).toBeOnTheScreen();
    await press('Choose recipients');
    await recipient();
    await press('Review report');
    await press('Submit report');
    expect(await screen.findByText('Your report was accepted')).toBeOnTheScreen();
    const report = jest.mocked(submitReport).mock.calls[0][1];
    expect(report.metadata.location).toEqual(location);
    expect(report.metadata).not.toHaveProperty('location_unavailable_reason');
  },
);
test('can omit a successfully captured location before reviewing and submitting', async () => {
  jest.mocked(captureReportLocation).mockResolvedValue({
    location: { type: 'Point', coordinates: [-84.4792, 33.7176] },
  });
  await start();
  await addPhoto();
  await press('Include my location');
  await screen.findByText('33.71760, -84.47920');
  await press('Continue without location');
  expect(screen.getByText('Location not shared')).toBeOnTheScreen();
  await press('Choose recipients');
  await recipient();
  await press('Review report');
  await press('Submit report');
  await screen.findByText('Your report was accepted');
  expect(jest.mocked(submitReport).mock.calls[0][1].metadata).toMatchObject({
    location: null,
    location_unavailable_reason: 'not_shared',
  });
});
test('preserves the draft through picker cancellation and camera permission denial', async () => {
  await start();
  jest
    .mocked(pickReportPhoto)
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(
      new ReportFailure(
        'CAMERA_DENIED',
        'Camera access is off. Choose a photo instead, or enable camera access in Settings.',
      ),
    );
  await fireEvent.changeText(screen.getByLabelText('Optional commentary'), 'Preserved');
  await addPhoto();
  expect(screen.queryByLabelText('Attached photo 1')).not.toBeOnTheScreen();
  await addPhoto();
  expect(await screen.findByRole('button', { name: 'Open camera settings' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Optional commentary')).toHaveDisplayValue('Preserved');
  expect(createGuestReportIdentity).not.toHaveBeenCalled();
  expect(submitReport).not.toHaveBeenCalled();
});
test('deduplicates rapid submit taps and waits for a valid acceptance', async () => {
  let finish!: (receipt: typeof accepted) => void;
  jest.mocked(submitReport).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await toReview(true);
  await press('Simulate double submit');
  await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Waiting for server confirmation')).toBeOnTheScreen();
  expect(screen.queryByText('Your report was accepted')).not.toBeOnTheScreen();
  await act(async () => finish(accepted));
  expect(screen.getByText('Your report was accepted')).toBeOnTheScreen();
  expect(removeReportPhoto).toHaveBeenCalledWith(photo);
});
test('retries an uncertain result with the exact reviewed payload, secret and files', async () => {
  jest
    .mocked(submitReport)
    .mockRejectedValueOnce(
      new ReportFailure(
        'CONNECTION',
        'Submission could not be confirmed. Keep this report and retry.',
        true,
      ),
    )
    .mockResolvedValueOnce(accepted);
  await toReview();
  await press('Submit report');
  expect(await screen.findByText('Submission not confirmed')).toBeOnTheScreen();
  expect(removeReportPhoto).not.toHaveBeenCalled();
  await press('Retry same report');
  await screen.findByText('Your report was accepted');
  const calls = jest.mocked(submitReport).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1][1]).toBe(calls[0][1]);
  expect(calls[1][2]).toBe(calls[0][2]);
  expect(createGuestReportIdentity).toHaveBeenCalledTimes(1);
});
test('allows correction only after a definitive rejection and creates a fresh submission identity', async () => {
  jest
    .mocked(submitReport)
    .mockRejectedValueOnce(
      new ReportFailure(
        'REJECTED',
        'The report was not accepted. Review its category, recipients and photos.',
      ),
    );
  await toReview();
  await press('Submit report');
  await screen.findByText('Report not accepted');
  await press('Review details');
  expect(screen.getByLabelText('Optional commentary')).toHaveDisplayValue('Observation note');
  const nextId = '616d1c6c-3780-4eb2-a45d-1d6781990a92';
  jest.mocked(createGuestReportIdentity).mockResolvedValue({ id: nextId, secret: '2'.repeat(64) });
  await press('Choose recipients');
  await press('Review report');
  await screen.findByRole('button', { name: 'Submit report' });
  expect(createGuestReportIdentity).toHaveBeenCalledTimes(2);
  await press('Submit report');
  await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(2));
  expect(jest.mocked(submitReport).mock.calls[1][1].metadata.client_submission_id).toBe(nextId);
});

test('pads the form above the floating tab bar so footer actions stay reachable', async () => {
  await start();
  const { paddingBottom } = StyleSheet.flatten(
    screen.getByTestId('report-scroll').props.contentContainerStyle,
  );
  expect(BottomTabInset).toBeGreaterThan(0);
  expect(paddingBottom).toBeGreaterThanOrEqual(BottomTabInset + 20);
});
