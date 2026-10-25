// Hermes cannot compile rest parameters with a destructuring pattern (`...[input, options = {}]`),
// which @orpc/client ships; transpile parameters everywhere, node_modules included.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@babel/plugin-transform-parameters'],
  }
}
