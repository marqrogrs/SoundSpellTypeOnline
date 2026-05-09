// Probe each stage in sequence with timestamps so we know exactly where it hangs
process.env.NODE_ENV = "development";
process.env.BABEL_ENV = "development";

const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const nm = (p) => path.join(ROOT, "node_modules", p);

const t = () => new Date().toISOString();

console.log(t(), "1: start");

let timer;
const watchdog = (label) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(t(), "HUNG at:", label);
  }, 5000);
};

watchdog("paths require");
const paths = require(nm("react-scripts/config/paths"));
console.log(t(), "2: paths loaded");

watchdog("env require");
require(nm("react-scripts/config/env"));
console.log(t(), "3: env loaded");

watchdog("createEnvironmentHash require");
const createEnvironmentHash = require(
  nm("react-scripts/config/webpack/persistentCache/createEnvironmentHash"),
);
console.log(t(), "4: createEnvHash loaded");

watchdog("webpack require");
const webpack = require(nm("webpack"));
console.log(t(), "5: webpack loaded");

watchdog("HtmlWebpackPlugin require");
const HtmlWebpackPlugin = require(nm("html-webpack-plugin"));
console.log(t(), "6: HtmlWebpackPlugin loaded");

watchdog("ForkTsCheckerWebpackPlugin require");
const ForkTs = require(nm("react-dev-utils/ForkTsCheckerWebpackPlugin"));
console.log(t(), "7: ForkTsCheckerWebpackPlugin loaded");

watchdog("ESLintPlugin require");
const ESLintPlugin = require(nm("eslint-webpack-plugin"));
console.log(t(), "8: ESLintPlugin loaded");

watchdog("ReactRefreshWebpackPlugin require");
const RR = require(nm("@pmmmwh/react-refresh-webpack-plugin"));
console.log(t(), "9: ReactRefreshWebpackPlugin loaded");

watchdog("webpack.config require");
const configFactory = require(nm("react-scripts/config/webpack.config"));
console.log(t(), "10: configFactory loaded");

watchdog("configFactory call");
const config = configFactory("development");
console.log(
  t(),
  "11: config created, plugins:",
  config.plugins.filter(Boolean).length,
);

watchdog("webpack(config)");
const compiler = webpack(config);
console.log(t(), "12: compiler created");

clearTimeout(timer);
process.exit(0);
