import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { BellMark } from "../components/bell-mark";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type ConnectedMomentProps = {
  accountName: string;
  onDone: () => void;
};

// How long the moment stays before Home (a tap moves on sooner).
const SHOW_FOR_MS = 2400;

// A small moment of delight once the phone is connected: the bell rings
// (unless the phone asks for less motion), the phone taps back, then Home.
export function ConnectedMoment({ accountName, onDone }: ConnectedMomentProps) {
  const palette = usePalette();
  const ring = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (!reduceMotion) ringTheBell(ring, ripple);
      })
      .catch(() => undefined);
    const timer = setTimeout(onDone, SHOW_FOR_MS);
    return () => clearTimeout(timer);
  }, [onDone, ring, ripple]);

  const rotate = ring.interpolate({ inputRange: [-1, 1], outputRange: ["-14deg", "14deg"] });
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const rippleOpacity = ripple.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.7, 0] });

  return (
    <Pressable style={[styles.screen, { backgroundColor: palette.frame }]} onPress={onDone} accessibilityRole="button" accessibilityLabel={`You're connected to ${accountName}. Continue.`}>
      <StatusBar style="light" />
      <View style={styles.bellArea}>
        <Animated.View style={[styles.ripple, { borderColor: palette.brass, opacity: rippleOpacity, transform: [{ scale: rippleScale }] }]} />
        <View style={[styles.plate, { borderColor: palette.brassRule, backgroundColor: palette.statusCard }]}>
          <Animated.View style={{ transform: [{ rotate }], transformOrigin: "50% 18%" }}>
            <BellMark size={84} color={palette.brass} strokeAt24={1.3} />
          </Animated.View>
        </View>
      </View>
      <Text style={[styles.title, { color: palette.onFrame }]} accessibilityRole="header">
        You're connected.
      </Text>
      <Text style={[styles.text, { color: palette.onFrameMuted }]}>
        This phone now checks in with ansa for <Text style={{ color: palette.onFrame }}>{accountName}</Text>.
      </Text>
    </Pressable>
  );
}

// Two quick swings and a settle, like a desk bell, with one ring going out.
function ringTheBell(ring: Animated.Value, ripple: Animated.Value): void {
  const swing = (to: number, duration: number) => Animated.timing(ring, { toValue: to, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
  Animated.parallel([
    Animated.sequence([Animated.delay(150), swing(1, 110), swing(-0.8, 140), swing(0.5, 140), swing(-0.25, 130), swing(0, 120)]),
    Animated.sequence([Animated.delay(200), Animated.timing(ripple, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true })]),
  ]).start();
}

const PLATE = 156;
const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14 },
  bellArea: { width: PLATE, height: PLATE, alignItems: "center", justifyContent: "center", marginBottom: 48 },
  plate: { width: PLATE, height: PLATE, borderRadius: PLATE / 2, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ripple: { position: "absolute", width: PLATE, height: PLATE, borderRadius: PLATE / 2, borderWidth: 2 },
  title: { ...type.display, fontSize: 36, lineHeight: 42, textAlign: "center" },
  text: { ...type.body, fontSize: 17, lineHeight: 25, textAlign: "center", maxWidth: 320 },
});
