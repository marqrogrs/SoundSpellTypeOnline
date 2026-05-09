process.env.BABEL_ENV = "development";
process.env.NODE_ENV = "development";

const path = require("path");
const webpack = require("webpack");
const WebpackDevServer = require("webpack-dev-server");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const appPath = path.resolve(__dirname, "..");
const srcPath = path.join(appPath, "src");
const publicPath = path.join(appPath, "public");

const envDefinitions = Object.keys(process.env)
  .filter((key) => key.startsWith("REACT_APP_"))
  .reduce(
    (definitions, key) => ({
      ...definitions,
      [`process.env.${key}`]: JSON.stringify(process.env[key]),
    }),
    {
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.PUBLIC_URL": JSON.stringify(""),
    },
  );

const config = {
  mode: "development",
  target: "web",
  devtool: "cheap-module-source-map",
  entry: path.join(srcPath, "index.js"),
  output: {
    path: path.join(appPath, ".preview-build"),
    filename: "static/js/bundle.js",
    chunkFilename: "static/js/[name].chunk.js",
    publicPath: "/",
    clean: true,
  },
  resolve: {
    extensions: [".js", ".jsx", ".mjs", ".json", ".ts", ".tsx"],
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|mjs|ts|tsx)$/,
        include: srcPath,
        use: {
          loader: require.resolve("babel-loader"),
          options: {
            babelrc: false,
            configFile: false,
            presets: [
              [
                require.resolve("babel-preset-react-app"),
                {
                  runtime: "classic",
                },
              ],
            ],
            cacheDirectory: true,
            cacheCompression: false,
          },
        },
      },
      {
        test: /\.css$/,
        use: [require.resolve("style-loader"), require.resolve("css-loader")],
      },
      {
        test: /\.(png|jpe?g|gif|svg|webp|mp3|wav|ogg)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(publicPath, "index.html"),
      inject: true,
    }),
    new webpack.DefinePlugin(envDefinitions),
  ],
};

const compiler = webpack(config);
const server = new WebpackDevServer(
  {
    host: "127.0.0.1",
    port: 3000,
    hot: true,
    historyApiFallback: true,
    static: {
      directory: publicPath,
      publicPath: "/",
      watch: true,
    },
    client: {
      overlay: true,
    },
  },
  compiler,
);

server.startCallback(() => {
  console.log("Preview server running at http://127.0.0.1:3000");
});

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    server.stopCallback(() => {
      process.exit();
    });
  });
});
