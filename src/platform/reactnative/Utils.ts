import { I18nManager, Platform } from "react-native";

export const isAndroidRTL = () => {
    return I18nManager.isRTL && Platform.OS === "android";
}