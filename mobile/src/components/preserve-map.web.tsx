import { StyleSheet, Text, View } from 'react-native';

export default function PreserveMap() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cascade Springs Preserve</Text>
      <Text>The interactive map is available in the iOS and Android development builds.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 120, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
});
