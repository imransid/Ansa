import { useFonts } from "expo-font";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppRoot } from "./src/app-root";
import { usePalette } from "./src/theme/colors";
import { FONT_FILES } from "./src/theme/type";

// The ansa phone app: connect this phone to an ansa account with a code from
// ansa's website, then see what ansa does and say "I'm away" or "I'm back".
export default function App() {
  const palette = usePalette();
  // The fonts come inside the app; until they are ready, the green frame.
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  return (
    <SafeAreaProvider style={{ backgroundColor: palette.frame }}>
      {fontsLoaded || fontError ? <AppRoot /> : <View style={{ flex: 1, backgroundColor: palette.frame }} />}
    </SafeAreaProvider>
  );
}
