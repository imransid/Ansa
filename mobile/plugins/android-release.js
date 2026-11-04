// Two changes to the Android project that `npx expo prebuild` writes
// (android/ is generated on every build and never kept in git), so every
// build, the stores' included, gets them.
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// WHY: the release build shrinks the app's code with R8 in its "full mode",
// where keeping a class no longer keeps its constructor. WorkManager (behind
// expo-background-task) brings Room 2.6, whose rule keeps its database class
// only, so R8 dropped the constructor Room calls by reflection, and the app
// closed as soon as it opened (the first Android build, 4 November 2026).
const ROOM_KEEP_RULE = [
  "# ansa (plugins/android-release.js): Room makes its databases by reflection.",
  "-keep class * extends androidx.room.RoomDatabase { <init>(); }",
].join("\n");

// Adds the keep rule to android/app/proguard-rules.pro, once.
function withRoomKeepRule(config) {
  return withDangerousMod(config, [
    "android",
    (modConfig) => {
      const rulesFile = path.join(modConfig.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const rules = fs.readFileSync(rulesFile, "utf8");
      if (!rules.includes(ROOM_KEEP_RULE)) fs.writeFileSync(rulesFile, `${rules.trimEnd()}\n\n${ROOM_KEEP_RULE}\n`);
      return modConfig;
    },
  ]);
}

// WHY: a test build on a real phone reaches core's development listener on
// the laptop's Wi-Fi over plain http, which Android refuses unless the app
// allows it. Allowed only when ANSA_ALLOW_PLAIN_HTTP=1 is set while running
// prebuild; otherwise the setting is taken out, so a store build never has it.
function withPlainHttpOnlyForTestBuilds(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) return modConfig;
    if (process.env.ANSA_ALLOW_PLAIN_HTTP === "1") {
      application.$["android:usesCleartextTraffic"] = "true";
    } else {
      delete application.$["android:usesCleartextTraffic"];
    }
    return modConfig;
  });
}

module.exports = function withAnsaAndroidRelease(config) {
  return withPlainHttpOnlyForTestBuilds(withRoomKeepRule(config));
};
