import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { useReportDraft } from '@/hooks/report-draft-context';
import { normalizeReportRecipient, ReportFailure } from '@/data/reporting';

const blue = '#007aff';
function map() {
  router.replace('/');
}

export function ReportScreen() {
  const draft = useReportDraft();
  const { step, fields, options, locked, busy, locating } = draft;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const { reloadOptions, stopLocation } = draft;
  useEffect(() => {
    if (!options) void reloadOptions();
  }, [options, reloadOptions]);
  useEffect(() => {
    if (!draft.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [draft.retryAt]);
  useFocusEffect(useCallback(() => () => stopLocation(), [stopLocation]));
  const remaining = Math.max(0, Math.ceil((draft.retryAt - now) / 1000));
  const title = {
    route: 'Report an Issue',
    details: 'Add details',
    recipients: 'Recipients',
    review: 'Review report',
    sending: 'Submitting',
    accepted: 'Report accepted',
    error: 'Couldn’t submit',
  }[step];
  const category = options?.categories.find((c) => c.category_id === fields.categoryId);
  const canEdit = !locked && !busy && !locating;
  function back() {
    setEmailError('');
    if (step === 'accepted') {
      draft.finish();
      map();
    } else if (step === 'route' || step === 'sending' || locked) map();
    else
      draft.move(
        (
          {
            details: 'route',
            recipients: 'details',
            review: 'recipients',
            error: 'recipients',
          } as const
        )[step],
      );
  }
  const backLabel =
    step === 'route' || step === 'sending' || locked || step === 'accepted'
      ? 'Map'
      : step === 'details'
        ? 'Categories'
        : step === 'recipients'
          ? 'Details'
          : step === 'review'
            ? 'Recipients'
            : 'Review';
  const text = [styles.body, { color: theme.text }];
  const secondary = [styles.description, { color: theme.textSecondary }];
  const card = [
    styles.card,
    { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
  ];
  function button(label: string, onPress: () => void, disabled = false, secondary = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}
      >
        <Text style={[styles.buttonText, secondary && { color: blue }]}>{label}</Text>
      </Pressable>
    );
  }
  const heading = (value: string) => (
    <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
      {value}
    </Text>
  );
  const privacy = (
    <Text style={secondary}>
      Only the addresses you list will receive this report. Park administrators cannot view it.
    </Text>
  );
  const locationText = fields.location
    ? `${fields.location.coordinates[1].toFixed(5)}, ${fields.location.coordinates[0].toFixed(5)}`
    : fields.locationReason === 'permission_denied'
      ? 'Location permission denied · no coordinates included'
      : fields.locationReason === 'unavailable'
        ? 'Location unavailable · no coordinates included'
        : 'Location not shared';
  function addEmail(): boolean {
    try {
      if (!email.trim()) return true;
      const normalized = normalizeReportRecipient(email);
      if (fields.recipients.length >= 20 && !fields.recipients.includes(normalized))
        throw new ReportFailure('RECIPIENT', 'You can add up to twenty recipients.');
      draft.update({ recipients: [...new Set([...fields.recipients, normalized])] });
      setEmail('');
      setEmailError('');
      return true;
    } catch (error) {
      setEmailError(
        error instanceof ReportFailure ? error.message : 'Enter a valid email address.',
      );
      return false;
    }
  }
  function review() {
    if (email.trim()) {
      if (addEmail()) setEmailError('Address added. Review the list, then continue.');
      return;
    }
    if (!fields.recipients.length) {
      setEmailError('Add at least one recipient.');
      return;
    }
    void draft.review();
  }
  function photoChoice() {
    Alert.alert('Add photo', 'Take a photo or choose one from your library.', [
      { text: 'Take photo', onPress: () => void draft.addPhoto('camera') },
      { text: 'Choose photo', onPress: () => void draft.addPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  let content: ReactNode;
  if (step === 'route')
    content = (
      <>
        <Text style={secondary}>Choose a category for your observation.</Text>
        <View style={card}>
          {heading('Custom recipients')}
          {privacy}
          <Text style={styles.warning}>Development release · custom destinations only</Text>
        </View>
        {draft.loading && (
          <ActivityIndicator accessibilityLabel="Loading reporting options" color={blue} />
        )}
        {options?.categories.map((item) => (
          <Pressable
            key={item.category_id}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${item.name}`}
            onPress={() => {
              draft.update({ categoryId: item.category_id });
              draft.move('details');
            }}
            style={card}
          >
            <View style={styles.between}>
              <Text style={[text, styles.flex]}>{item.name}</Text>
              <Text style={secondary}>›</Text>
            </View>
            <Text style={secondary}>{item.pillar} · Send only to email addresses you list</Text>
          </Pressable>
        ))}
        {!options &&
          !draft.loading &&
          button('Retry reporting options', () => void draft.reloadOptions())}
      </>
    );
  else if (step === 'details')
    content = (
      <>
        <Text style={secondary}>{category?.name} · Custom recipients</Text>
        {heading('Photos')}
        <Text style={secondary}>Add 1–3 photos, up to 5 MiB each.</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photos}
        >
          {fields.photos.map((photo, index) => (
            <View key={photo.uri} style={[card, styles.photoCard]}>
              <Text style={[styles.caption, { color: theme.textSecondary }]}>
                Photo {index + 1}
              </Text>
              <Image
                source={{ uri: photo.uri }}
                style={styles.preview}
                contentFit="cover"
                accessibilityLabel={`Attached photo ${index + 1}`}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
                disabled={!canEdit}
                onPress={() => draft.removePhoto(index)}
                style={styles.removePhoto}
              >
                <Text style={styles.removePhotoText}>×</Text>
              </Pressable>
            </View>
          ))}
          {fields.photos.length < 3 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add photo"
              disabled={!canEdit}
              onPress={photoChoice}
              style={[card, styles.addPhoto]}
            >
              <Text style={styles.plus}>+</Text>
              <Text style={secondary}>Add photo</Text>
            </Pressable>
          )}
        </ScrollView>
        {busy && <ActivityIndicator accessibilityLabel="Preparing photo" color={blue} />}
        {heading('Commentary')}
        <TextInput
          accessibilityLabel="Optional commentary"
          placeholder="Add an optional note"
          placeholderTextColor={theme.textSecondary}
          value={fields.note}
          onChangeText={(note) => draft.update({ note })}
          editable={canEdit}
          multiline
          maxLength={2000}
          textAlignVertical="top"
          style={[card, text, styles.noteInput]}
        />
        <Text style={secondary}>{fields.note.length}/2000</Text>
        {heading('Location and time')}
        <View style={card}>
          <Text style={text}>{locationText}</Text>
          <Text style={secondary}>
            {fields.photos[0]
              ? new Date(fields.photos[0].capturedAt).toLocaleString()
              : 'Time recorded when you take or choose the first photo'}
          </Text>
          <Text style={secondary}>
            Location is optional. Nothing is shared until you review and submit.
          </Text>
          {locating ? (
            <ActivityIndicator accessibilityLabel="Finding report location" color={blue} />
          ) : (
            button(
              fields.location ? 'Refresh location' : 'Include my location',
              () => void draft.locate(),
              !canEdit,
              true,
            )
          )}
          {button('Continue without location', draft.omitLocation, locked || busy, true)}
        </View>
        {draft.error?.code === 'CAMERA_DENIED' &&
          button(
            'Open camera settings',
            () => {
              void Linking.openSettings().catch(() =>
                setEmailError('Settings could not be opened.'),
              );
            },
            false,
            true,
          )}
        <View style={styles.footer}>
          {button(
            'Choose recipients',
            () => draft.move('recipients'),
            !canEdit || !fields.photos.length,
          )}
        </View>
      </>
    );
  else if (step === 'recipients')
    content = (
      <>
        <Text style={secondary}>
          Add one or more email addresses. The report is sent only to the addresses listed below.
        </Text>
        <TextInput
          accessibilityLabel="Recipient email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setEmailError('');
          }}
          editable={canEdit}
          placeholder="name@example.org"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="done"
          onSubmitEditing={addEmail}
          maxLength={254}
          style={[card, text, styles.emailInput]}
        />
        {button('Add recipient', addEmail, !canEdit || !email.trim(), true)}
        {fields.recipients.map((recipient) => (
          <View key={recipient} style={[card, styles.chip]}>
            <Text style={[text, styles.flex]}>{recipient}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${recipient}`}
              disabled={!canEdit}
              onPress={() =>
                draft.update({
                  recipients: fields.recipients.filter((value) => value !== recipient),
                })
              }
              style={styles.remove}
            >
              <Text style={secondary}>×</Text>
            </Pressable>
          </View>
        ))}
        <View style={card}>
          {heading('Recipient visibility')}
          {privacy}
        </View>
        <View style={styles.footer}>{button('Review report', review, !canEdit)}</View>
      </>
    );
  else if (step === 'review')
    content = (
      <>
        <View style={card}>
          {heading('Location')}
          <Text style={secondary}>{locationText}</Text>
          {heading('Content')}
          <Text style={secondary}>
            {category?.name} · {fields.photos.length}{' '}
            {fields.photos.length === 1 ? 'photograph' : 'photographs'}
          </Text>
          <Text style={secondary}>
            {fields.photos[0] && new Date(fields.photos[0].capturedAt).toLocaleString()}
          </Text>
          {!!fields.note && <Text style={text}>{fields.note}</Text>}
          {heading('Recipients')}
          {draft.prepared?.metadata.custom_recipients.map((recipient) => (
            <Text key={recipient} style={text}>
              {recipient}
            </Text>
          ))}
          {privacy}
        </View>
        <View style={[card, styles.notice]}>
          <Text style={styles.warning}>
            Submitting shares the reviewed location, observations and attachments with the listed
            recipients.
          </Text>
          <Text style={secondary}>
            This development release stores the report and queues email work. Email delivery is not
            enabled yet.
          </Text>
        </View>
        {locked && (
          <Text style={secondary}>
            The previous result is unconfirmed. Retry the same report to avoid duplicates.
          </Text>
        )}
        <View style={styles.footer}>
          {button(
            locked ? 'Retry same report' : 'Submit report',
            () => void draft.send(),
            !!remaining,
          )}
          {remaining > 0 && <Text style={secondary}>Retry available in {remaining}s</Text>}
        </View>
      </>
    );
  else if (step === 'sending')
    content = (
      <View style={styles.result}>
        <Image
          source={require('../../assets/reporting/sending.svg')}
          style={styles.progress}
          contentFit="contain"
          accessibilityLabel="Submission in progress"
        />
        {heading('Submitting report…')}
        <Text style={[text, styles.center]}>
          Uploading {fields.photos.length} {fields.photos.length === 1 ? 'photo' : 'photos'} for
          your chosen recipients.
        </Text>
        <View style={[card, styles.statusCard]}>
          <Text style={text}>
            {fields.location ? 'Location included' : 'No coordinates included'}
          </Text>
          <Text style={secondary}>Waiting for server confirmation</Text>
          <Text style={secondary}>Email delivery has not been confirmed.</Text>
        </View>
      </View>
    );
  else if (step === 'accepted')
    content = (
      <>
        <View style={[card, styles.success]}>
          <View
            style={styles.successIcon}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Report accepted"
          >
            <Image
              source={require('../../assets/reporting/success.svg')}
              style={styles.successIcon}
              contentFit="contain"
            />
            <Text aria-hidden style={styles.successCheck}>
              ✓
            </Text>
          </View>
          {heading('Your report was accepted')}
          <Text style={[text, styles.center]}>
            Your report and photos are stored securely. Email work is queued; no email has been sent
            yet.
          </Text>
        </View>
        <View style={card}>
          {heading(category?.name ?? 'Observation')}
          <Text selectable style={secondary}>
            Report {draft.receipt?.observation_id}
          </Text>
          <Text style={secondary}>
            Accepted {draft.receipt && new Date(draft.receipt.accepted_at).toLocaleString()}
          </Text>
          <Text style={styles.successText}>Status: Accepted</Text>
          {privacy}
        </View>
        <View style={styles.footer}>
          {button('Back to Map', () => {
            draft.finish();
            map();
          })}
        </View>
      </>
    );
  else
    content = (
      <>
        <View style={[card, styles.failure]}>
          {heading(locked ? 'Submission not confirmed' : 'Report not accepted')}
          <Text style={text}>{draft.error?.message}</Text>
        </View>
        <View style={card}>
          <Text style={secondary}>
            Your report details and photos are kept in this app session.{' '}
            {locked
              ? 'Retry this same report before making changes.'
              : 'Review the details and submit again.'}
          </Text>
          <Text style={secondary}>
            Your saved draft stays on this device until acceptance or explicit deletion.
          </Text>
          {privacy}
        </View>
        <View style={styles.footer}>
          {button(
            locked ? 'Retry same report' : 'Review details',
            () => (locked ? void draft.send() : draft.move('details')),
            !!remaining,
          )}
          {remaining > 0 && <Text style={secondary}>Retry available in {remaining}s</Text>}
          {button('Back to Map', map, false, true)}
        </View>
      </>
    );
  if (draft.restoring)
    return (
      <View style={{ flex: 1, paddingTop: insets.top, justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Restoring saved report" />
      </View>
    );
  return (
    <KeyboardAvoidingView
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          backgroundColor: theme.background === '#ffffff' ? '#f2f2f7' : theme.backgroundElement,
        },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { backgroundColor: theme.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${backLabel}`}
          onPress={back}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ {backLabel}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {title}
        </Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
      >
        <Text accessibilityLiveRegion="polite" style={secondary}>
          {draft.storageState === 'saving'
            ? 'Saving draft…'
            : draft.storageState === 'saved'
              ? 'Draft saved on this device'
              : draft.storageState === 'error'
                ? 'Draft storage needs attention'
                : ''}
        </Text>
        {!draft.recoveryBlocked && content}
        {step !== 'sending' &&
          (draft.storageState !== 'empty' || draft.recoveryBlocked) &&
          button(
            'Discard local draft',
            () => {
              Alert.alert(
                'Discard local draft?',
                'This removes the report and photos from this device. A report already accepted by the server may still be delivered.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Discard draft',
                    style: 'destructive',
                    onPress: () => void draft.discard(),
                  },
                ],
              );
            },
            busy || locating,
            true,
          )}
        {step !== 'error' && (draft.error || emailError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {emailError || draft.error?.message}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 20 },
  backText: { color: blue, fontSize: 17 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 },
  content: { padding: 16, gap: 16, flexGrow: 1 },
  body: { fontSize: 17, lineHeight: 22, letterSpacing: -0.4 },
  description: { fontSize: 15, lineHeight: 20, letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.4 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  button: {
    backgroundColor: blue,
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  secondaryButton: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.45 },
  footer: { marginTop: 'auto', gap: 8, paddingTop: 20 },
  photos: { gap: 12 },
  photoCard: { width: 104, minHeight: 104, padding: 8 },
  caption: { fontSize: 12, lineHeight: 16 },
  preview: { width: 86, height: 60, borderRadius: 8 },
  removePhoto: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoText: { color: blue, fontSize: 20 },
  addPhoto: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 28, color: blue, fontWeight: '700' },
  noteInput: { minHeight: 130 },
  emailInput: { minHeight: 50, borderColor: blue },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingRight: 0 },
  remove: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  notice: { marginTop: 50 },
  warning: { color: '#ad5700', fontSize: 15, lineHeight: 20 },
  error: { color: '#c5261d', fontSize: 15, lineHeight: 20 },
  center: { textAlign: 'center' },
  result: { alignItems: 'center', gap: 24, paddingTop: 100 },
  progress: { width: 104, height: 104 },
  statusCard: { alignSelf: 'stretch', marginTop: 30 },
  success: { backgroundColor: '#d2ecdd', alignItems: 'center', paddingVertical: 24, marginTop: 16 },
  successIcon: { width: 64, height: 64 },
  successCheck: {
    position: 'absolute',
    top: 15,
    left: 0,
    width: 64,
    textAlign: 'center',
    color: '#fff',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  successText: { color: '#167932', fontSize: 15 },
  failure: { backgroundColor: '#f7dedc', borderColor: '#ff3b30', marginTop: 16 },
});
