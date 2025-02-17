const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: process.env.NODE_ENV,
  entry: './src/renderer/index.tsx',
  target: 'web',
  output: {
    path: path.join(__dirname, 'dist', 'renderer'),
    filename: 'index.js'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        include: /src/,
        use: [{ loader: 'ts-loader' }]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html'
    })
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist', 'renderer')
    },
    port: 3000
  }
};