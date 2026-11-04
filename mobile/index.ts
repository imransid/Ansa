import { registerRootComponent } from "expo";
import App from "./App";
import { defineBackgroundCheckIn } from "./src/background/check-in-task";

// Before React starts: the phone may start the app in the background only
// to run the check-in, and needs to know what it is.
defineBackgroundCheckIn();

// Registers App as the app's main component, in Expo Go and in a real build.
registerRootComponent(App);
