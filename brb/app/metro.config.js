// Lets Metro read the sibling @brb/protocol package (linked with file:../protocol).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../protocol")];
module.exports = config;
