const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/renderer/index.tsx',
  target: 'web',
  devtool: 'source-map',
  output: {
    path: path.join(__dirname, 'dist/renderer'),
    filename: 'renderer.js',
    publicPath: '/'
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist/renderer'),
    },
    hot: true,
    historyApiFallback: true,
    port: 3000,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
      filename: 'index.html',
    }),
  ],
};