import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import {
  captureReportLocation,
  createGuestReportIdentity,
  pickReportPhoto,
  readGuestReportSecret,
  removeReportPhoto,
} from '@/data/report-device';
import {
  loadReportOptions,
  prepareReport,
  ReportFailure,
  submitReport,
  type PreparedReport,
  type ReportFields,
  type ReportOptions,
  type ReportReceipt,
} from '@/data/reporting';

type Step = 'route' | 'details' | 'recipients' | 'review' | 'sending' | 'accepted' | 'error';
const emptyFields = (): ReportFields => ({
  categoryId: '',
  recipients: [],
  note: '',
  photos: [],
  location: null,
  locationReason: 'not_shared',
});
const safeError = (error: unknown) =>
  error instanceof ReportFailure
    ? error
    : new ReportFailure(
        'UNAVAILABLE',
        'This action could not be completed. Your details are still here.',
      );

function useDraft() {
  const [fields, setFields] = useState(emptyFields);
  const [step, setStep] = useState<Step>('route');
  const [options, setOptions] = useState<ReportOptions>();
  const [error, setError] = useState<ReportFailure>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [receipt, setReceipt] = useState<ReportReceipt>();
  const [prepared, setPrepared] = useState<PreparedReport>();
  const [locked, setLocked] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const identity = useRef<{ id: string } | undefined>(undefined);
  const operation = useRef(false);
  const inFlight = useRef(false);
  const frozen = useRef<PreparedReport | undefined>(undefined);
  const outcome = useRef<ReportReceipt | undefined>(undefined);
  const submitted = useRef(false);
  const nextRetry = useRef(0);
  const locationController = useRef<AbortController | undefined>(undefined);
  const optionsController = useRef<AbortController | undefined>(undefined);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const stopLocation = useCallback(() => locationController.current?.abort(), []);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background') locationController.current?.abort();
    });
    return () => {
      listener.remove();
      locationController.current?.abort();
      optionsController.current?.abort();
    };
  }, []);

  const reloadOptions = useCallback(async () => {
    optionsController.current?.abort();
    const controller = new AbortController();
    optionsController.current = controller;
    const timer = setTimeout(() => controller.abort(), 10_000);
    setLoading(true);
    setError(undefined);
    try {
      const result = await loadReportOptions(apiUrl, controller.signal);
      if (!controller.signal.aborted) setOptions(result);
    } catch (error) {
      if (optionsController.current === controller) setError(safeError(error));
    } finally {
      clearTimeout(timer);
      if (optionsController.current === controller) setLoading(false);
    }
  }, [apiUrl]);

  function update(change: Partial<ReportFields>) {
    if (submitted.current || operation.current) return;
    setFields((current) => ({ ...current, ...change }));
    frozen.current = undefined;
    setPrepared(undefined);
    setError(undefined);
  }
  function move(next: Step) {
    if (inFlight.current || operation.current) return;
    if (submitted.current && !['review', 'error'].includes(next)) return;
    setStep(next);
    setError(undefined);
  }
  async function addPhoto(source: 'camera' | 'library') {
    if (operation.current || submitted.current || fields.photos.length >= 3) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const photo = await pickReportPhoto(source);
      if (photo) {
        setFields((f) => ({ ...f, photos: [...f.photos, photo] }));
        frozen.current = undefined;
        setPrepared(undefined);
      }
    } catch (error) {
      setError(safeError(error));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  function removePhoto(index: number) {
    if (submitted.current || operation.current) return;
    const photo = fields.photos[index];
    setFields((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== index) }));
    frozen.current = undefined;
    setPrepared(undefined);
    if (photo) void removeReportPhoto(photo);
  }
  async function locate() {
    if (submitted.current || operation.current) return;
    locationController.current?.abort();
    const controller = new AbortController();
    locationController.current = controller;
    operation.current = true;
    setLocating(true);
    setError(undefined);
    try {
      const result = await captureReportLocation(controller.signal);
      if (locationController.current === controller) setFields((f) => ({ ...f, ...result }));
    } finally {
      if (locationController.current === controller) {
        locationController.current = undefined;
        operation.current = false;
        setLocating(false);
      }
    }
  }
  function omitLocation() {
    if (submitted.current || (operation.current && !locationController.current)) return;
    locationController.current?.abort();
    locationController.current = undefined;
    operation.current = false;
    setLocating(false);
    setFields((f) => ({ ...f, location: null, locationReason: 'not_shared' }));
    frozen.current = undefined;
    setPrepared(undefined);
  }
  async function review() {
    if (operation.current || inFlight.current) return;
    if (submitted.current && frozen.current) {
      setStep('review');
      return;
    }
    if (!options) {
      setError(new ReportFailure('OPTIONS', 'Load reporting options before continuing.'));
      return;
    }
    operation.current = true;
    setBusy(true);
    setError(undefined);
    try {
      prepareReport('00000000-0000-4000-8000-000000000000', fields, options);
      if (!identity.current) {
        const guest = await createGuestReportIdentity();
        identity.current = { id: guest.id };
      }
      const report = prepareReport(identity.current.id, fields, options);
      frozen.current = report;
      setPrepared(report);
      setStep('review');
    } catch (error) {
      setError(safeError(error));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function send() {
    if (
      inFlight.current ||
      operation.current ||
      outcome.current ||
      Date.now() < nextRetry.current ||
      !frozen.current ||
      !identity.current
    )
      return;
    inFlight.current = true;
    submitted.current = true;
    setLocked(true);
    setStep('sending');
    setError(undefined);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const report = frozen.current;
    try {
      const secret = await readGuestReportSecret(identity.current.id);
      const result = await submitReport(apiUrl, report, secret, controller.signal);
      outcome.current = result;
      setReceipt(result);
      setStep('accepted');
      await Promise.all(report.photos.map((photo) => removeReportPhoto(photo)));
    } catch (error) {
      const failure = safeError(error);
      // Only a definitive 400/413/415 permits editing under a new submission identity.
      if (failure.code === 'REJECTED') {
        submitted.current = false;
        setLocked(false);
        identity.current = undefined;
        frozen.current = undefined;
        setPrepared(undefined);
      }
      nextRetry.current = failure.retryAfterMs > 0 ? Date.now() + failure.retryAfterMs : 0;
      setRetryAt(nextRetry.current);
      setError(failure);
      setStep('error');
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
    }
  }
  function finish() {
    if (!outcome.current || inFlight.current) return;
    identity.current = undefined;
    frozen.current = undefined;
    outcome.current = undefined;
    submitted.current = false;
    setFields(emptyFields());
    setPrepared(undefined);
    setReceipt(undefined);
    setLocked(false);
    setRetryAt(0);
    nextRetry.current = 0;
    setError(undefined);
    setStep('route');
  }
  return {
    fields,
    step,
    options,
    loading,
    busy,
    locating,
    receipt,
    prepared,
    locked,
    error,
    retryAt,
    update,
    move,
    reloadOptions,
    addPhoto,
    removePhoto,
    locate,
    omitLocation,
    review,
    send,
    finish,
    stopLocation,
  };
}
type Draft = ReturnType<typeof useDraft>;
const Context = createContext<Draft | null>(null);
export function ReportDraftProvider({ children }: { children: ReactNode }) {
  const value = useDraft();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useReportDraft() {
  const value = useContext(Context);
  if (!value) throw new Error('Report draft provider missing');
  return value;
}
