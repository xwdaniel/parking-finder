import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  /** Optional second line under the label (e.g. a short hint). */
  hint?: string;
}

interface Props<T extends string> {
  options: readonly [SegmentOption<T>, SegmentOption<T>];
  value: T;
  onChange: (value: T) => void;
  /** Accessibility label for the whole control. */
  accessibilityLabel?: string;
}

/** Two-option iOS-style segmented control. Used for the mode and time toggles. */
export function SegmentedToggle<T extends string>({ options, value, onChange, accessibilityLabel }: Props<T>) {
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            style={[styles.segment, selected && styles.segmentSelected]}
            onPress={() => onChange(opt.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{opt.label}</Text>
            {opt.hint ? <Text style={[styles.hint, selected && styles.hintSelected]}>{opt.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#eef0f2',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  segmentSelected: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: { fontSize: 15, fontWeight: '600', color: '#555' },
  labelSelected: { color: '#0a7ea4' },
  hint: { fontSize: 11, color: '#888' },
  hintSelected: { color: '#3a8fab' },
});
