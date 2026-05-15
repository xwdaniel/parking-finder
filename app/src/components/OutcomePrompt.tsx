import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { OutcomeKind } from '../lib/log/types';

// Post-park "How did it go?" prompt (brief §7). Surfaced by MapResultsScreen when
// the user returns to the app within ~6 h of tapping Navigate and the picked zone
// has no outcome yet. We use a native <Modal> instead of stacking a second
// bottom-sheet to avoid gesture conflicts with the main results sheet.

interface Props {
  visible: boolean;
  streetName: string | null;
  destinationLabel: string | null;
  onSubmit: (outcome: OutcomeKind, hoursObserved?: string) => void;
  onDismiss: () => void;
}

interface OutcomeOption {
  kind: OutcomeKind;
  label: string;
  hint: string;
  tone: 'positive' | 'negative' | 'neutral';
}

const OUTCOMES: OutcomeOption[] = [
  { kind: 'parked_ok', label: 'Parked OK — no ticket', hint: 'Bumps this zone to "places I\'ve parked free"', tone: 'positive' },
  { kind: 'verified_hours', label: 'Read the sign — hours were…', hint: 'Type the times so we can stop showing "verify with signage"', tone: 'positive' },
  { kind: 'sign_said_permit', label: 'Sign said permit only', hint: 'The data was wrong — downgrade this zone', tone: 'negative' },
  { kind: 'ticketed', label: 'Got a ticket', hint: 'Excludes this zone forever', tone: 'negative' },
  { kind: 'no_space', label: 'No space', hint: 'Spot was full — don\'t change the rules, just note it', tone: 'neutral' },
  { kind: 'unsafe', label: 'Felt unsafe', hint: 'Will surface a warning next time', tone: 'neutral' },
];

export function OutcomePrompt({ visible, streetName, destinationLabel, onSubmit, onDismiss }: Props) {
  const [hoursStage, setHoursStage] = useState(false);
  const [hours, setHours] = useState('');

  // Reset internal state every time the modal opens.
  const handleClose = () => {
    setHoursStage(false);
    setHours('');
    onDismiss();
  };

  const handlePick = (k: OutcomeKind) => {
    if (k === 'verified_hours') {
      setHoursStage(true);
      return;
    }
    onSubmit(k);
    setHoursStage(false);
    setHours('');
  };

  const handleHoursSubmit = () => {
    const trimmed = hours.trim();
    if (!trimmed) return; // require something — empty defeats the point
    onSubmit('verified_hours', trimmed);
    setHoursStage(false);
    setHours('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityLabel="Dismiss" />
        <View style={styles.card}>
          <Text style={styles.title}>{hoursStage ? 'What did the sign say?' : 'How did it go?'}</Text>
          <Text style={styles.sub}>
            {streetName ?? '(unnamed street)'}
            {destinationLabel ? <Text style={styles.subMuted}>  ·  near {destinationLabel}</Text> : null}
          </Text>

          {hoursStage ? (
            <View style={styles.hoursWrap}>
              <Text style={styles.hoursHint}>
                Use OSM opening_hours syntax — e.g. <Text style={styles.mono}>Mo-Fr 08:30-18:30</Text>, <Text style={styles.mono}>Mo-Sa 08:00-20:00</Text>, or <Text style={styles.mono}>24/7</Text>.
              </Text>
              <TextInput
                style={styles.hoursInput}
                value={hours}
                onChangeText={setHours}
                placeholder="Mo-Fr 08:30-18:30"
                placeholderTextColor="#9aa0a6"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <View style={styles.hoursButtons}>
                <Pressable style={styles.secondaryButton} onPress={() => setHoursStage(false)}>
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, !hours.trim() && styles.buttonDisabled]}
                  onPress={handleHoursSubmit}
                  disabled={!hours.trim()}
                >
                  <Text style={styles.primaryButtonText}>Save</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.options}>
              {OUTCOMES.map((o) => (
                <Pressable
                  key={o.kind}
                  style={[styles.option, styles[`option_${o.tone}`]]}
                  onPress={() => handlePick(o.kind)}
                  accessibilityRole="button"
                >
                  <Text style={styles.optionLabel}>{o.label}</Text>
                  <Text style={styles.optionHint}>{o.hint}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.skip} onPress={handleClose} accessibilityRole="button">
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 32,
    gap: 14,
  },
  title: { fontSize: 19, fontWeight: '700' },
  sub: { fontSize: 14, color: '#222' },
  subMuted: { color: '#777' },
  options: { gap: 8, marginTop: 4 },
  option: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  option_positive: { backgroundColor: '#f1f9f1', borderColor: '#cfe8cf' },
  option_negative: { backgroundColor: '#fdf3f3', borderColor: '#f1cccc' },
  option_neutral: { backgroundColor: '#f6f6f8', borderColor: '#dcdde2' },
  optionLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  optionHint: { fontSize: 12, color: '#666', marginTop: 2 },
  skip: { paddingVertical: 10, alignItems: 'center' },
  skipText: { fontSize: 14, color: '#888' },
  hoursWrap: { gap: 10, marginTop: 4 },
  hoursHint: { fontSize: 13, color: '#555', lineHeight: 18 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  hoursInput: {
    borderWidth: 1,
    borderColor: '#dcdde2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  hoursButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  primaryButton: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: { flex: 1, backgroundColor: '#f0f0f3', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: '#1a1a1a', fontSize: 15, fontWeight: '500' },
  buttonDisabled: { opacity: 0.4 },
});
