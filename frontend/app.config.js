const { expo } = require("./app.json");

module.exports = () => ({
  ...expo,
  extra: {
    ...expo.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? "",
  },
});
